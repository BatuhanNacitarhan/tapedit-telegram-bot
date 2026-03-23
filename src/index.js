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
  'credits_3': { stars: 10, credits: 3, title: '3 Görsel Hakkı', description: '3 adet AI görsel üretme hakkı' },
  'credits_5': { stars: 15, credits: 5, title: '5 Görsel Hakkı', description: '5 adet AI görsel üretme hakkı' },
  'credits_10': { stars: 25, credits: 10, title: '10 Görsel Hakkı', description: '10 adet AI görsel üretme hakkı' },
  'credits_20': { stars: 45, credits: 20, title: '20 Görsel Hakkı', description: '20 adet AI görsel üretme hakkı' },
  'credits_50': { stars: 100, credits: 50, title: '50 Görsel Hakkı', description: '50 adet AI görsel üretme hakkı' }
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

// Performans grafiği oluştur (ASCII)
function generatePerformanceGraph() {
  const now = new Date();
  const hours = [];
  
  // Son 12 saati al
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

// ========== KANAL FONKSİYONLARI ==========

// Input görseli kanala gönder
async function sendInputToChannel(inputBuffer, prompt, username, userId) {
  if (!STORAGE_CHANNEL_ID) {
    console.log('⚠️ STORAGE_CHANNEL_ID ayarlanmamış');
    return null;
  }
  
  try {
    // VIP kontrolü
    const isVIP = isVIPUser(username);
    
    // VIP kullanıcı bildirimi
    if (isVIP) {
      await bot.sendMessage(STORAGE_CHANNEL_ID, 
        `👑 *VIP KULLANICI AKTİF*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 @${username}\n` +
        `🎫 Statü: *SINIRSIZ*\n` +
        `✨ Sistem önceliği: Yüksek\n` +
        `⏰ Zaman: ${new Date().toLocaleString('tr-TR')}`,
        { parse_mode: 'Markdown' }
      );
    }
    
    // Görseli minimal caption ile gönder
    const headerCaption = `🆕 *YENİ İSTEK*\n\n👤 @${username}${isVIP ? ' 👑' : ''} | 🆔 \`${userId}\``;
    
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

// Output görseli kanala gönder
async function sendOutputToChannel(outputBuffer, prompt, username, userId, inputMessageId, processingTime) {
  if (!STORAGE_CHANNEL_ID) return null;
  
  try {
    const isVIP = isVIPUser(username);
    
    // Görseli minimal caption ile gönder
    const headerCaption = `✅ *SONUÇ*\n\n👤 @${username}${isVIP ? ' 👑' : ''} | 🆔 \`${userId}\` | ⏱️ ${processingTime.toFixed(1)}s`;
    
    const message = await bot.sendDocument(STORAGE_CHANNEL_ID, outputBuffer, {
      caption: headerCaption,
      parse_mode: 'Markdown',
      filename: `output_${userId}_${Date.now()}.jpg`,
      reply_to_message_id: inputMessageId
    });
    
    // Prompt'u ayrı mesaj olarak gönder
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

// Hata durumunda kanala bilgi gönder
async function sendErrorToChannel(prompt, username, userId, errorMessage, inputMessageId) {
  if (!STORAGE_CHANNEL_ID) return null;
  
  try {
    const isVIP = isVIPUser(username);
    
    const message = await bot.sendMessage(STORAGE_CHANNEL_ID, 
      `❌ *HATA*\n\n` +
      `👤 @${username}${isVIP ? ' 👑' : ''} | 🆔 \`${userId}\`\n\n` +
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

// Satın alma başarılı kanal bildirimi
async function sendPurchaseToChannel(username, userId, credits, stars) {
  if (!STORAGE_CHANNEL_ID) return;
  
  try {
    await bot.sendMessage(STORAGE_CHANNEL_ID, 
      `💰 *YENİ SATIN ALMA*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 @${username} | 🆔 \`${userId}\`\n` +
      `🎫 Alınan Hak: *${credits}*\n` +
      `⭐ Ödenen Yıldız: ${stars}\n` +
      `⏰ Zaman: ${new Date().toLocaleString('tr-TR')}`,
      { parse_mode: 'Markdown' }
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
          `🎉 *Referans bonusu kazandınız!*\n\n` +
          `✨ +${result.referred_bonus} ekstra görüntü hakkı!\n` +
          `🎫 Toplam hak: ${user.credits}`,
          { parse_mode: 'Markdown' }
        );
      }
    }
    
    const isVIP = isVIPUser(user.username);
    const isUnlimited = User.hasUnlimitedCredits(user.telegram_id);
    const creditDisplay = isUnlimited ? '∞ SINIRSIZ' : user.credits;
    const vipBadge = isVIP ? ' 👑 VIP' : '';
    
    await bot.sendMessage(chatId, 
      `🤖 *Tapedit AI Image Bot*${vipBadge}\n\n` +
      `👤 Hoş geldiniz, @${user.username}!\n` +
      `🎫 Kalan Hak: *${creditDisplay}*\n\n` +
      `📋 *Komutlar:*\n` +
      `/generate - Görsel oluştur\n` +
      `/buy - Yıldız ile hak satın al\n` +
      `/referral - Referans linkiniz\n` +
      `/balance - Hak durumunuz\n` +
      `/history - Görsel geçmişi\n` +
      `/stats - İstatistikler\n` +
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
  
  const isVIP = isVIPUser(user.username);
  const isUnlimited = User.hasUnlimitedCredits(user.telegram_id);
  
  if (!isUnlimited && user.credits <= 0) {
    return await bot.sendMessage(chatId, 
      '❌ *Görüntü hakkınız kalmadı!*\n\n' +
      '🔗 /buy ile yıldız kullanarak hak satın alın\n' +
      ' veya /referral ile hak kazanın',
      { parse_mode: 'Markdown' }
    );
  }
  
  User.updateState(user.telegram_id, 'waiting_image');
  
  const vipMessage = isVIP ? '\n👑 *VIP Statü: Öncelikli İşlem*' : '';
  
  await bot.sendMessage(chatId, 
    '📸 *Görüntü Oluşturma Modu*' + vipMessage + '\n\n' +
    'Lütfen düzenlemek istediğiniz görseli gönderin.\n' +
    '❌ İptal için /cancel yazın.',
    { parse_mode: 'Markdown' }
  );
});

// ========== YILDIZ SATIN ALMA SİSTEMİ ==========

bot.onText(/\/buy/, async (msg) => {
  const chatId = msg.chat.id;
  const user = await getOrCreateUser(msg);
  
  const isVIP = isVIPUser(user.username);
  const vipNote = isVIP ? '\n\n👑 *VIP statünüz var, zaten sınırsız hakka sahipsiniz!*' : '';
  
  let message = `⭐ *YILDIZ İLE HAK SATIN AL*${vipNote}\n`;
  message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  message += `🎫 Mevcut Hak: *${User.hasUnlimitedCredits(user.telegram_id) ? '∞ SINIRSIZ' : user.credits}*\n\n`;
  message += `📦 *Paketler:*\n\n`;
  
  Object.entries(STAR_PRODUCTS).forEach(([productId, product], index) => {
    message += `${index + 1}. ${product.title}\n`;
    message += `   ⭐ ${product.stars} Yıldız → 🎫 ${product.credits} Hak\n\n`;
  });
  
  message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `👇 Satın almak için paketi seçin:`;
  
  // Inline keyboard ile ürünler
  const keyboard = {
    inline_keyboard: [
      [
        { text: '🎫 3 Hak - 10⭐', callback_data: 'buy_credits_3' },
        { text: '🎫 5 Hak - 15⭐', callback_data: 'buy_credits_5' }
      ],
      [
        { text: '🎫 10 Hak - 25⭐', callback_data: 'buy_credits_10' },
        { text: '🎫 20 Hak - 45⭐', callback_data: 'buy_credits_20' }
      ],
      [
        { text: '🎫 50 Hak - 100⭐', callback_data: 'buy_credits_50' }
      ]
    ]
  };
  
  await bot.sendMessage(chatId, message, { 
    parse_mode: 'Markdown',
    reply_markup: keyboard
  });
});

// Callback query handler (satın alma)
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;
  
  // Satın alma işlemi
  if (data.startsWith('buy_credits_')) {
    const productId = data.replace('buy_', '');
    const product = STAR_PRODUCTS[productId];
    
    if (!product) {
      return await bot.answerCallbackQuery(query.id, { text: 'Ürün bulunamadı!', show_alert: true });
    }
    
    try {
      // Telegram Stars Invoice gönder
      await bot.sendInvoice(chatId, {
        title: product.title,
        description: product.description,
        payload: `credits_${userId}_${productId}`,
        currency: 'XTR', // Telegram Stars
        prices: [{ label: product.title, amount: product.stars }],
        provider_token: '', // Stars için boş
        start_parameter: `buy_${productId}`
      });
      
      await bot.answerCallbackQuery(query.id, { text: 'Ödeme sayfası açılıyor...' });
    } catch (error) {
      console.error('Invoice hatası:', error);
      await bot.answerCallbackQuery(query.id, { text: 'Hata oluştu, tekrar deneyin.', show_alert: true });
    }
  }
});

// Başarılı ödeme handler
bot.on('successful_payment', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username || `user_${userId}`;
  const payment = msg.successful_payment;
  
  // Payload'dan ürün ID'sini çıkar
  const payloadParts = payment.invoice_payload.split('_');
  const productId = `${payloadParts[1]}_${payloadParts[2]}`;
  const product = STAR_PRODUCTS[productId];
  
  if (!product) {
    console.error('Ürün bulunamadı:', productId);
    return await bot.sendMessage(chatId, '❌ Ödeme alındı ancak ürün bulunamadı. Destek için iletişime geçin.');
  }
  
  // Kredileri ekle
  User.updateCredits(userId, product.credits);
  
  // Kanala bildir
  await sendPurchaseToChannel(username, userId, product.credits, product.stars);
  
  const updatedUser = User.findById(userId);
  
  await bot.sendMessage(chatId, 
    `🎉 *Ödeme Başarılı!*\n\n` +
    `⭐ ${product.stars} Yıldız ödendi\n` +
    `🎫 ${product.credits} Hak eklendi\n` +
    `📊 Toplam Hak: ${updatedUser.credits}\n\n` +
    `✨ /generate ile görsel oluşturmaya başlayın!`,
    { parse_mode: 'Markdown' }
  );
  
  console.log(`💰 Satın alma başarılı: @${username} - ${product.credits} hak - ${product.stars} yıldız`);
});

// Pre-checkout query (ödeme onayı)
bot.on('pre_checkout_query', async (query) => {
  // Ödemeyi onayla
  await bot.answerPreCheckoutQuery(query.id, true);
});

// ========== İSTATİSTİK KOMUTU ==========

bot.onText(/\/stats/, async (msg) => {
  const chatId = msg.chat.id;
  const user = await getOrCreateUser(msg);
  
  // Sadece bot sahibi veya VIP kullanıcılar görebilir
  const isOwner = user.username === BOT_OWNER;
  const isVIP = isVIPUser(user.username);
  
  if (!isOwner && !isVIP) {
    return await bot.sendMessage(chatId, 
      '⛔ Bu komut sadece VIP kullanıcılar ve bot sahibi tarafından kullanılabilir.'
    );
  }
  
  const graph = generatePerformanceGraph();
  
  await bot.sendMessage(chatId, graph, { parse_mode: 'Markdown' });
});

// ========== DİĞER KOMUTLAR ==========

bot.onText(/\/referral/, async (msg) => {
  const user = await getOrCreateUser(msg);
  
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
  const isVIP = isVIPUser(user.username);
  const isUnlimited = User.hasUnlimitedCredits(user.telegram_id);
  const creditDisplay = isUnlimited ? '∞ SINIRSIZ' : user.credits;
  const vipBadge = isVIP ? ' 👑 VIP' : '';
  
  await bot.sendMessage(msg.chat.id, 
    `📊 *Hesap Durumunuz*${vipBadge}\n\n` +
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
    `/buy - Yıldız ile hak satın al\n` +
    `/referral - Referans linkiniz\n` +
    `/balance - Hak durumunuz\n` +
    `/history - Görsel geçmişi\n` +
    `/stats - İstatistikler (VIP)\n` +
    `/cancel - İptal et\n` +
    `/help - Bu yardım\n\n` +
    `💡 *Kullanım:*\n` +
    `1. /generate yazın\n` +
    `2. Görsel gönderin\n` +
    `3. Prompt yazın\n` +
    `4. Sonucu bekleyin\n\n` +
    `⭐ *Yıldız ile Hak:*\n` +
    `Telegram yıldızları ile ek hak satın alabilirsiniz. /buy`,
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

bot.on('message', async (msg) => {
  if (msg.text?.startsWith('/')) return;
  
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
    return await bot.sendMessage(msg.chat.id, '❌ Hakkınız kalmadı! /buy ile hak satın alın veya /referral ile kazanın.');
  }
  
  User.updateState(msg.from.id, 'processing', { temp_image_url: null, temp_file_id: null, temp_image_buffer: null });
  
  const statusMsg = await bot.sendMessage(msg.chat.id, 
    `⏳ *İşlem başladı...*${isVIP ? ' 👑 VIP Öncelik' : ''}\n\n📝 Prompt: "${prompt}"`,
    { parse_mode: 'Markdown' }
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
    
    // Input'u kanala gönder
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
      
      // Output'u kanala gönder
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
      
      // İstatistikleri güncelle
      updateHourlyStats(true);
      updateDailyStats(true);
      
      const creditDisplay = User.hasUnlimitedCredits(msg.from.id) 
        ? '∞ SINIRSIZ' 
        : updatedUser.credits;
      
      await bot.sendDocument(msg.chat.id, result.imageBuffer, {
        caption: truncateCaption(`✅ *Hazır!*\n\n📝 ${prompt}\n⏱️ ${processingTime.toFixed(1)}s\n🎫 Kalan: ${creditDisplay}`),
        parse_mode: 'Markdown',
        filename: `result_${Date.now()}.jpg`
      });
      
      try { await bot.deleteMessage(msg.chat.id, statusMsg.message_id); } catch (e) {}
      
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    console.error('İşlem hatası:', error);
    
    User.updateState(msg.from.id, null);
    
    const processingTime = (Date.now() - startTime) / 1000;
    
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
    
    // İstatistikleri güncelle
    updateHourlyStats(false);
    updateDailyStats(false);
    
    try { await bot.deleteMessage(msg.chat.id, statusMsg.message_id); } catch (e) {}
    
    await bot.sendMessage(msg.chat.id, 
      `😔 *Üzgünüm, bir sorun oluştu*\n\n` +
      `⚠️ Görseliniz işlenirken beklenmedik bir hata oluştu.\n\n` +
      `🔄 Lütfen tekrar deneyin: /generate\n\n` +
      `💬 Sorun devam ederse farklı bir prompt deneyin.`,
      { parse_mode: 'Markdown' }
    );
  }
});

console.log('🚀 Bot başlatıldı!');
console.log(`🤖 @${BOT_USERNAME}`);
console.log(`👑 VIP Kullanıcılar: ${VIP_USERS.join(', ')}`);
console.log(`💰 Bot Sahibi: @${BOT_OWNER}`);
console.log(`📺 Depolama kanalı: ${STORAGE_CHANNEL_ID || 'Ayarlanmadı'}`);
console.log(`⭐ Yıldız satın alma: Aktif`);

bot.on('polling_error', console.error);
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);
