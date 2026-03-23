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
const KOYEB_URL = process.env.KOYEB_URL || null;

const STORAGE_CHANNEL_ID = process.env.STORAGE_CHANNEL_ID || null;
const CAPTION_MAX_LENGTH = 1024;
const VIP_USERS = ['wraith0_0', 'Irresistible_2'];
const BOT_OWNER = 'GloriusSerpent';

const STAR_PRODUCTS = {
  'credits_3': { stars: 75, credits: 3, title: '3 Görsel Hakkı', description: '3 adet AI görsel üretme hakkı' },
  'credits_5': { stars: 125, credits: 5, title: '5 Görsel Hakkı', description: '5 adet AI görsel üretme hakkı' },
  'credits_10': { stars: 250, credits: 10, title: '10 Görsel Hakkı', description: '10 adet AI görsel üretme hakkı' },
  'credits_20': { stars: 450, credits: 20, title: '20 Görsel Hakkı', description: '20 adet AI görsel üretme hakkı' },
  'credits_50': { stars: 1000, credits: 50, title: '50 Görsel Hakkı', description: '50 adet AI görsel üretme hakkı' }
};

const hourlyStats = {};
const dailyStats = {};

const downloadsPath = path.join(__dirname, '..', 'downloads');
if (!fs.existsSync(downloadsPath)) fs.mkdirSync(downloadsPath, { recursive: true });

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

// ========== YARDIMCII FONKSİYONLAR ==========

function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncateCaption(caption, maxLength = CAPTION_MAX_LENGTH) {
  if (!caption) return '';
  if (caption.length <= maxLength) return caption;
  return caption.substring(0, maxLength - 3) + '...';
}

function isVIPUser(username) {
  return VIP_USERS.includes(username?.replace('@', ''));
}

function getMainMenuKeyboard() {
  return {
    keyboard: [
      ['🎨 Görsel Oluştur', '⭐ Hak Satın Al'],
      ['📊 Hesabım', '🔗 Referansım'],
      ['📜 Geçmiş', '📈 İstatistikler'],
      ['❓ Yardım']
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  };
}

// ========== KANAL FONKSİYONLARI ==========

async function sendInputToChannel(inputBuffer, prompt, username, userId) {
  if (!STORAGE_CHANNEL_ID) return null;
  
  try {
    const isVIP = isVIPUser(username);
    
    if (isVIP) {
      await bot.sendMessage(STORAGE_CHANNEL_ID, 
        `👑 <b>VIP KULLANICI AKTİF</b>\n👤 @${escapeHtml(username)}\n🎫 Statü: <b>SINIRSIZ</b>`,
        { parse_mode: 'HTML' }
      );
    }
    
    const headerCaption = `🆕 <b>YENİ İSTEK</b>\n👤 @${escapeHtml(username)}${isVIP ? ' 👑' : ''} | 🆔 <code>${userId}</code>`;
    const message = await bot.sendDocument(STORAGE_CHANNEL_ID, inputBuffer, {
      caption: headerCaption,
      parse_mode: 'HTML',
      filename: `input_${userId}_${Date.now()}.jpg`
    });
    
    await bot.sendMessage(STORAGE_CHANNEL_ID, 
      `📝 <b>Prompt:</b>\n\n${escapeHtml(prompt)}`,
      { parse_mode: 'HTML', reply_to_message_id: message.message_id }
    );
    
    return message;
  } catch (error) {
    console.error('❌ Kanala gönderme hatası:', error.message);
    return null;
  }
}

async function sendOutputToChannel(outputBuffer, prompt, username, userId, inputMessageId, processingTime) {
  if (!STORAGE_CHANNEL_ID) return null;
  
  try {
    const isVIP = isVIPUser(username);
    const headerCaption = `✅ <b>SONUÇ</b>\n👤 @${escapeHtml(username)}${isVIP ? ' 👑' : ''} | ⏱️ ${processingTime.toFixed(1)}s`;
    
    const message = await bot.sendDocument(STORAGE_CHANNEL_ID, outputBuffer, {
      caption: headerCaption,
      parse_mode: 'HTML',
      filename: `output_${userId}_${Date.now()}.jpg`,
      reply_to_message_id: inputMessageId
    });
    
    await bot.sendMessage(STORAGE_CHANNEL_ID, 
      `📝 <b>Prompt:</b>\n\n${escapeHtml(prompt)}`,
      { parse_mode: 'HTML', reply_to_message_id: message.message_id }
    );
    
    return message;
  } catch (error) {
    console.error('❌ Output kanal hatası:', error.message);
    return null;
  }
}

async function sendErrorToChannel(prompt, username, userId, errorMessage, inputMessageId) {
  if (!STORAGE_CHANNEL_ID) return null;
  
  try {
    await bot.sendMessage(STORAGE_CHANNEL_ID, 
      `❌ <b>HATA</b>\n👤 @${escapeHtml(username)}\n📝 ${escapeHtml(prompt)}\n⚠️ ${escapeHtml(errorMessage)}`,
      { parse_mode: 'HTML', reply_to_message_id: inputMessageId }
    );
  } catch (error) {
    console.error('❌ Hata kanal hatası:', error.message);
  }
}

async function sendPurchaseToChannel(username, userId, credits, stars) {
  if (!STORAGE_CHANNEL_ID) return;
  try {
    await bot.sendMessage(STORAGE_CHANNEL_ID, 
      `💰 <b>YENİ SATIN ALMA</b>\n👤 @${escapeHtml(username)} | 🎫 ${credits} Hak | ⭐ ${stars}`,
      { parse_mode: 'HTML' }
    );
  } catch (error) {
    console.error('Satın alma kanal hatası:', error);
  }
}

// ========== KEEP-ALIVE ==========

if (KOYEB_URL) {
  setInterval(async () => {
    try {
      await axios.get(KOYEB_URL);
      console.log('🔄 Keep-alive ping');
    } catch (error) {}
  }, 30 * 60 * 1000);
  console.log(`🔄 Keep-alive aktif: ${KOYEB_URL}`);
}

setInterval(async () => {
  try { await bot.getMe(); } catch (error) {}
}, 25 * 60 * 1000);

// ========== BOT KOMUTLARI ==========

async function setupBotCommands() {
  try {
    await bot.setMyCommands([
      { command: 'start', description: 'Botu başlat' },
      { command: 'generate', description: 'AI görsel oluştur' },
      { command: 'buy', description: 'Yıldız ile hak satın al' },
      { command: 'balance', description: 'Hak durumunu göster' },
      { command: 'referral', description: 'Referans linkini al' },
      { command: 'history', description: 'Görsel geçmişini göster' },
      { command: 'stats', description: 'İstatistikler (VIP)' },
      { command: 'help', description: 'Yardım menüsü' }
    ]);
    console.log('✅ Bot komutları ayarlandı');
  } catch (error) {
    console.error('Komut ayarlama hatası:', error.message);
  }
}

// ========== MAIN STARTUP ==========

async function main() {
  // Database'i başlat
  await initDatabase();
  
  // Bot komutlarını ayarla
  await setupBotCommands();
  
  console.log('🚀 Bot başlatıldı!');
  console.log(`🤖 @${BOT_USERNAME}`);
  console.log(`👑 VIP: ${VIP_USERS.join(', ')}`);
  console.log(`💰 Owner: @${BOT_OWNER}`);
  console.log(`📺 Kanal: ${STORAGE_CHANNEL_ID || 'Yok'}`);
  console.log(`⭐ Yıldız satın alma: Aktif`);
  console.log(`🗄️ Database: ${isTurso() ? 'Turso (Cloud)' : 'Local SQLite'}`);
}

// ========== KOMUT İŞLEYİCİLERİ ==========

bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const referralCode = match[1];
  
  try {
    // Yeni kullanıcı mı kontrol et
    let existingUser = await User.findById(msg.from.id);
    const isNewUser = !existingUser;
    
    let user = await User.findOrCreate(msg.from.id, msg.from.username || `user_${msg.from.id}`);
    
    if (isNewUser && referralCode) {
      const result = await ReferralService.processReferral(user.telegram_id, referralCode);
      
      if (result.success) {
        user = await User.findById(user.telegram_id);
        await bot.sendMessage(chatId, 
          `🎉 <b>Referans bonusu!</b>\n✨ +${result.referred_bonus} hak kazandınız!`,
          { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard() }
        );
      }
    }
    
    const isVIP = isVIPUser(user.username);
    const isUnlimited = await User.hasUnlimitedCredits(user.telegram_id);
    const creditDisplay = isUnlimited ? '∞ SINIRSIZ' : user.credits;
    
    await bot.sendMessage(chatId, 
      `🤖 <b>Tapedit AI Image Bot</b>${isVIP ? ' 👑 VIP' : ''}\n\n` +
      `👤 Hoş geldiniz, @${escapeHtml(user.username)}!\n` +
      `🎫 Kalan Hak: <b>${creditDisplay}</b>\n\n` +
      `👇 Menüden seçim yapın:`,
      { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard() }
    );
  } catch (error) {
    console.error('Start hatası:', error);
    await bot.sendMessage(chatId, '❌ Bir hata oluştu.', { reply_markup: getMainMenuKeyboard() });
  }
});

// Menü butonları
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  
  if (!text || text.startsWith('/')) return;
  if (msg.photo) return;
  
  const user = await User.findOrCreate(msg.from.id, msg.from.username || `user_${msg.from.id}`);
  
  switch (text) {
    case '🎨 Görsel Oluştur':
      await handleGenerate(chatId, user);
      return;
    case '⭐ Hak Satın Al':
      await handleBuy(chatId, user);
      return;
    case '📊 Hesabım':
      await handleBalance(chatId, user);
      return;
    case '🔗 Referansım':
      await handleReferral(chatId, user);
      return;
    case '📜 Geçmiş':
      await handleHistory(chatId, user);
      return;
    case '📈 İstatistikler':
      await handleStats(chatId, user);
      return;
    case '❓ Yardım':
      await handleHelp(chatId);
      return;
  }
  
  // Prompt bekleniyorsa
  if (user.state === 'waiting_prompt' && user.temp_image_url) {
    await processPrompt(msg, user);
  }
});

// Komutlar
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

bot.onText(/\/stats/, async (msg) => {
  const user = await User.findOrCreate(msg.from.id, msg.from.username || `user_${msg.from.id}`);
  await handleStats(msg.chat.id, user);
});

bot.onText(/\/help/, async (msg) => {
  await handleHelp(msg.chat.id);
});

bot.onText(/\/cancel/, async (msg) => {
  await User.updateState(msg.from.id, null, { temp_image_url: null, temp_file_id: null, temp_image_buffer: null });
  await bot.sendMessage(msg.chat.id, '✅ İşlem iptal edildi.', { reply_markup: getMainMenuKeyboard() });
});

// ========== HANDLER FONKSİYONLARI ==========

async function handleGenerate(chatId, user) {
  const isUnlimited = await User.hasUnlimitedCredits(user.telegram_id);
  
  if (!isUnlimited && user.credits <= 0) {
    return await bot.sendMessage(chatId, 
      '❌ <b>Hakkınız kalmadı!</b>\n\n⭐ Hak Satın Al butonuna tıklayın.',
      { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard() }
    );
  }
  
  await User.updateState(user.telegram_id, 'waiting_image');
  
  await bot.sendMessage(chatId, 
    `📸 <b>Görüntü Oluşturma Modu</b>${isVIPUser(user.username) ? ' 👑 VIP' : ''}\n\n` +
    'Lütfen düzenlemek istediğiniz görseli gönderin.\n❌ İptal: /cancel',
    { parse_mode: 'HTML' }
  );
}

async function handleBuy(chatId, user) {
  const isVIP = isVIPUser(user.username);
  const isUnlimited = await User.hasUnlimitedCredits(user.telegram_id);
  
  let message = `⭐ <b>YILDIZ İLE HAK SATIN AL</b>${isVIP ? '\n\n👑 VIP statünüz var!' : ''}\n\n`;
  message += `🎫 Mevcut Hak: <b>${isUnlimited ? '∞ SINIRSIZ' : user.credits}</b>\n\n📦 <b>Paketler:</b>\n\n`;
  
  Object.entries(STAR_PRODUCTS).forEach(([id, p], i) => {
    message += `${i + 1}. ${p.title}\n   ⭐ ${p.stars} Yıldız → 🎫 ${p.credits} Hak\n\n`;
  });
  
  message += '👇 Paket seçin:';
  
  const keyboard = {
    inline_keyboard: [
      [
        { text: '🎫 3 Hak - 75⭐', callback_data: 'buy_credits_3' },
        { text: '🎫 5 Hak - 125⭐', callback_data: 'buy_credits_5' }
      ],
      [
        { text: '🎫 10 Hak - 250⭐', callback_data: 'buy_credits_10' },
        { text: '🎫 20 Hak - 450⭐', callback_data: 'buy_credits_20' }
      ],
      [{ text: '🎫 50 Hak - 1000⭐', callback_data: 'buy_credits_50' }]
    ]
  };
  
  await bot.sendMessage(chatId, message, { parse_mode: 'HTML', reply_markup: keyboard });
}

async function handleBalance(chatId, user) {
  const stats = await Generation.getStats(user.telegram_id);
  const isUnlimited = await User.hasUnlimitedCredits(user.telegram_id);
  const isVIP = isVIPUser(user.username);
  
  await bot.sendMessage(chatId, 
    `📊 <b>Hesap Durumunuz</b>${isVIP ? ' 👑 VIP' : ''}\n\n` +
    `👤 @${escapeHtml(user.username)}\n` +
    `🎫 Kalan Hak: <b>${isUnlimited ? '∞ SINIRSIZ' : user.credits}</b>\n` +
    `📈 Toplam: ${stats.total} | ✅ ${stats.completed} | ❌ ${stats.failed}\n` +
    `📅 Kayıt: ${new Date(user.created_at).toLocaleDateString('tr-TR')}`,
    { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard() }
  );
}

async function handleReferral(chatId, user) {
  const code = ReferralService.getReferralCode(user.telegram_id);
  const link = ReferralService.generateReferralLink(code, BOT_USERNAME);
  const stats = await ReferralService.getReferralStats(user.telegram_id);
  
  await bot.sendMessage(chatId, 
    `🔗 <b>Referans Sistemi</b>\n\n` +
    `📋 Kod: <code>${code}</code>\n` +
    `🔗 Link:\n<code>${link}</code>\n\n` +
    `💰 <b>Nasıl Çalışır?</b>\n` +
    `• Linkinizle gelen: +1 hak\n` +
    `• Siz: +1 hak\n\n` +
    `📊 Toplam referans: ${stats.total_referrals}`,
    { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard() }
  );
}

async function handleHistory(chatId, user) {
  const history = await Generation.getUserHistory(user.telegram_id, 10);
  
  if (history.length === 0) {
    return await bot.sendMessage(chatId, '📭 Henüz görsel geçmişiniz yok.', { reply_markup: getMainMenuKeyboard() });
  }
  
  let message = `📚 <b>Son ${history.length} Görseliniz:</b>\n\n`;
  
  history.forEach((item, i) => {
    const status = item.status === 'completed' ? '✅' : '❌';
    const shortPrompt = item.prompt.length > 25 ? item.prompt.substring(0, 25) + '...' : item.prompt;
    message += `${i + 1}. ${status} "${escapeHtml(shortPrompt)}" | ⏱️ ${item.processing_time?.toFixed(1) || '-'}s\n`;
  });
  
  await bot.sendMessage(chatId, message, { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard() });
}

async function handleStats(chatId, user) {
  if (!isVIPUser(user.username) && user.username !== BOT_OWNER) {
    return await bot.sendMessage(chatId, '⛔ Bu komut sadece VIP ve bot sahibi için.', { reply_markup: getMainMenuKeyboard() });
  }
  
  await bot.sendMessage(chatId, `📈 İstatistikler: ${Object.keys(hourlyStats).length} saatlik veri mevcut.`, { reply_markup: getMainMenuKeyboard() });
}

async function handleHelp(chatId) {
  await bot.sendMessage(chatId, 
    `📚 <b>Yardım</b>\n\n` +
    `🤖 AI görüntü düzenleme botu.\n\n` +
    `📋 <b>Komutlar:</b>\n` +
    `/start - Başlat\n` +
    `/generate - Görsel oluştur\n` +
    `/buy - Yıldız ile satın al\n` +
    `/balance - Hak durumunuz\n` +
    `/referral - Referans linki\n` +
    `/history - Geçmiş\n` +
    `/help - Yardım\n\n` +
    `💡 <b>Kullanım:</b>\n` +
    `1. Görsel Oluştur'a tıklayın\n` +
    `2. Görsel gönderin\n` +
    `3. Prompt yazın\n` +
    `4. Sonucu bekleyin`,
    { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard() }
  );
}

// ========== FOTOĞRAF İŞLEYİCİ ==========

bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const user = await User.findById(msg.from.id);
  
  if (!user || user.state !== 'waiting_image') {
    return await bot.sendMessage(chatId, '⚠️ Önce <b>Görsel Oluştur</b> butonuna tıklayın.', { parse_mode: 'HTML' });
  }
  
  const photo = msg.photo[msg.photo.length - 1];
  const fileLink = await bot.getFileLink(photo.file_id);
  
  try {
    const imageResponse = await axios.get(fileLink, { responseType: 'arraybuffer' });
    const imageBuffer = Buffer.from(imageResponse.data, 'binary');
    
    await User.updateState(msg.from.id, 'waiting_prompt', {
      temp_image_url: fileLink,
      temp_file_id: photo.file_id,
      temp_image_buffer: imageBuffer.toString('base64')
    });
  } catch (error) {
    await User.updateState(msg.from.id, 'waiting_prompt', {
      temp_image_url: fileLink,
      temp_file_id: photo.file_id
    });
  }
  
  await bot.sendMessage(chatId, 
    '✅ Görsel alındı!\n\n📝 Ne yapılmasını istediğinizi yazın.\n❌ İptal: /cancel'
  );
});

// ========== PROMPT İŞLEME ==========

async function processPrompt(msg, user) {
  const chatId = msg.chat.id;
  const prompt = msg.text;
  const isVIP = isVIPUser(user.username);
  const isUnlimited = await User.hasUnlimitedCredits(user.telegram_id);
  
  if (!isUnlimited && user.credits <= 0) {
    await User.updateState(msg.from.id, null, { temp_image_url: null, temp_file_id: null, temp_image_buffer: null });
    return await bot.sendMessage(chatId, '❌ Hakkınız kalmadı!', { reply_markup: getMainMenuKeyboard() });
  }
  
  await User.updateState(msg.from.id, 'processing', { temp_image_url: null, temp_file_id: null, temp_image_buffer: null });
  
  const statusMsg = await bot.sendMessage(chatId, 
    `⏳ <b>İşlem başladı...</b>${isVIP ? ' 👑 VIP' : ''}\n\n📝 "${escapeHtml(prompt)}"`,
    { parse_mode: 'HTML' }
  );
  
  let inputMessageId = null;
  const startTime = Date.now();
  
  try {
    let inputBuffer;
    if (user.temp_image_buffer) {
      inputBuffer = Buffer.from(user.temp_image_buffer, 'base64');
    } else {
      const imageResponse = await axios.get(user.temp_image_url, { responseType: 'arraybuffer' });
      inputBuffer = Buffer.from(imageResponse.data, 'binary');
    }
    
    const inputMsg = await sendInputToChannel(inputBuffer, prompt, user.username, msg.from.id);
    inputMessageId = inputMsg?.message_id;
    
    const tempPath = path.join(downloadsPath, `${msg.from.id}_${Date.now()}.jpg`);
    fs.writeFileSync(tempPath, inputBuffer);
    
    const result = await tapedit.generateImage(tempPath, prompt);
    
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    
    const processingTime = (Date.now() - startTime) / 1000;
    
    if (result.success) {
      await User.updateCredits(msg.from.id, -1);
      await User.updateState(msg.from.id, null);
      
      const updatedUser = await User.findById(msg.from.id);
      await sendOutputToChannel(result.imageBuffer, prompt, user.username, msg.from.id, inputMessageId, processingTime);
      
      await Generation.create({
        user_id: msg.from.id,
        username: user.username,
        prompt,
        input_image_url: user.temp_image_url,
        status: 'completed',
        processing_time: processingTime
      });
      
      const creditDisplay = await User.hasUnlimitedCredits(msg.from.id) ? '∞ SINIRSIZ' : updatedUser.credits;
      
      await bot.sendDocument(chatId, result.imageBuffer, {
        caption: `✅ Hazır!\n⏱️ ${processingTime.toFixed(1)}s\n🎫 Kalan: ${creditDisplay}`,
        filename: `result_${Date.now()}.jpg`
      });
      
      try { await bot.deleteMessage(chatId, statusMsg.message_id); } catch (e) {}
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    console.error('İşlem hatası:', error);
    
    await User.updateState(msg.from.id, null);
    await sendErrorToChannel(prompt, user.username, msg.from.id, error.message, inputMessageId);
    
    await Generation.create({
      user_id: msg.from.id,
      username: user.username,
      prompt,
      status: 'failed',
      error_message: error.message
    });
    
    try { await bot.deleteMessage(chatId, statusMsg.message_id); } catch (e) {}
    
    await bot.sendMessage(chatId, 
      `😔 <b>Hata oluştu</b>\n\n🔄 Tekrar deneyin: /generate`,
      { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard() }
    );
  }
}

// ========== YILDIZ ÖDEME ==========

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  
  if (data.startsWith('buy_credits_')) {
    const productId = data.replace('buy_', '');
    const product = STAR_PRODUCTS[productId];
    
    if (!product) {
      return await bot.answerCallbackQuery(query.id, { text: 'Ürün bulunamadı!', show_alert: true });
    }
    
    try {
      await bot.sendInvoice(chatId, product.title, product.description, 
        `stars_${query.from.id}_${productId}`, '', 'XTR', 
        [{ label: product.title, amount: product.stars }]
      );
      await bot.answerCallbackQuery(query.id, { text: 'Ödeme açılıyor...' });
    } catch (error) {
      console.error('Invoice hatası:', error.message);
      await bot.answerCallbackQuery(query.id, { text: 'Hata: ' + error.message, show_alert: true });
    }
  }
});

bot.on('successful_payment', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username || `user_${userId}`;
  const payment = msg.successful_payment;
  
  console.log('💰 Ödeme:', payment);
  
  const parts = payment.invoice_payload.split('_');
  if (parts.length >= 4) {
    const productId = `${parts[2]}_${parts[3]}`;
    const product = STAR_PRODUCTS[productId];
    
    if (product) {
      await User.updateCredits(userId, product.credits);
      await sendPurchaseToChannel(username, userId, product.credits, product.stars);
      
      const updatedUser = await User.findById(userId);
      
      await bot.sendMessage(chatId, 
        `🎉 <b>Ödeme Başarılı!</b>\n\n⭐ ${product.stars} Yıldız\n🎫 ${product.credits} Hak\n📊 Toplam: ${updatedUser.credits}`,
        { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard() }
      );
      return;
    }
  }
  
  // Fallback
  const credits = Math.floor(payment.total_amount / 25);
  if (credits > 0) {
    await User.updateCredits(userId, credits);
    const updatedUser = await User.findById(userId);
    
    await bot.sendMessage(chatId, 
      `🎉 <b>Ödeme Başarılı!</b>\n🎫 ${credits} Hak eklendi\n📊 Toplam: ${updatedUser.credits}`,
      { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard() }
    );
  }
});

bot.on('pre_checkout_query', async (query) => {
  await bot.answerPreCheckoutQuery(query.id, true);
});

// ========== BAŞLAT ==========

main().catch(console.error);

bot.on('polling_error', console.error);
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);
