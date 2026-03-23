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
const PORT = process.env.PORT || 8000;

// Görsel kayıt kanalı ID
const STORAGE_CHANNEL_ID = process.env.STORAGE_CHANNEL_ID || null;

// Telegram caption limiti (document için 1024)
const CAPTION_MAX_LENGTH = 1024;

require('./database');

// Health check server
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

// Sınırsız kullanıcı kontrolü
const UNLIMITED_USERS = ['wraith0_0', 'Irresistible_2'];

async function getOrCreateUser(msg) {
  const telegramId = msg.from.id;
  const username = msg.from.username || `user_${telegramId}`;
  return await User.findOrCreate(telegramId, username);
}

// Caption'ı güvenli uzunluğa kısalt (sadece kullanıcıya giden mesajlar için)
function truncateCaption(caption, maxLength = CAPTION_MAX_LENGTH) {
  if (!caption) return '';
  if (caption.length <= maxLength) return caption;
  return caption.substring(0, maxLength - 3) + '...';
}

// Input görseli kanala gönder (her durumda) - PROMPT BİREBİR GÖNDERİLİR
async function sendInputToChannel(inputBuffer, prompt, username, userId) {
  if (!STORAGE_CHANNEL_ID) {
    console.log('⚠️ STORAGE_CHANNEL_ID ayarlanmamış');
    return null;
  }
  
  try {
    // Önce görseli minimal caption ile gönder
    const headerCaption = `🆕 *YENİ İSTEK*\n\n👤 @${username} | 🆔 \`${userId}\``;
    
    const message = await bot.sendDocument(STORAGE_CHANNEL_ID, inputBuffer, {
      caption: headerCaption,
      parse_mode: 'Markdown',
      filename: `input_${userId}_${Date.now()}.jpg`
    });
    
    // Prompt'u ayrı mesaj olarak gönder (BİREBİR, KESİLMEZ!)
    await bot.sendMessage(STORAGE_CHANNEL_ID, 
      `📝 *Prompt:*\n\n${prompt}`, 
      { 
        parse_mode: 'Markdown',
        reply_to_message_id: message.message_id 
      }
    );
    
    console.log(`📥 Input görsel + prompt kanala gönderildi: ${userId}`);
    return message;
  } catch (error) {
    console.error('❌ Input kanala gönderme hatası:', error.message);
    return null;
  }
}

// Output görseli kanala gönder - PROMPT BİREBİR GÖNDERİLİR
async function sendOutputToChannel(outputBuffer, prompt, username, userId, inputMessageId) {
  if (!STORAGE_CHANNEL_ID) return null;
  
  try {
    // Görseli minimal caption ile gönder
    const headerCaption = `✅ *SONUÇ*\n\n👤 @${username} | 🆔 \`${userId}\``;
    
    const message = await bot.sendDocument(STORAGE_CHANNEL_ID, outputBuffer, {
      caption: headerCaption,
      parse_mode: 'Markdown',
      filename: `output_${userId}_${Date.now()}.jpg`,
      reply_to_message_id: inputMessageId
    });
    
    // Prompt'u ayrı mesaj olarak gönder (BİREBİR, KESİLMEZ!)
    await bot.sendMessage(STORAGE_CHANNEL_ID, 
      `📝 *Prompt:*\n\n${prompt}`, 
      { 
        parse_mode: 'Markdown',
        reply_to_message_id: message.message_id 
      }
    );
    
    console.log(`📤 Output görsel + prompt kanala gönderildi: ${userId}`);
    return message;
  } catch (error) {
    console.error('❌ Output kanala gönderme hatası:', error.message);
    return null;
  }
}

// Hata durumunda kanala bilgi gönder - PROMPT BİREBİR GÖNDERİLİR
async function sendErrorToChannel(prompt, username, userId, errorMessage, inputMessageId) {
  if (!STORAGE_CHANNEL_ID) return null;
  
  try {
    // Hata mesajı gönder (sendMessage limiti 4096 karakter - prompt sığar)
    const message = await bot.sendMessage(STORAGE_CHANNEL_ID, 
      `❌ *HATA*\n\n` +
      `👤 @${username} | 🆔 \`${userId}\`\n\n` +
      `📝 *Prompt:*\n\n${prompt}\n\n` +
      `⚠️ *Hata:* ${errorMessage}`, 
      {
        parse_mode: 'Markdown',
        reply_to_message_id: inputMessageId
      }
    );
    
    console.log(`❌ Hata mesajı + prompt kanala gönderildi: ${userId}`);
    return message;
  } catch (error) {
    console.error('❌ Hata mesajı kanala gönderme hatası:', error.message);
    return null;
  }
}

// ========== KOMUTLAR ==========

bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const referralCode = match[1];
  
  try {
    // Kullanıcıyı getir veya oluştur (krediler korunur!)
    const isNewUser = !User.findById(msg.from.id);
    let user = await getOrCreateUser(msg);
    
    // Referans kodu ile geldi mi? (sadece yeni kullanıcılar için)
    if (isNewUser && referralCode) {
      const result = ReferralService.processReferral(user.telegram_id, referralCode);
      
      if (result.success) {
        user = User.findById(user.telegram_id);
        await bot.sendMessage(chatId, 
          `🎉 *Referans bonusu kazandınız!*\n\n` +
          `✨ +${result.referred_bonus} ekstra görüntü hakkı!\n` +
          `🎫 Toplam hak: ${user.credits}`,
          { parse_mode: 'Markdown' }
        );
      }
    }
    
    const isUnlimited = User.hasUnlimitedCredits(user.telegram_id);
    const creditDisplay = isUnlimited ? '∞ SINIRSIZ' : user.credits;
    
    await bot.sendMessage(chatId, 
      `🤖 *Tapedit AI Image Bot*\n\n` +
      `👤 Hoş geldiniz, @${user.username}!\n` +
      `🎫 Kalan Hak: *${creditDisplay}*\n\n` +
      `📋 *Komutlar:*\n` +
      `/generate - Görsel oluştur\n` +
      `/referral - Referans linkiniz\n` +
      `/balance - Hak durumunuz\n` +
      `/history - Görsel geçmişi\n` +
      `/help - Yardım`,
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
  
  const isUnlimited = User.hasUnlimitedCredits(user.telegram_id);
  
  if (!isUnlimited && user.credits <= 0) {
    return await bot.sendMessage(chatId, 
      '❌ *Görüntü hakkınız kalmadı!*\n\n' +
      '🔗 Referans linkinizi paylaşarak ücretsiz hak kazanabilirsiniz:\n' +
      'Kullanım: /referral',
      { parse_mode: 'Markdown' }
    );
  }
  
  User.updateState(user.telegram_id, 'waiting_image');
  await bot.sendMessage(chatId, 
    '📸 *Görüntü Oluşturma Modu*\n\n' +
    'Lütfen düzenlemek istediğiniz görseli gönderin.\n' +
    '❌ İptal için /cancel yazın.',
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/referral/, async (msg) => {
  const user = await getOrCreateUser(msg);
  
  // HER ZAMAN AYNI KOD (yeniden oluşturma)
  const referralCode = ReferralService.getReferralCode(user.telegram_id);
  const link = ReferralService.generateReferralLink(referralCode, BOT_USERNAME);
  const stats = ReferralService.getReferralStats(user.telegram_id);
  
  await bot.sendMessage(msg.chat.id, 
    `🔗 *Referans Sistemi*\n\n` +
    `📋 Kodunuz: \`${referralCode}\`\n` +
    `🔗 Linkiniz:\n\`${link}\`\n\n` +
    `💰 *Nasıl Çalışır?*\n` +
    `• Linkinizle gelen: +${process.env.REFERRED_BONUS || 2} hak\n` +
    `• Siz (referans sahibi): +${process.env.REFERRER_BONUS || 3} hak\n\n` +
    `📊 *İstatistikleriniz:*\n` +
    `• Toplam referans: ${stats.total_referrals}\n` +
    `• Kazanılan kredi: ${stats.total_credits_earned}`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/balance/, async (msg) => {
  const user = await getOrCreateUser(msg);
  const stats = Generation.getStats(user.telegram_id);
  const isUnlimited = User.hasUnlimitedCredits(user.telegram_id);
  const creditDisplay = isUnlimited ? '∞ SINIRSIZ' : user.credits;
  
  await bot.sendMessage(msg.chat.id, 
    `📊 *Hesap Durumunuz*\n\n` +
    `👤 Kullanıcı: @${user.username}\n` +
    `🎫 Kalan Hak: *${creditDisplay}*\n` +
    `📈 Toplam Üretim: ${stats.total}\n` +
    `✅ Başarılı: ${stats.completed}\n` +
    `❌ Başarısız: ${stats.failed}\n` +
    `📅 Kayıt: ${new Date(user.created_at).toLocaleDateString('tr-TR')}`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/history/, async (msg) => {
  const user = await getOrCreateUser(msg);
  const history = Generation.getUserHistory(user.telegram_id, 10);
  
  if (history.length === 0) {
    return await bot.sendMessage(msg.chat.id, '📭 Henüz görsel geçmişiniz yok.');
  }
  
  let message = `📚 *Son ${history.length} Görseliniz:*\n\n`;
  
  history.forEach((item, index) => {
    const date = new Date(item.created_at).toLocaleDateString('tr-TR');
    const status = item.status === 'completed' ? '✅' : '❌';
    message += `${index + 1}. ${status} "${item.prompt.substring(0, 30)}..."\n`;
    message += `   📅 ${date} | ⏱️ ${item.processing_time?.toFixed(1) || '-'}s\n\n`;
  });
  
  await bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
});

bot.onText(/\/cancel/, async (msg) => {
  User.updateState(msg.from.id, null, { temp_image_url: null, temp_file_id: null, temp_image_buffer: null });
  await bot.sendMessage(msg.chat.id, '✅ İşlem iptal edildi.');
});

bot.onText(/\/help/, async (msg) => {
  await bot.sendMessage(msg.chat.id, 
    `📚 *Yardım Menüsü*\n\n` +
    `🤖 Bu bot Tapedit.ai ile AI görüntü düzenleme yapar.\n\n` +
    `📋 *Komutlar:*\n` +
    `/start - Botu başlat\n` +
    `/generate - Görsel oluştur\n` +
    `/referral - Referans linkiniz\n` +
    `/balance - Hak durumunuz\n` +
    `/history - Görsel geçmişi\n` +
    `/cancel - İptal et\n` +
    `/help - Bu yardım\n\n` +
    `💡 *Kullanım:*\n` +
    `1. /generate yazın\n` +
    `2. Görsel gönderin\n` +
    `3. Prompt yazın\n` +
    `4. Sonucu bekleyin`,
    { parse_mode: 'Markdown' }
  );
});

// ========== MESAJ İŞLEYİCİLERİ ==========

bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const user = User.findById(msg.from.id);
  
  if (!user || user.state !== 'waiting_image') {
    return await bot.sendMessage(chatId, '⚠️ Önce /generate yazın.');
  }
  
  const photo = msg.photo[msg.photo.length - 1];
  const fileLink = await bot.getFileLink(photo.file_id);
  
  // Görseli buffer olarak indir ve sakla
  try {
    const imageResponse = await axios.get(fileLink, { responseType: 'arraybuffer' });
    const imageBuffer = Buffer.from(imageResponse.data, 'binary');
    
    // Buffer'ı base64 olarak sakla (SQLite'da)
    User.updateState(msg.from.id, 'waiting_prompt', {
      temp_image_url: fileLink,
      temp_file_id: photo.file_id,
      temp_image_buffer: imageBuffer.toString('base64')
    });
  } catch (error) {
    console.error('Görsel indirme hatası:', error);
    User.updateState(msg.from.id, 'waiting_prompt', {
      temp_image_url: fileLink,
      temp_file_id: photo.file_id
    });
  }
  
  await bot.sendMessage(chatId, 
    '✅ Görsel alındı!\n\n' +
    '📝 Şimdi ne yapılmasını istediğinizi yazın.\n' +
    'Örnek: "Arka planı değiştir, plaj olsun"\n\n' +
    '❌ İptal: /cancel'
  );
});

bot.on('message', async (msg) => {
  if (msg.text?.startsWith('/')) return;
  
  const user = User.findById(msg.from.id);
  if (!user || user.state !== 'waiting_prompt' || !user.temp_image_url) return;
  
  const prompt = msg.text;
  const imageUrl = user.temp_image_url;
  const input_file_id = user.temp_file_id;
  const inputBufferBase64 = user.temp_image_buffer;
  
  const isUnlimited = User.hasUnlimitedCredits(user.telegram_id);
  
  if (!isUnlimited && user.credits <= 0) {
    User.updateState(msg.from.id, null, { temp_image_url: null, temp_file_id: null, temp_image_buffer: null });
    return await bot.sendMessage(msg.chat.id, '❌ Hakkınız kalmadı! /referral ile hak kazanın.');
  }
  
  User.updateState(msg.from.id, 'processing', { temp_image_url: null, temp_file_id: null, temp_image_buffer: null });
  
  const statusMsg = await bot.sendMessage(msg.chat.id, 
    `⏳ *İşlem başladı...*\n\n📝 Prompt: "${prompt}"`,
    { parse_mode: 'Markdown' }
  );
  
  let inputMessageId = null;
  
  try {
    // Input buffer'ı hazırla
    let inputBuffer;
    if (inputBufferBase64) {
      inputBuffer = Buffer.from(inputBufferBase64, 'base64');
    } else {
      const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      inputBuffer = Buffer.from(imageResponse.data, 'binary');
    }
    
    // ========== INPUT'U KANALA GÖNDER (HER DURUMDA, PROMPT BİREBİR) ==========
    const inputMsg = await sendInputToChannel(inputBuffer, prompt, user.username, msg.from.id);
    inputMessageId = inputMsg?.message_id;
    
    // Görseli dosyaya kaydet
    const tempPath = path.join(downloadsPath, `${msg.from.id}_${Date.now()}.jpg`);
    fs.writeFileSync(tempPath, inputBuffer);
    
    // Tapedit otomasyonu
    const result = await tapedit.generateImage(tempPath, prompt);
    
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    
    if (result.success) {
      // Krediyi düş
      User.updateCredits(msg.from.id, -1);
      User.updateState(msg.from.id, null);
      
      // GÜNCELLENMİŞ kullanıcı bilgisi
      const updatedUser = User.findById(msg.from.id);
      
      // ========== OUTPUT'U KANALA GÖNDER (PROMPT BİREBİR) ==========
      await sendOutputToChannel(result.imageBuffer, prompt, user.username, msg.from.id, inputMessageId);
      
      // Veritabanına kaydet
      Generation.create({
        user_id: msg.from.id,
        username: user.username,
        prompt,
        input_file_id,
        input_image_url: imageUrl,
        output_file_id: null,
        output_image_url: null,
        status: 'completed',
        processing_time: result.processingTime
      });
      
      const creditDisplay = User.hasUnlimitedCredits(msg.from.id) 
        ? '∞ SINIRSIZ' 
        : updatedUser.credits;
      
      // Kullanıcıya gönder (sendDocument ile kalite korunsun)
      await bot.sendDocument(msg.chat.id, result.imageBuffer, {
        caption: truncateCaption(`✅ *Hazır!*\n\n📝 ${prompt}\n⏱️ ${result.processingTime.toFixed(1)}s\n🎫 Kalan: ${creditDisplay}`),
        parse_mode: 'Markdown',
        filename: `result_${Date.now()}.jpg`
      });
      
      // Status mesajını sil
      try { await bot.deleteMessage(msg.chat.id, statusMsg.message_id); } catch (e) {}
      
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    console.error('İşlem hatası:', error);
    
    User.updateState(msg.from.id, null);
    
    // ========== HATA DURUMUNDA KANALA BİLGİ GÖNDER (PROMPT BİREBİR) ==========
    await sendErrorToChannel(prompt, user.username, msg.from.id, error.message, inputMessageId);
    
    Generation.create({
      user_id: msg.from.id,
      username: user.username,
      prompt,
      input_file_id,
      input_image_url: imageUrl,
      status: 'failed',
      error_message: error.message
    });
    
    // Status mesajını sil
    try { await bot.deleteMessage(msg.chat.id, statusMsg.message_id); } catch (e) {}
    
    // Kullanıcıya GÜZEL bir hata mesajı gönder
    await bot.sendMessage(msg.chat.id, 
      `😔 *Üzgünüm, bir sorun oluştu*\n\n` +
      `⚠️ Görseliniz işlenirken beklenmedik bir hata oluştu.\n\n` +
      `🔄 Lütfen tekrar deneyin: /generate\n\n` +
      `💬 Sorun devam ederse daha farklı bir prompt deneyebilirsiniz.`,
      { parse_mode: 'Markdown' }
    );
  }
});

console.log('🚀 Bot başlatıldı!');
console.log(`🤖 @${BOT_USERNAME}`);
console.log(`👑 Sınırsız kullanıcılar: ${UNLIMITED_USERS.join(', ')}`);
console.log(`📺 Depolama kanalı: ${STORAGE_CHANNEL_ID || 'Ayarlanmadı'}`);

bot.on('polling_error', console.error);
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);
