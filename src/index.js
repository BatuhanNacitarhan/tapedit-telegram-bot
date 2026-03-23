require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const User = require('./models/User');
const Generation = require('./models/Generation');
const TapeditAutomation = require('./automation/tapedit');
const ReferralService = require('./services/referral');
const queueService = require('./services/queue');
const { initDatabase, dbHelper, isTurso } = require('./database');
const { t, getUserLanguage, getLanguageKeyboard, getLanguageName } = require('./i18n');
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
  'credits_3': { stars: 75, credits: 3 },
  'credits_5': { stars: 125, credits: 5 },
  'credits_10': { stars: 250, credits: 10 },
  'credits_20': { stars: 450, credits: 20 },
  'credits_50': { stars: 1000, credits: 50 }
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

/**
 * Dil destekli menü keyboard oluştur
 */
function getMainMenuKeyboard(lang = 'tr') {
  return {
    keyboard: [
      [t(lang, 'menu.generate'), t(lang, 'menu.buy')],
      [t(lang, 'menu.account'), t(lang, 'menu.referral')],
      [t(lang, 'menu.history'), t(lang, 'menu.stats')],
      [t(lang, 'menu.daily_reward'), t(lang, 'menu.queue_status')],
      [t(lang, 'menu.language'), t(lang, 'menu.help')]
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
      { command: 'daily', description: 'Günlük ödül al' },
      { command: 'queue', description: 'Sıra durumunu göster' },
      { command: 'language', description: 'Dil değiştir' },
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
  console.log(`🎁 Günlük ödül: Aktif`);
  console.log(`🔢 Kuyruk sistemi: Aktif`);
  console.log(`🌐 Çoklu dil: tr, en, ru, zh`);
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
    const lang = getUserLanguage(user);
    
    if (isNewUser && referralCode) {
      const result = await ReferralService.processReferral(user.telegram_id, referralCode);
      
      if (result.success) {
        user = await User.findById(user.telegram_id);
        await bot.sendMessage(chatId, 
          `🎉 <b>${t(lang, 'start.referral_bonus')}</b>\n✨ +${result.referred_bonus} ${t(lang, 'start.earned_credits')}`,
          { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard(lang) }
        );
      }
    }
    
    const isVIP = isVIPUser(user.username);
    const isUnlimited = await User.hasUnlimitedCredits(user.telegram_id);
    const creditDisplay = isUnlimited ? t(lang, 'general.unlimited') : user.credits;
    
    await bot.sendMessage(chatId, 
      `🤖 <b>${t(lang, 'start.title')}</b>${isVIP ? ' ' + t(lang, 'general.vip_badge') : ''}\n\n` +
      `👤 ${t(lang, 'start.welcome')}, @${escapeHtml(user.username)}!\n` +
      `🎫 ${t(lang, 'start.credits_display')}: <b>${creditDisplay}</b>\n\n` +
      `👇 ${t(lang, 'start.select_menu')}:`,
      { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard(lang) }
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
  const lang = getUserLanguage(user);
  
  // Menü butonlarını kontrol et
  switch (text) {
    case t(lang, 'menu.generate'):
    case '🎨 Görsel Oluştur':
    case '🎨 Create Image':
    case '🎨 Создать изображение':
    case '🎨 创建图像':
      await handleGenerate(chatId, user, lang);
      return;
    case t(lang, 'menu.buy'):
    case '⭐ Hak Satın Al':
    case '⭐ Buy Credits':
    case '⭐ Купить кредиты':
    case '⭐ 购买积分':
      await handleBuy(chatId, user, lang);
      return;
    case t(lang, 'menu.account'):
    case '📊 Hesabım':
    case '📊 My Account':
    case '📊 Мой аккаунт':
    case '📊 我的账户':
      await handleBalance(chatId, user, lang);
      return;
    case t(lang, 'menu.referral'):
    case '🔗 Referansım':
    case '🔗 My Referral':
    case '🔗 Моя реферал':
    case '🔗 我的推荐':
      await handleReferral(chatId, user, lang);
      return;
    case t(lang, 'menu.history'):
    case '📜 Geçmiş':
    case '📜 History':
    case '📜 История':
    case '📜 历史':
      await handleHistory(chatId, user, lang);
      return;
    case t(lang, 'menu.stats'):
    case '📈 İstatistikler':
    case '📈 Statistics':
    case '📈 Статистика':
    case '📈 统计':
      await handleStats(chatId, user, lang);
      return;
    case t(lang, 'menu.daily_reward'):
    case '🎁 Günlük Ödül':
    case '🎁 Daily Reward':
    case '🎁 Ежедневная награда':
    case '🎁 每日奖励':
      await handleDailyReward(chatId, user, lang);
      return;
    case t(lang, 'menu.queue_status'):
    case '🔢 Sıramı Gör':
    case '🔢 My Queue':
    case '🔢 Моя очередь':
    case '🔢 我的队列':
      await handleQueueStatus(chatId, user, lang);
      return;
    case t(lang, 'menu.language'):
    case '🌐 Dil Seç':
    case '🌐 Language':
    case '🌐 Язык':
    case '🌐 语言':
      await handleLanguageSelect(chatId, user, lang);
      return;
    case t(lang, 'menu.help'):
    case '❓ Yardım':
    case '❓ Help':
    case '❓ Помощь':
    case '❓ 帮助':
      await handleHelp(chatId, lang);
      return;
  }
  
  // Prompt bekleniyorsa
  if (user.state === 'waiting_prompt' && user.temp_image_url) {
    await processPrompt(msg, user, lang);
  }
});

// Komutlar
bot.onText(/\/generate/, async (msg) => {
  const user = await User.findOrCreate(msg.from.id, msg.from.username || `user_${msg.from.id}`);
  const lang = getUserLanguage(user);
  await handleGenerate(msg.chat.id, user, lang);
});

bot.onText(/\/buy/, async (msg) => {
  const user = await User.findOrCreate(msg.from.id, msg.from.username || `user_${msg.from.id}`);
  const lang = getUserLanguage(user);
  await handleBuy(msg.chat.id, user, lang);
});

bot.onText(/\/balance/, async (msg) => {
  const user = await User.findOrCreate(msg.from.id, msg.from.username || `user_${msg.from.id}`);
  const lang = getUserLanguage(user);
  await handleBalance(msg.chat.id, user, lang);
});

bot.onText(/\/referral/, async (msg) => {
  const user = await User.findOrCreate(msg.from.id, msg.from.username || `user_${msg.from.id}`);
  const lang = getUserLanguage(user);
  await handleReferral(msg.chat.id, user, lang);
});

bot.onText(/\/history/, async (msg) => {
  const user = await User.findOrCreate(msg.from.id, msg.from.username || `user_${msg.from.id}`);
  const lang = getUserLanguage(user);
  await handleHistory(msg.chat.id, user, lang);
});

bot.onText(/\/stats/, async (msg) => {
  const user = await User.findOrCreate(msg.from.id, msg.from.username || `user_${msg.from.id}`);
  const lang = getUserLanguage(user);
  await handleStats(msg.chat.id, user, lang);
});

bot.onText(/\/daily/, async (msg) => {
  const user = await User.findOrCreate(msg.from.id, msg.from.username || `user_${msg.from.id}`);
  const lang = getUserLanguage(user);
  await handleDailyReward(msg.chat.id, user, lang);
});

bot.onText(/\/queue/, async (msg) => {
  const user = await User.findOrCreate(msg.from.id, msg.from.username || `user_${msg.from.id}`);
  const lang = getUserLanguage(user);
  await handleQueueStatus(msg.chat.id, user, lang);
});

bot.onText(/\/language/, async (msg) => {
  const user = await User.findOrCreate(msg.from.id, msg.from.username || `user_${msg.from.id}`);
  const lang = getUserLanguage(user);
  await handleLanguageSelect(msg.chat.id, user, lang);
});

bot.onText(/\/help/, async (msg) => {
  const user = await User.findOrCreate(msg.from.id, msg.from.username || `user_${msg.from.id}`);
  const lang = getUserLanguage(user);
  await handleHelp(msg.chat.id, lang);
});

bot.onText(/\/cancel/, async (msg) => {
  const user = await User.findById(msg.from.id);
  const lang = getUserLanguage(user);
  
  // Kuyruktan kaldır
  queueService.cancel(msg.from.id);
  
  await User.updateState(msg.from.id, null, { temp_image_url: null, temp_file_id: null, temp_image_buffer: null });
  await bot.sendMessage(msg.chat.id, `✅ ${t(lang, 'errors.operation_cancelled')}`, { reply_markup: getMainMenuKeyboard(lang) });
});

// ========== HANDLER FONKSİYONLARI ==========

async function handleGenerate(chatId, user, lang) {
  const isUnlimited = await User.hasUnlimitedCredits(user.telegram_id);
  
  if (!isUnlimited && user.credits <= 0) {
    return await bot.sendMessage(chatId, 
      `❌ <b>${t(lang, 'generate.no_credits')}</b>\n\n⭐ ${t(lang, 'generate.buy_credits')}`,
      { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard(lang) }
    );
  }
  
  await User.updateState(user.telegram_id, 'waiting_image');
  
  await bot.sendMessage(chatId, 
    `📸 <b>${t(lang, 'generate.mode_title')}</b>${isVIPUser(user.username) ? ' ' + t(lang, 'general.vip_badge') : ''}\n\n` +
    `${t(lang, 'generate.send_image')}.\n❌ ${t(lang, 'generate.cancel_hint')}: /cancel`,
    { parse_mode: 'HTML' }
  );
}

async function handleBuy(chatId, user, lang) {
  const isVIP = isVIPUser(user.username);
  const isUnlimited = await User.hasUnlimitedCredits(user.telegram_id);
  
  let message = `⭐ <b>${t(lang, 'buy.title')}</b>${isVIP ? '\n\n👑 ' + t(lang, 'buy.vip_status') : ''}\n\n`;
  message += `🎫 ${t(lang, 'buy.current_credits')}: <b>${isUnlimited ? t(lang, 'general.unlimited') : user.credits}</b>\n\n📦 <b>${t(lang, 'buy.packages')}:</b>\n\n`;
  
  const packages = {
    'credits_3': { stars: 75, credits: 3 },
    'credits_5': { stars: 125, credits: 5 },
    'credits_10': { stars: 250, credits: 10 },
    'credits_20': { stars: 450, credits: 20 },
    'credits_50': { stars: 1000, credits: 50 }
  };
  
  let i = 1;
  for (const [id, p] of Object.entries(packages)) {
    const pkgName = t(lang, `packages.${id}.title`);
    message += `${i}. ${pkgName}\n   ⭐ ${p.stars} ${t(lang, 'buy.stars')} → 🎫 ${p.credits} ${t(lang, 'general.credits')}\n\n`;
    i++;
  }
  
  message += `👇 ${t(lang, 'buy.select_package')}:`;
  
  const keyboard = {
    inline_keyboard: [
      [
        { text: '🎫 3 - 75⭐', callback_data: 'buy_credits_3' },
        { text: '🎫 5 - 125⭐', callback_data: 'buy_credits_5' }
      ],
      [
        { text: '🎫 10 - 250⭐', callback_data: 'buy_credits_10' },
        { text: '🎫 20 - 450⭐', callback_data: 'buy_credits_20' }
      ],
      [{ text: '🎫 50 - 1000⭐', callback_data: 'buy_credits_50' }]
    ]
  };
  
  await bot.sendMessage(chatId, message, { parse_mode: 'HTML', reply_markup: keyboard });
}

async function handleBalance(chatId, user, lang) {
  const stats = await Generation.getStats(user.telegram_id);
  const isUnlimited = await User.hasUnlimitedCredits(user.telegram_id);
  const isVIP = isVIPUser(user.username);
  
  await bot.sendMessage(chatId, 
    `📊 <b>${t(lang, 'account.title')}</b>${isVIP ? ' ' + t(lang, 'general.vip_badge') : ''}\n\n` +
    `👤 @${escapeHtml(user.username)}\n` +
    `🎫 ${t(lang, 'account.remaining_credits')}: <b>${isUnlimited ? t(lang, 'general.unlimited') : user.credits}</b>\n` +
    `📈 ${t(lang, 'general.total')}: ${stats.total} | ✅ ${stats.completed} | ❌ ${stats.failed}\n` +
    `📅 ${t(lang, 'account.registration_date')}: ${new Date(user.created_at).toLocaleDateString('tr-TR')}`,
    { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard(lang) }
  );
}

async function handleReferral(chatId, user, lang) {
  const code = ReferralService.getReferralCode(user.telegram_id);
  const link = ReferralService.generateReferralLink(code, BOT_USERNAME);
  const stats = await ReferralService.getReferralStats(user.telegram_id);
  
  await bot.sendMessage(chatId, 
    `🔗 <b>${t(lang, 'referral.title')}</b>\n\n` +
    `📋 ${t(lang, 'referral.code')}: <code>${code}</code>\n` +
    `🔗 ${t(lang, 'referral.link')}:\n<code>${link}</code>\n\n` +
    `💰 <b>${t(lang, 'referral.how_works')}</b>\n` +
    `• ${t(lang, 'referral.link_comer')}: +1 ${t(lang, 'general.credits')}\n` +
    `• ${t(lang, 'referral.you_get')}: +1 ${t(lang, 'general.credits')}\n\n` +
    `📊 ${t(lang, 'referral.total_referrals')}: ${stats.total_referrals}`,
    { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard(lang) }
  );
}

async function handleHistory(chatId, user, lang) {
  const history = await Generation.getUserHistory(user.telegram_id, 10);
  
  if (history.length === 0) {
    return await bot.sendMessage(chatId, `📭 ${t(lang, 'history.empty')}.`, { reply_markup: getMainMenuKeyboard(lang) });
  }
  
  let message = `📚 <b>${t(lang, 'history.title')}:</b>\n\n`;
  
  history.forEach((item, i) => {
    const status = item.status === 'completed' ? '✅' : '❌';
    const shortPrompt = item.prompt.length > 25 ? item.prompt.substring(0, 25) + '...' : item.prompt;
    message += `${i + 1}. ${status} "${escapeHtml(shortPrompt)}" | ⏱️ ${item.processing_time?.toFixed(1) || '-'}s\n`;
  });
  
  await bot.sendMessage(chatId, message, { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard(lang) });
}

async function handleStats(chatId, user, lang) {
  if (!isVIPUser(user.username) && user.username !== BOT_OWNER) {
    return await bot.sendMessage(chatId, `⛔ ${t(lang, 'stats.vip_only')}.`, { reply_markup: getMainMenuKeyboard(lang) });
  }
  
  const queueStats = queueService.getStats();
  await bot.sendMessage(chatId, 
    `📈 ${t(lang, 'stats.title')}:\n` +
    `📊 ${Object.keys(hourlyStats).length} ${t(lang, 'stats.data_available')}\n` +
    `🔢 Kuyruk: ${queueStats.queueLength} bekleyen, ${queueStats.processingCount} işlenen`,
    { reply_markup: getMainMenuKeyboard(lang) }
  );
}

async function handleDailyReward(chatId, user, lang) {
  const check = await User.canClaimDailyReward(user.telegram_id);
  
  if (check.canClaim) {
    // Ödül alınabilir - buton göster
    const keyboard = {
      inline_keyboard: [
        [{ text: t(lang, 'daily.claim_button'), callback_data: 'claim_daily' }]
      ]
    };
    
    await bot.sendMessage(chatId, 
      `🎁 <b>${t(lang, 'daily.title')}</b>\n\n` +
      `✅ ${t(lang, 'daily.claim_button')}!\n` +
      `🎫 +1 ${t(lang, 'general.credits')}`,
      { parse_mode: 'HTML', reply_markup: keyboard }
    );
  } else if (check.reason === 'vip') {
    await bot.sendMessage(chatId, 
      `👑 ${t(lang, 'general.vip_badge')}\n\n` +
      `${t(lang, 'general.unlimited')}!`,
      { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard(lang) }
    );
  } else {
    // Süre dolmamış - kalan süre göster
    const timeStr = check.remainingHours > 0 
      ? `${check.remainingHours} ${t(lang, 'daily.in_hours')}`
      : `${check.remainingMinutes} ${t(lang, 'daily.in_minutes')}`;
    
    await bot.sendMessage(chatId, 
      `🎁 <b>${t(lang, 'daily.title')}</b>\n\n` +
      `⏳ ${t(lang, 'daily.already_claimed')}\n\n` +
      `🕐 ${t(lang, 'daily.next_reward')}: ${timeStr}`,
      { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard(lang) }
    );
  }
}

async function handleQueueStatus(chatId, user, lang) {
  const status = queueService.getStatus(user.telegram_id);
  const stats = queueService.getStats();
  
  let message = `🔢 <b>${t(lang, 'queue.title')}</b>\n\n`;
  
  if (status.status === 'processing') {
    message += `🔄 ${t(lang, 'queue.processing_now')}!\n`;
    message += `⏱️ ${Math.round(status.elapsed)}s ${t(lang, 'general.seconds')}`;
  } else if (status.status === 'queued') {
    message += `📥 ${t(lang, 'queue.in_queue')}\n\n`;
    message += `📍 ${t(lang, 'queue.position')}: <b>${status.position}</b>\n`;
    message += `👥 ${status.position - 1} ${t(lang, 'queue.people_ahead')}\n`;
    message += `⏱️ ${t(lang, 'queue.estimated_wait')}: ~${status.estimatedWait} ${t(lang, 'queue.minutes')}`;
  } else {
    message += `✅ ${t(lang, 'queue.not_in_queue')}.\n\n`;
    message += `📊 ${t(lang, 'stats.title')}:\n`;
    message += `• ${t(lang, 'queue.processing_now')}: ${stats.processingCount}\n`;
    message += `• Kuyruk: ${stats.queueLength}`;
  }
  
  await bot.sendMessage(chatId, message, { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard(lang) });
}

async function handleLanguageSelect(chatId, user, lang) {
  await bot.sendMessage(chatId, 
    `🌐 <b>${t(lang, 'language.title')}</b>\n\n` +
    `${t(lang, 'language.current')}: ${getLanguageName(lang)}\n\n` +
    `${t(lang, 'language.select_new')}:`,
    { parse_mode: 'HTML', reply_markup: getLanguageKeyboard() }
  );
}

async function handleHelp(chatId, lang) {
  await bot.sendMessage(chatId, 
    `📚 <b>${t(lang, 'help.title')}</b>\n\n` +
    `🤖 ${t(lang, 'help.bot_description')}.\n\n` +
    `📋 <b>${t(lang, 'help.commands_title')}:</b>\n` +
    `/start - ${t(lang, 'commands.start')}\n` +
    `/generate - ${t(lang, 'commands.generate')}\n` +
    `/buy - ${t(lang, 'commands.buy')}\n` +
    `/balance - ${t(lang, 'commands.balance')}\n` +
    `/referral - ${t(lang, 'commands.referral')}\n` +
    `/history - ${t(lang, 'commands.history')}\n` +
    `/daily - ${t(lang, 'commands.daily')}\n` +
    `/queue - ${t(lang, 'commands.queue')}\n` +
    `/language - ${t(lang, 'commands.language')}\n` +
    `/help - ${t(lang, 'commands.help')}\n\n` +
    `💡 <b>${t(lang, 'help.usage_title')}:</b>\n` +
    `1. ${t(lang, 'help.usage_step1')}\n` +
    `2. ${t(lang, 'help.usage_step2')}\n` +
    `3. ${t(lang, 'help.usage_step3')}\n` +
    `4. ${t(lang, 'help.usage_step4')}`,
    { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard(lang) }
  );
}

// ========== FOTOĞRAF İŞLEYİCİ ==========

bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const user = await User.findById(msg.from.id);
  const lang = getUserLanguage(user);
  
  if (!user || user.state !== 'waiting_image') {
    return await bot.sendMessage(chatId, `⚠️ ${t(lang, 'errors.no_image')}.`, { parse_mode: 'HTML' });
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
    `✅ ${t(lang, 'generate.image_received')}!\n\n📝 ${t(lang, 'generate.write_prompt')}.\n❌ ${t(lang, 'generate.cancel_hint')}: /cancel`
  );
});

// ========== PROMPT İŞLEME ==========

async function processPrompt(msg, user, lang) {
  const chatId = msg.chat.id;
  const prompt = msg.text;
  const isVIP = isVIPUser(user.username);
  const isUnlimited = await User.hasUnlimitedCredits(user.telegram_id);
  
  if (!isUnlimited && user.credits <= 0) {
    await User.updateState(msg.from.id, null, { temp_image_url: null, temp_file_id: null, temp_image_buffer: null });
    return await bot.sendMessage(chatId, `❌ ${t(lang, 'generate.no_credits')}!`, { reply_markup: getMainMenuKeyboard(lang) });
  }
  
  // Kuyruğa ekle
  const queueResult = queueService.enqueue(msg.from.id, { prompt, user });
  
  if (!queueResult.success && queueResult.message === 'already_in_queue') {
    return await bot.sendMessage(chatId, 
      `📥 ${t(lang, 'queue.queue_info')}.\n📍 ${t(lang, 'queue.position')}: ${queueResult.position}`,
      { reply_markup: getMainMenuKeyboard(lang) }
    );
  }
  
  if (!queueResult.success && queueResult.message === 'already_processing') {
    return await bot.sendMessage(chatId, 
      `🔄 ${t(lang, 'queue.processing_now')}!`,
      { reply_markup: getMainMenuKeyboard(lang) }
    );
  }
  
  await User.updateState(msg.from.id, 'processing', { temp_image_url: null, temp_file_id: null, temp_image_buffer: null });
  
  const statusMsg = await bot.sendMessage(chatId, 
    `📥 ${t(lang, 'queue.queue_info')}\n📍 ${t(lang, 'queue.position')}: ${queueResult.position}\n⏱️ ~${queueResult.estimatedWait} ${t(lang, 'queue.minutes')}\n\n📝 "${escapeHtml(prompt)}"`,
    { parse_mode: 'HTML' }
  );
  
  let inputMessageId = null;
  const startTime = Date.now();
  
  try {
    // Kuyruktan sıra bekle
    while (true) {
      const item = queueService.dequeue();
      if (item && item.userId === msg.from.id) {
        break; // Sıra bizim
      }
      
      // Başkası işleniyor, bekle
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Durum güncelle
      const currentStatus = queueService.getStatus(msg.from.id);
      if (currentStatus.status === 'queued') {
        try {
          await bot.editMessageText(
            `📥 ${t(lang, 'queue.queue_info')}\n📍 ${t(lang, 'queue.position')}: ${currentStatus.position}\n⏱️ ~${currentStatus.estimatedWait} ${t(lang, 'queue.minutes')}\n\n📝 "${escapeHtml(prompt)}"`,
            { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' }
          );
        } catch (e) {}
      }
    }
    
    // İşlem başladı
    try {
      await bot.editMessageText(
        `⏳ <b>${t(lang, 'generate.processing_started')}</b>${isVIP ? ' ' + t(lang, 'general.vip_badge') : ''}\n\n📝 "${escapeHtml(prompt)}"`,
        { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' }
      );
    } catch (e) {}
    
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
      queueService.complete(msg.from.id, true);
      
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
      
      const creditDisplay = await User.hasUnlimitedCredits(msg.from.id) ? t(lang, 'general.unlimited') : updatedUser.credits;
      
      await bot.sendDocument(chatId, result.imageBuffer, {
        caption: `✅ ${t(lang, 'generate.result_ready')}!\n⏱️ ${processingTime.toFixed(1)}s\n🎫 ${t(lang, 'general.remaining')}: ${creditDisplay}`,
        filename: `result_${Date.now()}.jpg`
      });
      
      try { await bot.deleteMessage(chatId, statusMsg.message_id); } catch (e) {}
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    console.error('İşlem hatası:', error);
    
    await User.updateState(msg.from.id, null);
    queueService.complete(msg.from.id, false);
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
      `😔 <b>${t(lang, 'generate.error_occurred')}</b>\n\n🔄 ${t(lang, 'generate.try_again')}: /generate`,
      { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard(lang) }
    );
  }
}

// ========== CALLBACK QUERY İŞLEYİCİLERİ ==========

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const userId = query.from.id;
  
  // Günlük ödül alma
  if (data === 'claim_daily') {
    const user = await User.findById(userId);
    const lang = getUserLanguage(user);
    
    const result = await User.claimDailyReward(userId);
    
    if (result.success) {
      await bot.answerCallbackQuery(query.id, { 
        text: `🎉 ${t(lang, 'daily.claim_success')}! +1 ${t(lang, 'general.credits')}`,
        show_alert: true 
      });
      
      await bot.editMessageText(
        `🎁 <b>${t(lang, 'daily.title')}</b>\n\n` +
        `✅ ${t(lang, 'daily.claim_success')}!\n` +
        `🎫 ${t(lang, 'daily.earned_credit')}\n` +
        `📊 ${t(lang, 'general.total')}: ${result.newCredits}`,
        { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: getMainMenuKeyboard(lang) }
      );
    } else {
      await bot.answerCallbackQuery(query.id, { 
        text: `⏳ ${t(lang, 'daily.already_claimed')}`,
        show_alert: true 
      });
    }
    return;
  }
  
  // Dil değiştirme
  if (data.startsWith('lang_')) {
    const newLang = data.replace('lang_', '');
    await User.setLanguage(userId, newLang);
    
    await bot.answerCallbackQuery(query.id, { 
      text: `✅ ${t(newLang, 'language.changed')} ${getLanguageName(newLang)}`,
      show_alert: false 
    });
    
    await bot.editMessageText(
      `🌐 <b>${t(newLang, 'language.title')}</b>\n\n` +
      `✅ ${t(newLang, 'language.changed')}!\n` +
      `${t(newLang, 'language.current')}: ${getLanguageName(newLang)}`,
      { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', reply_markup: getMainMenuKeyboard(newLang) }
    );
    return;
  }
  
  // Satın alma
  if (data.startsWith('buy_credits_')) {
    const user = await User.findById(userId);
    const lang = getUserLanguage(user);
    const productId = data.replace('buy_', '');
    const product = STAR_PRODUCTS[productId];
    
    if (!product) {
      return await bot.answerCallbackQuery(query.id, { text: t(lang, 'buy.product_not_found'), show_alert: true });
    }
    
    try {
      const title = t(lang, `packages.${productId}.title`);
      const description = t(lang, `packages.${productId}.description`);
      
      await bot.sendInvoice(chatId, title, description, 
        `stars_${userId}_${productId}`, '', 'XTR', 
        [{ label: title, amount: product.stars }]
      );
      await bot.answerCallbackQuery(query.id, { text: t(lang, 'buy.payment_opening') });
    } catch (error) {
      console.error('Invoice hatası:', error.message);
      await bot.answerCallbackQuery(query.id, { text: `${t(lang, 'general.error')}: ${error.message}`, show_alert: true });
    }
  }
});

// ========== YILDIZ ÖDEME ==========

bot.on('successful_payment', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username || `user_${userId}`;
  const payment = msg.successful_payment;
  
  console.log('💰 Ödeme:', payment);
  
  const user = await User.findById(userId);
  const lang = getUserLanguage(user);
  
  const parts = payment.invoice_payload.split('_');
  if (parts.length >= 4) {
    const productId = `${parts[2]}_${parts[3]}`;
    const product = STAR_PRODUCTS[productId];
    
    if (product) {
      await User.updateCredits(userId, product.credits);
      await sendPurchaseToChannel(username, userId, product.credits, product.stars);
      
      const updatedUser = await User.findById(userId);
      
      await bot.sendMessage(chatId, 
        `🎉 <b>${t(lang, 'buy.payment_success')}</b>!\n\n⭐ ${product.stars} ${t(lang, 'buy.stars')}\n🎫 ${product.credits} ${t(lang, 'general.credits')}\n📊 ${t(lang, 'general.total')}: ${updatedUser.credits}`,
        { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard(lang) }
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
      `🎉 <b>${t(lang, 'buy.payment_success')}</b>!\n🎫 ${credits} ${t(lang, 'buy.added_credits')}\n📊 ${t(lang, 'general.total')}: ${updatedUser.credits}`,
      { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard(lang) }
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
