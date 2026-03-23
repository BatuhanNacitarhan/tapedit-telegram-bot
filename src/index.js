require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const User = require('./models/User');
const Generation = require('./models/Generation');
const TapeditAutomation = require('./automation/tapedit');
const ReferralService = require('./services/referral');
const { initDatabase, dbHelper, isTurso } = require('./database');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BOT_USERNAME = process.env.BOT_USERNAME || 'GrokAi_ImageBot';
const PORT = process.env.PORT || 8000;
const KOYEB_URL = process.env.KOYEB_URL;
const STORAGE_CHANNEL_ID = process.env.STORAGE_CHANNEL_ID;

const VIP_USERS = ['wraith0_0', 'Irresistible_2'];
const BOT_OWNER = 'GloriusSerpent';

const STAR_PRODUCTS = {
  'credits_3': { stars: 75, credits: 3, title: '3 Hak', desc: '3 görsel hakkı' },
  'credits_5': { stars: 125, credits: 5, title: '5 Hak', desc: '5 görsel hakkı' },
  'credits_10': { stars: 250, credits: 10, title: '10 Hak', desc: '10 görsel hakkı' },
  'credits_20': { stars: 450, credits: 20, title: '20 Hak', desc: '20 görsel hakkı' },
  'credits_50': { stars: 1000, credits: 50, title: '50 Hak', desc: '50 görsel hakkı' }
};

const downloadsPath = path.join(__dirname, '..', 'downloads');
if (!fs.existsSync(downloadsPath)) fs.mkdirSync(downloadsPath, { recursive: true });

// Health check
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('OK');
}).listen(PORT, () => console.log(`✅ Health check: ${PORT}`));

const bot = new TelegramBot(TOKEN, { polling: true, filepath: true });
const tapedit = new TapeditAutomation();

// Helpers
const escapeHtml = (t) => t ? t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
const isVIP = (u) => VIP_USERS.includes(u?.replace('@', ''));
const menu = { keyboard: [['🎨 Oluştur', '⭐ Satın Al'], ['📊 Hesabım', '🔗 Referans'], ['📜 Geçmiş', '❓ Yardım']], resize_keyboard: true };

// Keep-alive
if (KOYEB_URL) {
  setInterval(() => axios.get(KOYEB_URL).catch(() => {}), 30 * 60 * 1000);
  console.log(`🔄 Keep-alive: ${KOYEB_URL}`);
}

// Kanal fonksiyonları
async function sendToChannel(buffer, caption, replyId) {
  if (!STORAGE_CHANNEL_ID) return null;
  try {
    return await bot.sendDocument(STORAGE_CHANNEL_ID, buffer, { caption, parse_mode: 'HTML', filename: `img_${Date.now()}.jpg`, reply_to_message_id: replyId });
  } catch (e) { return null; }
}

// Komutlar
async function handleStart(chatId, msg, code) {
  const existing = await User.findById(msg.from.id);
  const isNew = !existing;
  const user = await User.findOrCreate(msg.from.id, msg.from.username || `user_${msg.from.id}`);
  
  if (isNew && code) {
    const result = await ReferralService.processReferral(user.telegram_id, code);
    if (result.success) {
      await bot.sendMessage(chatId, `🎉 Referans bonusu! +1 hak`, { parse_mode: 'HTML', reply_markup: menu });
    }
  }
  
  const unlimited = await User.hasUnlimitedCredits(user.telegram_id);
  const cred = unlimited ? '∞ SINIRSIZ' : user.credits;
  const vip = isVIP(user.username) ? ' 👑 VIP' : '';
  
  await bot.sendMessage(chatId, 
    `🤖 <b>Tapedit AI Bot</b>${vip}\n\n👤 @${escapeHtml(user.username)}\n🎫 Hak: <b>${cred}</b>`,
    { parse_mode: 'HTML', reply_markup: menu }
  );
}

async function handleGenerate(chatId, user) {
  const unlimited = await User.hasUnlimitedCredits(user.telegram_id);
  if (!unlimited && user.credits <= 0) {
    return await bot.sendMessage(chatId, '❌ Hakkınız kalmadı!\n\n⭐ Satın Al butonuna tıklayın.', { parse_mode: 'HTML', reply_markup: menu });
  }
  await User.updateState(user.telegram_id, 'waiting_image');
  await bot.sendMessage(chatId, `📸 Görsel gönderin\n\n❌ İptal: /cancel`);
}

async function handleBuy(chatId, user) {
  const unlimited = await User.hasUnlimitedCredits(user.telegram_id);
  if (isVIP(user.username)) {
    return await bot.sendMessage(chatId, '👑 VIP statünüz var, sınırsız hak!', { reply_markup: menu });
  }
  
  let msg = `⭐ <b>Yıldız ile Hak Satın Al</b>\n\n🎫 Mevcut: <b>${unlimited ? '∞' : user.credits}</b>\n\n📦 <b>Paketler:</b>\n\n`;
  Object.entries(STAR_PRODUCTS).forEach(([id, p], i) => {
    msg += `${i + 1}. ${p.title} - ${p.stars}⭐\n`;
  });
  
  const kb = {
    inline_keyboard: [
      [{ text: '3 Hak - 75⭐', callback_data: 'buy_credits_3' }, { text: '5 Hak - 125⭐', callback_data: 'buy_credits_5' }],
      [{ text: '10 Hak - 250⭐', callback_data: 'buy_credits_10' }, { text: '20 Hak - 450⭐', callback_data: 'buy_credits_20' }],
      [{ text: '50 Hak - 1000⭐', callback_data: 'buy_credits_50' }]
    ]
  };
  
  await bot.sendMessage(chatId, msg, { parse_mode: 'HTML', reply_markup: kb });
}

async function handleBalance(chatId, user) {
  const stats = await Generation.getStats(user.telegram_id);
  const unlimited = await User.hasUnlimitedCredits(user.telegram_id);
  const vip = isVIP(user.username) ? ' 👑 VIP' : '';
  
  await bot.sendMessage(chatId,
    `📊 <b>Hesabım</b>${vip}\n\n👤 @${escapeHtml(user.username)}\n🎫 Hak: <b>${unlimited ? '∞ SINIRSIZ' : user.credits}</b>\n📈 Toplam: ${stats.total} | ✅ ${stats.completed} | ❌ ${stats.failed}`,
    { parse_mode: 'HTML', reply_markup: menu }
  );
}

async function handleReferral(chatId, user) {
  const code = ReferralService.getReferralCode(user.telegram_id);
  const link = ReferralService.generateReferralLink(code, BOT_USERNAME);
  const stats = await ReferralService.getReferralStats(user.telegram_id);
  
  await bot.sendMessage(chatId,
    `🔗 <b>Referans</b>\n\n📋 Kod: <code>${code}</code>\n🔗 Link:\n<code>${link}</code>\n\n💰 Her ikisine +1 hak\n\n📊 Toplam: ${stats.total_referrals}`,
    { parse_mode: 'HTML', reply_markup: menu }
  );
}

async function handleHistory(chatId, user) {
  const history = await Generation.getUserHistory(user.telegram_id, 10);
  if (!history.length) return await bot.sendMessage(chatId, '📭 Geçmiş boş', { reply_markup: menu });
  
  let msg = `📜 <b>Son ${history.length} Görsel:</b>\n\n`;
  history.forEach((h, i) => {
    const s = h.status === 'completed' ? '✅' : '❌';
    const p = h.prompt.length > 20 ? h.prompt.substring(0, 20) + '...' : h.prompt;
    msg += `${i + 1}. ${s} "${escapeHtml(p)}"\n`;
  });
  
  await bot.sendMessage(chatId, msg, { parse_mode: 'HTML', reply_markup: menu });
}

async function handleHelp(chatId) {
  await bot.sendMessage(chatId,
    `❓ <b>Yardım</b>\n\n` +
    `/start - Başlat\n/generate - Oluştur\n/buy - Satın Al\n/balance - Hesap\n/referral - Referans\n/history - Geçmiş\n\n` +
    `💡 Kullanım:\n1. Oluştur'a tıkla\n2. Görsel gönder\n3. Prompt yaz`,
    { parse_mode: 'HTML', reply_markup: menu }
  );
}

// Bot komutları
bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
  await handleStart(msg.chat.id, msg, match[1]);
});

bot.onText(/\/generate/, async (msg) => {
  const user = await User.findOrCreate(msg.from.id, msg.from.username || `user_${msg.from.id}`);
  await handleGenerate(msg.chat.id, user);
});

bot.onText(/\/buy/, async (msg) => {
  const user = await User.findOrCreate(msg.from.id, msg.from.username || `user_${msg.from.id}`);
  await handleBuy(msg.chat.id, user);
});

bot.onText(/\/balance/, async (msg) => {
  const user = await User.findOrCreate(msg.from.id, msg.from.username || `user_${msg.from.id}`);
  await handleBalance(msg.chat.id, user);
});

bot.onText(/\/referral/, async (msg) => {
  const user = await User.findOrCreate(msg.from.id, msg.from.username || `user_${msg.from.id}`);
  await handleReferral(msg.chat.id, user);
});

bot.onText(/\/history/, async (msg) => {
  const user = await User.findOrCreate(msg.from.id, msg.from.username || `user_${msg.from.id}`);
  await handleHistory(msg.chat.id, user);
});

bot.onText(/\/help/, async (msg) => {
  await handleHelp(msg.chat.id);
});

bot.onText(/\/cancel/, async (msg) => {
  await User.updateState(msg.from.id, null, { temp_image_url: null, temp_file_id: null, temp_image_buffer: null });
  await bot.sendMessage(msg.chat.id, '✅ İptal', { reply_markup: menu });
});

// Menü butonları
bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/') || msg.photo) return;
  
  const user = await User.findOrCreate(msg.from.id, msg.from.username || `user_${msg.from.id}`);
  
  switch (msg.text) {
    case '🎨 Oluştur': return await handleGenerate(msg.chat.id, user);
    case '⭐ Satın Al': return await handleBuy(msg.chat.id, user);
    case '📊 Hesabım': return await handleBalance(msg.chat.id, user);
    case '🔗 Referans': return await handleReferral(msg.chat.id, user);
    case '📜 Geçmiş': return await handleHistory(msg.chat.id, user);
    case '❓ Yardım': return await handleHelp(msg.chat.id);
  }
  
  // Prompt işle
  if (user.state === 'waiting_prompt' && user.temp_image_url) {
    await processPrompt(msg, user);
  }
});

// Fotoğraf
bot.on('photo', async (msg) => {
  const user = await User.findById(msg.from.id);
  if (!user || user.state !== 'waiting_image') {
    return await bot.sendMessage(msg.chat.id, '⚠️ Önce 🎨 Oluştur tıklayın', { reply_markup: menu });
  }
  
  const photo = msg.photo[msg.photo.length - 1];
  const link = await bot.getFileLink(photo.file_id);
  
  try {
    const res = await axios.get(link, { responseType: 'arraybuffer' });
    const buf = Buffer.from(res.data, 'binary');
    await User.updateState(msg.from.id, 'waiting_prompt', { temp_image_url: link, temp_file_id: photo.file_id, temp_image_buffer: buf.toString('base64') });
  } catch (e) {
    await User.updateState(msg.from.id, 'waiting_prompt', { temp_image_url: link, temp_file_id: photo.file_id });
  }
  
  await bot.sendMessage(msg.chat.id, '✅ Görsel alındı!\n\n📝 Prompt yazın\n❌ İptal: /cancel');
});

// Prompt işle
async function processPrompt(msg, user) {
  const chatId = msg.chat.id;
  const prompt = msg.text;
  const unlimited = await User.hasUnlimitedCredits(user.telegram_id);
  
  if (!unlimited && user.credits <= 0) {
    await User.updateState(msg.from.id, null, { temp_image_url: null, temp_file_id: null, temp_image_buffer: null });
    return await bot.sendMessage(chatId, '❌ Hakkınız kalmadı!', { reply_markup: menu });
  }
  
  await User.updateState(msg.from.id, 'processing', { temp_image_url: null, temp_file_id: null, temp_image_buffer: null });
  
  const status = await bot.sendMessage(chatId, `⏳ İşleniyor...${isVIP(user.username) ? ' 👑' : ''}`);
  const start = Date.now();
  
  try {
    let buf;
    if (user.temp_image_buffer) {
      buf = Buffer.from(user.temp_image_buffer, 'base64');
    } else {
      const res = await axios.get(user.temp_image_url, { responseType: 'arraybuffer' });
      buf = Buffer.from(res.data, 'binary');
    }
    
    // Kanala gönder
    const chMsg = await sendToChannel(buf, `🆕 @${escapeHtml(user.username)}${isVIP(user.username) ? ' 👑' : ''}\n📝 ${escapeHtml(prompt)}`);
    
    const tmp = path.join(downloadsPath, `${msg.from.id}_${Date.now()}.jpg`);
    fs.writeFileSync(tmp, buf);
    
    const result = await tapedit.generateImage(tmp, prompt);
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    
    const time = ((Date.now() - start) / 1000).toFixed(1);
    
    if (result.success) {
      await User.updateCredits(msg.from.id, -1);
      await User.updateState(msg.from.id, null);
      
      const updated = await User.findById(msg.from.id);
      const cred = await User.hasUnlimitedCredits(msg.from.id) ? '∞' : updated.credits;
      
      await sendToChannel(result.imageBuffer, `✅ @${escapeHtml(user.username)} | ⏱️ ${time}s`, chMsg?.message_id);
      
      await Generation.create({ user_id: msg.from.id, username: user.username, prompt, status: 'completed', processing_time: parseFloat(time) });
      
      await bot.sendDocument(chatId, result.imageBuffer, { caption: `✅ Hazır!\n⏱️ ${time}s\n🎫 ${cred}`, filename: `result.jpg` });
      await bot.deleteMessage(chatId, status.message_id).catch(() => {});
    } else {
      throw new Error(result.error);
    }
  } catch (e) {
    console.error(e);
    await User.updateState(msg.from.id, null);
    await Generation.create({ user_id: msg.from.id, username: user.username, prompt, status: 'failed', error_message: e.message });
    await bot.deleteMessage(chatId, status.message_id).catch(() => {});
    await bot.sendMessage(chatId, `❌ Hata oluştu\n\n🔄 Tekrar: /generate`, { reply_markup: menu });
  }
}

// Ödeme
bot.on('callback_query', async (q) => {
  if (q.data.startsWith('buy_')) {
    const p = STAR_PRODUCTS[q.data.replace('buy_', '')];
    if (!p) return await bot.answerCallbackQuery(q.id, { text: 'Hata', show_alert: true });
    
    try {
      await bot.sendInvoice(q.message.chat.id, p.title, p.desc, `stars_${q.from.id}_${q.data.replace('buy_', '')}`, '', 'XTR', [{ label: p.title, amount: p.stars }]);
      await bot.answerCallbackQuery(q.id, { text: 'Ödeme açılıyor...' });
    } catch (e) {
      await bot.answerCallbackQuery(q.id, { text: e.message, show_alert: true });
    }
  }
});

bot.on('successful_payment', async (msg) => {
  const parts = msg.successful_payment.invoice_payload.split('_');
  const p = STAR_PRODUCTS[parts.slice(2).join('_')];
  
  if (p) {
    await User.updateCredits(msg.from.id, p.credits);
    const u = await User.findById(msg.from.id);
    await bot.sendMessage(msg.chat.id, `🎉 Ödeme başarılı!\n⭐ ${p.stars}\n🎫 +${p.credits} hak\n📊 Toplam: ${u.credits}`, { reply_markup: menu });
  }
});

bot.on('pre_checkout_query', async (q) => {
  await bot.answerPreCheckoutQuery(q.id, true);
});

// Başlat
async function main() {
  await initDatabase();
  console.log(`🤖 @${BOT_USERNAME}`);
  console.log(`👑 VIP: ${VIP_USERS.join(', ')}`);
  console.log(`🗄️ DB: ${isTurso() ? 'Turso' : 'Local'}`);
}

main().catch(console.error);
bot.on('polling_error', (e) => console.log('Polling error:', e.message));
