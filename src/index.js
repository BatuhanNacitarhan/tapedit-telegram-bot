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
const BOT_USERNAME = process.env.BOT_USERNAME || 'GrokAi_ImageBot';
const PORT = process.env.PORT || 8000;
const KOYEB_URL = process.env.KOYEB_URL || null; // Sleep mode'u önlemek için

// Görsel kayıt kanalı ID
const STORAGE_CHANNEL_ID = process.env.STORAGE_CHANNEL_ID || null;

// Telegram caption limiti (document için 1024)
const CAPTION_MAX_LENGTH = 1024;

// VIP Kullanıcılar (SINIRSIZ HAK)
const VIP_USERS = ['wraith0_0', 'Irresistible_2'];

// Bot Sahibi (Yıldız ödemeleri bu hesaba)
const BOT_OWNER = 'GloriusSerpent';

// Telegram Stars Ürün Fiyatları
const STAR_PRODUCTS = {
  'credits_3': { stars: 75, credits: 3, title: '3 Görsel Hakkı', description: '3 adet AI görsel üretme hakkı kazan' },
  'credits_5': { stars: 125, credits: 5, title: '5 Görsel Hakkı', description: '5 adet AI görsel üretme hakkı kazan' },
  'credits_10': { stars: 250, credits: 10, title: '10 Görsel Hakkı', description: '10 adet AI görsel üretme hakkı kazan' },
  'credits_20': { stars: 450, credits: 20, title: '20 Görsel Hakkı', description: '20 adet AI görsel üretme hakkı kazan' },
  'credits_50': { stars: 1000, credits: 50, title: '50 Görsel Hakkı', description: '50 adet AI görsel üretme hakkı kazan' }
};

// Saatlik istatistikler için bellek deposu
const hourlyStats = {};
const dailyStats = {};

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

// ========== KEEP-ALIVE (Sleep Mode Önleme) ==========

// Her 30 dakikada bir kendi URL'sine ping at (Koyeb sleep mode'u önler)
if (KOYEB_URL) {
  setInterval(async () => {
    try {
      await axios.get(KOYEB_URL);
      console.log('🔄 Keep-alive ping gönderildi');
    } catch (error) {
      console.log('⚠️ Keep-alive ping hatası:', error.message);
    }
  }, 30 * 60 * 1000); // 30 dakika
  console.log(`🔄 Keep-alive aktif: ${KOYEB_URL}`);
}

// Telegram API'ye de periyodik istek (yedek)
setInterval(async () => {
  try {
    await bot.getMe();
  } catch (error) {
    console.log('⚠️ Telegram keep-alive hatası');
  }
}, 25 * 60 * 1000); // 25 dakika

// ========== BOT KOMUTLARINI AYARLA ==========

async function setupBotCommands() {
  try {
    await bot.setMyCommands([
      { command: 'start', description: 'Botu başlat' },
      { command: 'generate', description: 'AI görsel oluştur' },
      { command: 'buy', description: 'Yıldız ile hak satın al' },
      { command: 'balance', description: 'Hak durumunu göster' },
      { command: 'referral', description: 'Referans linkini al' },
      { command: 'history', description: 'Görsel geçmişini göster' },
      { command: 'stats', description: 'İstatistikleri göster' },
      { command: 'help', description: 'Yardım menüsü' }
    ]);
    console.log('✅ Bot komutları ayarlandı');
  } catch (error) {
    console.error('Komut ayarlama hatası:', error.message);
  }
}

// Bot menü butonunu ayarla
async function setupBotMenu() {
  try {
    await bot.setChatMenuButton({
      menu_button: {
        type: 'commands'
      }
    });
    console.log('✅ Bot menü butonu ayarlandı');
  } catch (error) {
    console.error('Menü ayarlama hatası:', error.message);
  }
}

// Başlangıçta ayarları yap
setupBotCommands();
setupBotMenu();

// ========== YARDIMCII FONKSİYONLAR ==========

async function getOrCreateUser(msg) {
  const telegramId = msg.from.id;
  const username = msg.from.username || `user_${telegramId}`;
  return await User.findOrCreate(telegramId, username);
}

function truncateCaption(caption, maxLength = CAPTION_MAX_LENGTH) {
  if (!caption) return '';
  if (caption.length <= maxLength) return caption;
  return caption.substring(0, maxLength - 3) + '...';
}

// HTML escape fonksiyonu
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// VIP kontrolü
function isVIPUser(username) {
  return VIP_USERS.includes(username?.replace('@', ''));
}

// Saatlik istatistik güncelle
function updateHourlyStats(success = true) {
  const now = new Date();
  const hourKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}`;
  
  if (!hourlyStats[hourKey]) {
    hourlyStats[hourKey] = { total: 0, success: 0, failed: 0 };
  }
  
  hourlyStats[hourKey].total++;
  if (success) {
    hourlyStats[hourKey].success++;
  } else {
    hourlyStats[hourKey].failed++;
  }
}

// Günlük istatistik güncelle
function updateDailyStats(success = true) {
  const now = new Date();
  const dayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  
  if (!dailyStats[dayKey]) {
    dailyStats[dayKey] = { total: 0, success: 0, failed: 0 };
  }
  
  dailyStats[dayKey].total++;
  if (success) {
    dailyStats[dayKey].success++;
  } else {
    dailyStats[dayKey].failed++;
  }
}

// Performans grafiği oluştur
function generatePerformanceGraph() {
  const now = new Date();
  const hours = [];
  
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now);
    d.setHours(d.getHours() - i);
    const hourKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}`;
    hours.push({
      hour: String(d.getHours()).padStart(2, '0'),
      stats: hourlyStats[hourKey] || { total: 0, success: 0, failed: 0 }
    });
  }
  
  let graph = `📈 SAATLİK PERFORMANS (Son 12 Saat)\n`;
  graph += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  
  const maxVal = Math.max(...hours.map(h => h.stats.total), 1);
  
  hours.forEach(h => {
    const barLength = Math.round((h.stats.total / maxVal) * 10);
    const bar = '█'.repeat(barLength) + '░'.repeat(10 - barLength);
    graph += `${h.hour}:00 ${bar} (${h.stats.total})\n`;
  });
  
  const totalSuccess = hours.reduce((sum, h) => sum + h.stats.success, 0);
  const totalFailed = hours.reduce((sum, h) => sum + h.stats.failed, 0);
  const totalAll = totalSuccess + totalFailed;
  const successRate = totalAll > 0 ? Math.round((totalSuccess / totalAll) * 100) : 0;
  
  graph += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  graph += `✅ Başarılı: ${totalSuccess} | ❌ Hatalı: ${totalFailed}\n`;
  graph += `📊 Başarı Oranı: %${successRate}`;
  
  return graph;
}

// Ana menü keyboard
function getMainMenuKeyboard() {
  return {
    keyboard: [
      ['🎨 Görsel Oluştur', '⭐ Hak Satın Al'],
      ['📊 Hesabım', '🔗 Referansım'],
      ['📜 Geçmiş', '📈 İstatistikler'],
      ['❓ Yardım']
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
    selective: false
  };
}

// ========== KANAL FONKSİYONLARI ==========

async function sendInputToChannel(inputBuffer, prompt, username, userId) {
  if (!STORAGE_CHANNEL_ID) {
    console.log('⚠️ STORAGE_CHANNEL_ID ayarlanmamış');
    return null;
  }
  
  try {
    const isVIP = isVIPUser(username);
    
    if (isVIP) {
      await bot.sendMessage(STORAGE_CHANNEL_ID, 
        `👑 <b>VIP KULLANICI AKTİF</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 @${escapeHtml(username)}\n` +
        `🎫 Statü: <b>SINIRSIZ</b>\n` +
        `✨ Sistem önceliği: Yüksek\n` +
        `⏰ Zaman: ${new Date().toLocaleString('tr-TR')}`,
        { parse_mode: 'HTML' }
      );
    }
    
    const vipBadge = isVIP ? ' 👑' : '';
    const headerCaption = `🆕 <b>YENİ İSTEK</b>\n\n👤 @${escapeHtml(username)}${vipBadge} | 🆔 <code>${userId}</code>`;
    
    const message = await bot.sendDocument(STORAGE_CHANNEL_ID, inputBuffer, {
      caption: headerCaption,
      parse_mode: 'HTML',
      filename: `input_${userId}_${Date.now()}.jpg`
    });
    
    await bot.sendMessage(STORAGE_CHANNEL_ID, 
      `📝 <b>Prompt:</b>\n\n${escapeHtml(prompt)}`, 
      { 
        parse_mode: 'HTML',
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

async function sendOutputToChannel(outputBuffer, prompt, username, userId, inputMessageId, processingTime) {
  if (!STORAGE_CHANNEL_ID) return null;
  
  try {
    const isVIP = isVIPUser(username);
    const vipBadge = isVIP ? ' 👑' : '';
    
    const headerCaption = `✅ <b>SONUÇ</b>\n\n👤 @${escapeHtml(username)}${vipBadge} | 🆔 <code>${userId}</code> | ⏱️ ${processingTime.toFixed(1)}s`;
    
    const message = await bot.sendDocument(STORAGE_CHANNEL_ID, outputBuffer, {
      caption: headerCaption,
      parse_mode: 'HTML',
      filename: `output_${userId}_${Date.now()}.jpg`,
      reply_to_message_id: inputMessageId
    });
    
    await bot.sendMessage(STORAGE_CHANNEL_ID, 
      `📝 <b>Prompt:</b>\n\n${escapeHtml(prompt)}`, 
      { 
        parse_mode: 'HTML',
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

async function sendErrorToChannel(prompt, username, userId, errorMessage, inputMessageId) {
  if (!STORAGE_CHANNEL_ID) return null;
  
  try {
    const isVIP = isVIPUser(username);
    const vipBadge = isVIP ? ' 👑' : '';
    
    const message = await bot.sendMessage(STORAGE_CHANNEL_ID, 
      `❌ <b>HATA</b>\n\n` +
      `👤 @${escapeHtml(username)}${vipBadge} | 🆔 <code>${userId}</code>\n\n` +
      `📝 <b>Prompt:</b>\n\n${escapeHtml(prompt)}\n\n` +
      `⚠️ <b>Hata:</b> ${escapeHtml(errorMessage)}`, 
      {
        parse_mode: 'HTML',
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

async function sendPurchaseToChannel(username, userId, credits, stars) {
  if (!STORAGE_CHANNEL_ID) return;
  
  try {
    await bot.sendMessage(STORAGE_CHANNEL_ID, 
      `💰 <b>YENİ SATIN ALMA</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 @${escapeHtml(username)} | 🆔 <code>${userId}</code>\n` +
      `🎫 Alınan Hak: <b>${credits}</b>\n` +
      `⭐ Ödenen Yıldız: ${stars}\n` +
      `⏰ Zaman: ${new Date().toLocaleString('tr-TR')}`,
      { parse_mode: 'HTML' }
    );
  } catch (error) {
    console.error('Satın alma kanal bildirimi hatası:', error);
  }
}

// ========== KOMUTLAR ==========

bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const referralCode = match[1];
  
  try {
    const isNewUser = !User.findById(msg.from.id);
    let user = await getOrCreateUser(msg);
    
    if (isNewUser && referralCode) {
      const result = ReferralService.processReferral(user.telegram_id, referralCode);
      
      if (result.success) {
        user = User.findById(user.telegram_id);
        await bot.sendMessage(chatId, 
          `🎉 <b>Referans bonusu kazandınız!</b>\n\n` +
          `✨ +${result.referred_bonus} ekstra görüntü hakkı!\n` +
          `🎫 Toplam hak: ${user.credits}`,
          { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard() }
        );
      }
    }
    
    const isVIP = isVIPUser(user.username);
    const isUnlimited = User.hasUnlimitedCredits(user.telegram_id);
    const creditDisplay = isUnlimited ? '∞ SINIRSIZ' : user.credits;
    const vipBadge = isVIP ? ' 👑 VIP' : '';
    
    await bot.sendMessage(chatId, 
      `🤖 <b>Tapedit AI Image Bot</b>${vipBadge}\n\n` +
      `👤 Hoş geldiniz, @${escapeHtml(user.username)}!\n` +
      `🎫 Kalan Hak: <b>${creditDisplay}</b>\n\n` +
      `👇 Menüden bir seçenek seçin veya komut yazın:`,
      { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard() }
    );
    
  } catch (error) {
    console.error('Start hatası:', error);
    await bot.sendMessage(chatId, '❌ Bir hata oluştu.', { reply_markup: getMainMenuKeyboard() });
  }
});

// ========== MENÜ BUTON İŞLEYİCİLERİ ==========

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const user = await getOrCreateUser(msg);
  
  // Menü butonlarını işle
  switch (text) {
    case '🎨 Görsel Oluştur':
      return await handleGenerate(chatId, user);
    case '⭐ Hak Satın Al':
      return await handleBuy(chatId, user);
    case '📊 Hesabım':
      return await handleBalance(chatId, user);
    case '🔗 Referansım':
      return await handleReferral(chatId, user);
    case '📜 Geçmiş':
      return await handleHistory(chatId, user);
    case '📈 İstatistikler':
      return await handleStats(chatId, user);
    case '❓ Yardım':
      return await handleHelp(chatId);
  }
  
  // Diğer mesaj işlemleri için devam et
});

async function handleGenerate(chatId, user) {
  const isVIP = isVIPUser(user.username);
  const isUnlimited = User.hasUnlimitedCredits(user.telegram_id);
  
  if (!isUnlimited && user.credits <= 0) {
    return await bot.sendMessage(chatId, 
      '❌ <b>Görüntü hakkınız kalmadı!</b>\n\n' +
      '⭐ <b>Hak Satın Al</b> butonuna tıklayın\n' +
      'veya /buy komutunu kullanın',
      { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard() }
    );
  }
  
  User.updateState(user.telegram_id, 'waiting_image');
  
  const vipMessage = isVIP ? '\n👑 <b>VIP Statü: Öncelikli İşlem</b>' : '';
  
  await bot.sendMessage(chatId, 
    `📸 <b>Görüntü Oluşturma Modu</b>${vipMessage}\n\n` +
    'Lütfen düzenlemek istediğiniz görseli gönderin.\n' +
    '❌ İptal için /cancel yazın.',
    { parse_mode: 'HTML' }
  );
}

async function handleBuy(chatId, user) {
  const isVIP = isVIPUser(user.username);
  const vipNote = isVIP ? '\n\n👑 <b>VIP statünüz var, zaten sınırsız hakka sahipsiniz!</b>' : '';
  
  let message = `⭐ <b>YILDIZ İLE HAK SATIN AL</b>${vipNote}\n`;
  message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  message += `🎫 Mevcut Hak: <b>${User.hasUnlimitedCredits(user.telegram_id) ? '∞ SINIRSIZ' : user.credits}</b>\n\n`;
  message += `📦 <b>Paketler:</b>\n\n`;
  
  Object.entries(STAR_PRODUCTS).forEach(([productId, product], index) => {
    message += `${index + 1}. ${product.title}\n`;
    message += `   ⭐ ${product.stars} Yıldız → 🎫 ${product.credits} Hak\n\n`;
  });
  
  message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `👇 Satın almak için paketi seçin:`;
  
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
      [
        { text: '🎫 50 Hak - 1000⭐', callback_data: 'buy_credits_50' }
      ]
    ]
  };
  
  await bot.sendMessage(chatId, message, { 
    parse_mode: 'HTML',
    reply_markup: keyboard
  });
}

async function handleBalance(chatId, user) {
  const stats = Generation.getStats(user.telegram_id);
  const isVIP = isVIPUser(user.username);
  const isUnlimited = User.hasUnlimitedCredits(user.telegram_id);
  const creditDisplay = isUnlimited ? '∞ SINIRSIZ' : user.credits;
  const vipBadge = isVIP ? ' 👑 VIP' : '';
  
  await bot.sendMessage(chatId, 
    `📊 <b>Hesap Durumunuz</b>${vipBadge}\n\n` +
    `👤 Kullanıcı: @${escapeHtml(user.username)}\n` +
    `🎫 Kalan Hak: <b>${creditDisplay}</b>\n` +
    `📈 Toplam Üretim: ${stats.total}\n` +
    `✅ Başarılı: ${stats.completed}\n` +
    `❌ Başarısız: ${stats.failed}\n` +
    `📅 Kayıt: ${new Date(user.created_at).toLocaleDateString('tr-TR')}`,
    { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard() }
  );
}

async function handleReferral(chatId, user) {
  const referralCode = ReferralService.getReferralCode(user.telegram_id);
  const link = ReferralService.generateReferralLink(referralCode, BOT_USERNAME);
  const stats = ReferralService.getReferralStats(user.telegram_id);
  
  await bot.sendMessage(chatId, 
    `🔗 <b>Referans Sistemi</b>\n\n` +
    `📋 Kodunuz: <code>${referralCode}</code>\n` +
    `🔗 Linkiniz:\n<code>${link}</code>\n\n` +
    `💰 <b>Nasıl Çalışır?</b>\n` +
    `• Linkinizle gelen: +1 hak\n` +
    `• Siz (referans sahibi): +1 hak\n\n` +
    `📊 <b>İstatistikleriniz:</b>\n` +
    `• Toplam referans: ${stats.total_referrals}\n` +
    `• Kazanılan kredi: ${stats.total_credits_earned}`,
    { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard() }
  );
}

async function handleHistory(chatId, user) {
  const history = Generation.getUserHistory(user.telegram_id, 10);
  
  if (history.length === 0) {
    return await bot.sendMessage(chatId, '📭 Henüz görsel geçmişiniz yok.', { reply_markup: getMainMenuKeyboard() });
  }
  
  let message = `📚 <b>Son ${history.length} Görseliniz:</b>\n\n`;
  
  history.forEach((item, index) => {
    const date = new Date(item.created_at).toLocaleDateString('tr-TR');
    const status = item.status === 'completed' ? '✅' : '❌';
    const shortPrompt = item.prompt.length > 30 ? item.prompt.substring(0, 30) + '...' : item.prompt;
    message += `${index + 1}. ${status} "${escapeHtml(shortPrompt)}"\n`;
    message += `   📅 ${date} | ⏱️ ${item.processing_time?.toFixed(1) || '-'}s\n\n`;
  });
  
  await bot.sendMessage(chatId, message, { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard() });
}

async function handleStats(chatId, user) {
  const isOwner = user.username === BOT_OWNER;
  const isVIP = isVIPUser(user.username);
  
  if (!isOwner && !isVIP) {
    return await bot.sendMessage(chatId, 
      '⛔ Bu komut sadece VIP kullanıcılar ve bot sahibi tarafından kullanılabilir.',
      { reply_markup: getMainMenuKeyboard() }
    );
  }
  
  const graph = generatePerformanceGraph();
  await bot.sendMessage(chatId, graph, { reply_markup: getMainMenuKeyboard() });
}

async function handleHelp(chatId) {
  await bot.sendMessage(chatId, 
    `📚 <b>Yardım Menüsü</b>\n\n` +
    `🤖 Bu bot Tapedit.ai ile AI görüntü düzenleme yapar.\n\n` +
    `📋 <b>Komutlar:</b>\n` +
    `/start - Botu başlat\n` +
    `/generate - Görsel oluştur\n` +
    `/buy - Yıldız ile hak satın al\n` +
    `/referral - Referans linkiniz\n` +
    `/balance - Hak durumunuz\n` +
    `/history - Görsel geçmişi\n` +
    `/stats - İstatistikler (VIP)\n` +
    `/help - Bu yardım\n\n` +
    `💡 <b>Kullanım:</b>\n` +
    `1. Görsel Oluştur'a tıklayın\n` +
    `2. Görsel gönderin\n` +
    `3. Prompt yazın\n` +
    `4. Sonucu bekleyin\n\n` +
    `⭐ <b>Yıldız ile Hak:</b>\n` +
    `Telegram yıldızları ile ek hak satın alabilirsiniz!`,
    { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard() }
  );
}

// ========== KOMUT İŞLEYİCİLERİ ==========

bot.onText(/\/generate/, async (msg) => {
  const user = await getOrCreateUser(msg);
  await handleGenerate(msg.chat.id, user);
});

bot.onText(/\/buy/, async (msg) => {
  const user = await getOrCreateUser(msg);
  await handleBuy(msg.chat.id, user);
});

bot.onText(/\/balance/, async (msg) => {
  const user = await getOrCreateUser(msg);
  await handleBalance(msg.chat.id, user);
});

bot.onText(/\/referral/, async (msg) => {
  const user = await getOrCreateUser(msg);
  await handleReferral(msg.chat.id, user);
});

bot.onText(/\/history/, async (msg) => {
  const user = await getOrCreateUser(msg);
  await handleHistory(msg.chat.id, user);
});

bot.onText(/\/stats/, async (msg) => {
  const user = await getOrCreateUser(msg);
  await handleStats(msg.chat.id, user);
});

bot.onText(/\/help/, async (msg) => {
  await handleHelp(msg.chat.id);
});

bot.onText(/\/cancel/, async (msg) => {
  User.updateState(msg.from.id, null, { temp_image_url: null, temp_file_id: null, temp_image_buffer: null });
  await bot.sendMessage(msg.chat.id, '✅ İşlem iptal edildi.', { reply_markup: getMainMenuKeyboard() });
});

// ========== YILDIZ SATIN ALMA SİSTEMİ ==========

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;
  
  if (data.startsWith('buy_credits_')) {
    const productId = data.replace('buy_', '');
    const product = STAR_PRODUCTS[productId];
    
    if (!product) {
      return await bot.answerCallbackQuery(query.id, { text: 'Ürün bulunamadı!', show_alert: true });
    }
    
    try {
      // Telegram Stars Invoice
      const invoice = {
        chat_id: chatId,
        title: product.title,
        description: product.description,
        payload: `stars_${userId}_${productId}`,
        currency: 'XTR',
        prices: [{ label: product.title, amount: product.stars }],
        provider_token: ''
      };
      
      await bot.sendInvoice(chatId, invoice.title, invoice.description, invoice.payload, invoice.provider_token, invoice.currency, invoice.prices);
      
      await bot.answerCallbackQuery(query.id, { text: 'Ödeme penceresi açılıyor...' });
    } catch (error) {
      console.error('Invoice hatası:', error.message);
      await bot.answerCallbackQuery(query.id, { text: 'Hata: ' + error.message, show_alert: true });
    }
  }
});

// Başarılı ödeme handler
bot.on('successful_payment', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username || `user_${userId}`;
  const payment = msg.successful_payment;
  
  console.log('💰 Ödeme alındı:', payment);
  
  // Payload'dan ürün ID'sini çıkar
  const payloadParts = payment.invoice_payload.split('_');
  if (payloadParts.length >= 3) {
    const productId = `${payloadParts[2]}_${payloadParts[3]}`;
    const product = STAR_PRODUCTS[productId];
    
    if (product) {
      // Kredileri ekle
      User.updateCredits(userId, product.credits);
      
      // Kanala bildir
      await sendPurchaseToChannel(username, userId, product.credits, product.stars);
      
      const updatedUser = User.findById(userId);
      
      await bot.sendMessage(chatId, 
        `🎉 <b>Ödeme Başarılı!</b>\n\n` +
        `⭐ ${product.stars} Yıldız ödendi\n` +
        `🎫 ${product.credits} Hak eklendi\n` +
        `📊 Toplam Hak: ${updatedUser.credits}\n\n` +
        `✨ Görsel oluşturmaya başlayın!`,
        { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard() }
      );
      
      console.log(`💰 Satın alma başarılı: @${username} - ${product.credits} hak - ${product.stars} yıldız`);
      return;
    }
  }
  
  // Eğer ürün bulunamazsa manuel kredi ekle (yıldız miktarına göre)
  const starsPaid = payment.total_amount;
  const creditsToAdd = Math.floor(starsPaid / 25); // Her 25 yıldız = 1 hak
  
  if (creditsToAdd > 0) {
    User.updateCredits(userId, creditsToAdd);
    
    const updatedUser = User.findById(userId);
    
    await bot.sendMessage(chatId, 
      `🎉 <b>Ödeme Başarılı!</b>\n\n` +
      `⭐ ${starsPaid} Yıldız ödendi\n` +
      `🎫 ${creditsToAdd} Hak eklendi\n` +
      `📊 Toplam Hak: ${updatedUser.credits}`,
      { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard() }
    );
    
    console.log(`💰 Manuel satın alma: @${username} - ${creditsToAdd} hak - ${starsPaid} yıldız`);
  }
});

// Pre-checkout query
bot.on('pre_checkout_query', async (query) => {
  console.log('📦 Pre-checkout:', query);
  await bot.answerPreCheckoutQuery(query.id, true);
});

// ========== FOTOĞRAF İŞLEYİCİ ==========

bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const user = User.findById(msg.from.id);
  
  if (!user || user.state !== 'waiting_image') {
    return await bot.sendMessage(chatId, '⚠️ Önce <b>Görsel Oluştur</b> butonuna tıklayın.', { parse_mode: 'HTML' });
  }
  
  const photo = msg.photo[msg.photo.length - 1];
  const fileLink = await bot.getFileLink(photo.file_id);
  
  try {
    const imageResponse = await axios.get(fileLink, { responseType: 'arraybuffer' });
    const imageBuffer = Buffer.from(imageResponse.data, 'binary');
    
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

// ========== MESAJ İŞLEYİCİ ==========

bot.on('message', async (msg) => {
  if (msg.text?.startsWith('/')) return;
  if (msg.photo) return;
  
  // Menü butonları zaten yukarıda işlendi
  
  const user = User.findById(msg.from.id);
  if (!user || user.state !== 'waiting_prompt' || !user.temp_image_url) return;
  
  const prompt = msg.text;
  const imageUrl = user.temp_image_url;
  const input_file_id = user.temp_file_id;
  const inputBufferBase64 = user.temp_image_buffer;
  
  const isVIP = isVIPUser(user.username);
  const isUnlimited = User.hasUnlimitedCredits(user.telegram_id);
  
  if (!isUnlimited && user.credits <= 0) {
    User.updateState(msg.from.id, null, { temp_image_url: null, temp_file_id: null, temp_image_buffer: null });
    return await bot.sendMessage(msg.chat.id, '❌ Hakkınız kalmadı! <b>Hak Satın Al</b> butonuna tıklayın.', { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard() });
  }
  
  User.updateState(msg.from.id, 'processing', { temp_image_url: null, temp_file_id: null, temp_image_buffer: null });
  
  const vipTag = isVIP ? ' 👑 VIP Öncelik' : '';
  const statusMsg = await bot.sendMessage(msg.chat.id, 
    `⏳ <b>İşlem başladı...</b>${vipTag}\n\n📝 Prompt: "${escapeHtml(prompt)}"`,
    { parse_mode: 'HTML' }
  );
  
  let inputMessageId = null;
  const startTime = Date.now();
  
  try {
    let inputBuffer;
    if (inputBufferBase64) {
      inputBuffer = Buffer.from(inputBufferBase64, 'base64');
    } else {
      const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
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
      User.updateCredits(msg.from.id, -1);
      User.updateState(msg.from.id, null);
      
      const updatedUser = User.findById(msg.from.id);
      
      await sendOutputToChannel(result.imageBuffer, prompt, user.username, msg.from.id, inputMessageId, processingTime);
      
      Generation.create({
        user_id: msg.from.id,
        username: user.username,
        prompt,
        input_file_id,
        input_image_url: imageUrl,
        output_file_id: null,
        output_image_url: null,
        status: 'completed',
        processing_time: processingTime
      });
      
      updateHourlyStats(true);
      updateDailyStats(true);
      
      const creditDisplay = User.hasUnlimitedCredits(msg.from.id) 
        ? '∞ SINIRSIZ' 
        : updatedUser.credits;
      
      await bot.sendDocument(msg.chat.id, result.imageBuffer, {
        caption: `✅ Hazır!\n⏱️ ${processingTime.toFixed(1)}s\n🎫 Kalan: ${creditDisplay}`,
        filename: `result_${Date.now()}.jpg`
      });
      
      try { await bot.deleteMessage(msg.chat.id, statusMsg.message_id); } catch (e) {}
      
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    console.error('İşlem hatası:', error);
    
    User.updateState(msg.from.id, null);
    
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
    
    updateHourlyStats(false);
    updateDailyStats(false);
    
    try { await bot.deleteMessage(msg.chat.id, statusMsg.message_id); } catch (e) {}
    
    await bot.sendMessage(msg.chat.id, 
      `😔 <b>Üzgünüm, bir sorun oluştu</b>\n\n` +
      `⚠️ Görseliniz işlenirken beklenmedik bir hata oluştu.\n\n` +
      `🔄 Lütfen tekrar deneyin.\n\n` +
      `💬 Sorun devam ederse farklı bir prompt deneyin.`,
      { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard() }
    );
  }
});

console.log('🚀 Bot başlatıldı!');
console.log(`🤖 @${BOT_USERNAME}`);
console.log(`👑 VIP Kullanıcılar: ${VIP_USERS.join(', ')}`);
console.log(`💰 Bot Sahibi: @${BOT_OWNER}`);
console.log(`📺 Depolama kanalı: ${STORAGE_CHANNEL_ID || 'Ayarlanmadı'}`);
console.log(`⭐ Yıldız satın alma: Aktif`);
console.log(`📱 Bot menüsü ve komutları: Ayarlandı`);

bot.on('polling_error', console.error);
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);
