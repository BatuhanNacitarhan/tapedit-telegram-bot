require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const User = require('./models/User');
const Generation = require('./models/Generation');
const TapeditAutomation = require('./automation/tapedit');
const ReferralService = require('./services/referral');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BOT_USERNAME = process.env.BOT_USERNAME || 'tapedit_image_bot';
const INITIAL_CREDITS = parseInt(process.env.INITIAL_CREDITS) || 5;
const PORT = process.env.PORT || 8000;

require('./database');

// Health check server (Koyeb için gerekli)
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('OK');
});

server.listen(PORT, () => {
  console.log(`✅ Health check server running on port ${PORT}`);
});

const bot = new TelegramBot(TOKEN, { polling: true, filepath: true });
const tapedit = new TapeditAutomation();

const downloadsPath = path.join(__dirname, '..', 'downloads');
const dataPath = path.join(__dirname, '..', 'data');

if (!fs.existsSync(downloadsPath)) fs.mkdirSync(downloadsPath, { recursive: true });
if (!fs.existsSync(dataPath)) fs.mkdirSync(dataPath, { recursive: true });

async function getOrCreateUser(msg) {
  const telegramId = msg.from.id;
  const username = msg.from.username || `user_${telegramId}`;
  return await User.findOrCreate(telegramId, username);
}

bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const referralCode = match[1];
  
  try {
    let user = await getOrCreateUser(msg);
    const createdAt = new Date(user.created_at).getTime();
    const isNewUser = (Date.now() - createdAt) < 5000;
    
    if (isNewUser && referralCode) {
      if (ReferralService.processReferral(user.telegram_id, referralCode)) {
        user = User.findById(user.telegram_id);
        await bot.sendMessage(chatId, `🎉 *Referans bonusu kazandınız!*\n\n✨ +${process.env.REFERRED_BONUS || 2} ekstra görüntü hakkı!`, { parse_mode: 'Markdown' });
      }
    }
    
    await bot.sendMessage(chatId, 
      `🤖 *Tapedit AI Image Bot'e Hoş Geldiniz!*\n\n` +
      `📊 *Mevcut Hakkınız:* ${user.credits} görüntü\n\n` +
      `📋 *Komutlar:*\n/generate - Görüntü üret\n/referral - Referans link\n/balance - Kalan haklar\n/help - Yardım`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Start hatası:', error);
    await bot.sendMessage(chatId, '❌ Bir hata oluştu.');
  }
});

bot.onText(/\/generate/, async (msg) => {
  const chatId = msg.chat.id;
  const user = await getOrCreateUser(msg);
  
  if (user.credits <= 0) {
    return await bot.sendMessage(chatId, '❌ Hakkınız kalmadı! /referral ile hak kazanın.');
  }
  
  User.updateState(user.telegram_id, 'waiting_image');
  await bot.sendMessage(chatId, '📸 Görsel gönderin. İptal için /cancel yazın.');
});

bot.onText(/\/referral/, async (msg) => {
  const user = await getOrCreateUser(msg);
  const link = ReferralService.generateReferralLink(user.referral_code, BOT_USERNAME);
  const stats = ReferralService.getReferralStats(user.telegram_id);
  
  await bot.sendMessage(msg.chat.id, 
    `🔗 *Referans Linkiniz:*\n\`${link}\`\n\n` +
    `📊 Toplam referans: ${stats.total_referrals}\n` +
    `💰 Kazanılan kredi: ${stats.total_credits_earned}`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/balance/, async (msg) => {
  const user = await getOrCreateUser(msg);
  const stats = Generation.getStats(user.telegram_id);
  await bot.sendMessage(msg.chat.id, `📊 Kalan Hak: *${user.credits}*\n📈 Toplam: ${stats.total}`, { parse_mode: 'Markdown' });
});

bot.onText(/\/cancel/, async (msg) => {
  User.updateState(msg.from.id, null, { temp_image_url: null, temp_file_id: null });
  await bot.sendMessage(msg.chat.id, '✅ İptal edildi.');
});

bot.onText(/\/help/, async (msg) => {
  await bot.sendMessage(msg.chat.id, 
    `📚 *Yardım*\n\n` +
    `/start - Başlat\n/generate - Görsel üret\n/referral - Referans link\n/balance - Haklarım\n/cancel - İptal`,
    { parse_mode: 'Markdown' }
  );
});

bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const user = User.findById(msg.from.id);
  
  if (!user || user.state !== 'waiting_image') {
    return await bot.sendMessage(chatId, '⚠️ Önce /generate yazın.');
  }
  
  const photo = msg.photo[msg.photo.length - 1];
  const fileLink = await bot.getFileLink(photo.file_id);
  
  User.updateState(msg.from.id, 'waiting_prompt', { temp_image_url: fileLink, temp_file_id: photo.file_id });
  await bot.sendMessage(chatId, '✅ Görsel alındı! Şimdi prompt yazın.');
});

bot.on('message', async (msg) => {
  if (msg.text?.startsWith('/')) return;
  
  const user = User.findById(msg.from.id);
  if (!user || user.state !== 'waiting_prompt' || !user.temp_image_url) return;
  
  const prompt = msg.text;
  const imageUrl = user.temp_image_url;
  User.updateState(msg.from.id, 'processing', { temp_image_url: null, temp_file_id: null });
  
  await bot.sendMessage(msg.chat.id, `⏳ İşlem başladı...\n📝 Prompt: "${prompt}"`);
  
  try {
    const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const imageBuffer = Buffer.from(imageResponse.data, 'binary');
    const tempPath = path.join(downloadsPath, `${msg.from.id}_${Date.now()}.jpg`);
    fs.writeFileSync(tempPath, imageBuffer);
    
    const result = await tapedit.generateImage(tempPath, prompt);
    
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    
    if (result.success) {
      User.updateCredits(msg.from.id, -1);
      User.updateState(msg.from.id, null);
      Generation.create({ user_id: msg.from.id, prompt, status: 'completed', processing_time: result.processingTime });
      
      const updatedUser = User.findById(msg.from.id);
      await bot.sendPhoto(msg.chat.id, result.imageBuffer, {
        caption: `✅ Hazır!\n⏱️ ${result.processingTime.toFixed(1)}s\n🎫 Kalan: ${updatedUser.credits}`
      });
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    User.updateState(msg.from.id, null);
    await bot.sendMessage(msg.chat.id, `❌ Hata: ${error.message}\n\n/generate ile tekrar deneyin.`);
  }
});

console.log('🚀 Bot başlatıldı!');
console.log(`🤖 @${BOT_USERNAME}`);

bot.on('polling_error', console.error);
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);
