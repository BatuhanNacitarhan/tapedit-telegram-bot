require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const User = require('./models/User');
const Generation = require('./models/Generation');
const TapeditAutomation = require('./automation/tapedit');
const ReferralService = require('./services/referral');
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

// ========== KUYRUK SİSTEMİ (IN-MEMORY) ==========
const queueData = {
  queue: [],
  processing: new Map(),
  averageProcessTime: 45
};

function queueEnqueue(userId, data) {
  const existingIndex = queueData.queue.findIndex(item => item.userId === userId);
  if (existingIndex !== -1) {
    return { success: false, position: existingIndex + 1, message: 'already_in_queue', estimatedWait: existingIndex * 45 };
  }
  if (queueData.processing.has(userId)) {
    return { success: false, position: 0, message: 'already_processing', estimatedWait: 0 };
  }
  
  const queueItem = { userId, data, enqueuedAt: Date.now(), id: `${userId}_${Date.now()}` };
  queueData.queue.push(queueItem);
  const position = queueData.queue.length;
  console.log(`📥 Kuyruk: +${userId} | Pozisyon: ${position}`);
  
  return { success: true, position, message: 'added_to_queue', estimatedWait: (position - 1) * 45, queueId: queueItem.id };
}

function queueDequeue() {
  if (queueData.queue.length === 0) return null;
  if (queueData.processing.size >= 1) return null;
  
  const item = queueData.queue.shift();
  item.startedAt = Date.now();
  queueData.processing.set(item.userId, item);
  return item;
}

function queueComplete(userId) {
  queueData.processing.delete(userId);
}

function queueCancel(userId) {
  const index = queueData.queue.findIndex(item => item.userId === userId);
  if (index !== -1) {
    queueData.queue.splice(index, 1);
    return true;
  }
  if (queueData.processing.has(userId)) {
    queueData.processing.delete(userId);
    return true;
  }
  return false;
}

function queueGetStatus(userId) {
  if (queueData.processing.has(userId)) {
    const item = queueData.processing.get(userId);
    const elapsed = (Date.now() - item.startedAt) / 1000;
    return { status: 'processing', position: 0, elapsed, message: 'processing_now' };
  }
  
  const position = queueData.queue.findIndex(item => item.userId === userId);
  if (position !== -1) {
    return {
      status: 'queued',
      position: position + 1,
      estimatedWait: position * queueData.averageProcessTime,
      totalInQueue: queueData.queue.length,
      message: 'in_queue'
    };
  }
  
  return { status: 'not_in_queue', position: 0, message: 'not_in_queue' };
}

function queueGetStats() {
  return {
    queueLength: queueData.queue.length,
    processingCount: queueData.processing.size
  };
}

// ========== SETUP ==========

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

// ========== YARDIMCI FONKSİYONLAR ==========

function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function isVIPUser(username) {
  return VIP_USERS.includes(username?.replace('@', ''));
}

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
    const headerCaption = `🆕 <b>YENİ İSTEK</b>\n👤 @${escapeHtml(username)}${isVIP ? ' 👑' : ''}`;
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
    console.error('❌ Kanal hatası:', error.message);
    return null;
  }
}

async function sendOutputToChannel(outputBuffer, prompt, username, userId, inputMessageId, processingTime) {
  if (!STORAGE_CHANNEL_ID) return null;
  try {
    const isVIP = isVIPUser(username);
    const headerCaption = `✅ <b>SONUÇ</b>\n👤 @${escapeHtml(username)}${isVIP ? ' 👑' : ''} | ⏱️ ${processingTime.toFixed(1)}s`;
    return await bot.sendDocument(STORAGE_CHANNEL_ID, outputBuffer, {
      caption: headerCaption,
      parse_mode: 'HTML',
      filename: `output_${userId}_${Date.now()}.jpg`,
      reply_to_message_id: inputMessageId
    });
  } catch (error) {
    console.error('❌ Output hatası:', error.message);
    return null;
  }
}

async function sendErrorToChannel(prompt, username, userId, errorMessage, inputMessageId) {
  if (!STORAGE_CHANNEL_ID) return;
  try {
    await bot.sendMessage(STORAGE_CHANNEL_ID, 
      `❌ <b>HATA</b>\n👤 @${escapeHtml(username)}\n⚠️ ${escapeHtml(errorMessage)}`,
      { parse_mode: 'HTML', reply_to_message_id: inputMessageId }
    );
  } catch (error) {}
}

async function sendPurchaseToChannel(username, userId, credits, stars) {
  if (!STORAGE_CHANNEL_ID) return;
  try {
    await bot.sendMessage(STORAGE_CHANNEL_ID, 
      `💰 <b>YENİ SATIN ALMA</b>\n👤 @${escapeHtml(username)} | 🎫 ${credits} Hak | ⭐ ${stars}`,
      { parse_mode: 'HTML' }
    );
  } catch (error) {}
}

// ========== KEEP-ALIVE ==========

if (KOYEB_URL) {
  setInterval(async () => {
    try { await axios.get(KOYEB_URL); } catch (error) {}
  }, 30 * 60 * 1000);
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
      { command: 'daily', description: 'Günlük ödül al' },
      { command: 'queue', description: 'Sıra durumunu göster' },
      { command: 'language', description: 'Dil değiştir' },
      { command: 'help', description: 'Yardım menüsü' }
    ]);
  } catch (error) {}
}

// ========== MAIN ==========

async function main() {
  await initDatabase();
  await setupBotCommands();
  console.log('🚀 Bot başlatıldı!');
  console.log(`🤖 @${BOT_USERNAME}`);
  console.log(`🌐 Diller: tr, en, ru, zh`);
  console.log(`🎁 Günlük ödül: Aktif`);
  console.log(`🔢 Kuyruk: Aktif`);
}

// ========== KOMUT İŞLEYİCİLERİ ==========

bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const referralCode = match[1];
  
  try {
    let existingUser = await User.findById(msg.from.id);
    const isNewUser = !existingUser;
    
    let user = await User.findOrCreate(msg.from.id, msg.from.username || `user_${msg.from.id}`);
    const lang = getUserLanguage(user);

    // Ban kontrolü
    if (user.is_banned === 1) {
      return await bot.sendMessage(chatId, '⛔ Hesabınız yasaklanmıştır. Destek için bot sahibiyle iletişime geçin.');
    }
    
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

  // Ban kontrolü
  const banned = await User.isBanned(msg.from.id);
  if (banned) {
    return await bot.sendMessage(chatId, '⛔ Hesabınız yasaklanmıştır.');
  }
  
  const user = await User.findOrCreate(msg.from.id, msg.from.username || `user_${msg.from.id}`);
  const lang = getUserLanguage(user);
  
  const menuMap = {
    '🎨 Görsel Oluştur': 'generate', '🎨 Create Image': 'generate', '🎨 Создать изображение': 'generate', '🎨 创建图像': 'generate',
    '⭐ Hak Satın Al': 'buy', '⭐ Buy Credits': 'buy', '⭐ Купить кредиты': 'buy', '⭐ 购买积分': 'buy',
    '📊 Hesabım': 'account', '📊 My Account': 'account', '📊 Мой аккаунт': 'account', '📊 我的账户': 'account',
    '🔗 Referansım': 'referral', '🔗 My Referral': 'referral', '🔗 Моя реферал': 'referral', '🔗 我的推荐': 'referral',
    '📜 Geçmiş': 'history', '📜 History': 'history', '📜 История': 'history', '📜 历史': 'history',
    '📈 İstatistikler': 'stats', '📈 Statistics': 'stats', '📈 Статистика': 'stats', '📈 统计': 'stats',
    '🎁 Günlük Ödül': 'daily', '🎁 Daily Reward': 'daily', '🎁 Ежедневная награда': 'daily', '🎁 每日奖励': 'daily',
    '🔢 Sıramı Gör': 'queue', '🔢 My Queue': 'queue', '🔢 Моя очередь': 'queue', '🔢 我的队列': 'queue',
    '🌐 Dil Seç': 'language', '🌐 Language': 'language', '🌐 Язык': 'language', '🌐 语言': 'language',
    '❓ Yardım': 'help', '❓ Help': 'help', '❓ Помощь': 'help', '❓ 帮助': 'help'
  };
  
  const action = menuMap[text];
  if (action) {
    const handlers = {
      'generate': () => handleGenerate(chatId, user, lang),
      'buy': () => handleBuy(chatId, user, lang),
      'account': () => handleBalance(chatId, user, lang),
      'referral': () => handleReferral(chatId, user, lang),
      'history': () => handleHistory(chatId, user, lang),
      'stats': () => handleStats(chatId, user, lang),
      'daily': () => handleDailyReward(chatId, user, lang),
      'queue': () => handleQueueStatus(chatId, user, lang),
      'language': () => handleLanguageSelect(chatId, user, lang),
      'help': () => handleHelp(chatId, lang)
    };
    await handlers[action]();
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
  await handleGenerate(msg.chat.id, user, getUserLanguage(user));
});

bot.onText(/\/buy/, async (msg) => {
  const user = await User.findOrCreate(msg.from.id, msg.from.username || `user_${msg.from.id}`);
  await handleBuy(msg.chat.id, user, getUserLanguage(user));
});

bot.onText(/\/balance/, async (msg) => {
  const user = await User.findOrCreate(msg.from.id, msg.from.username || `user_${msg.from.id}`);
  await handleBalance(msg.chat.id, user, getUserLanguage(user));
});

bot.onText(/\/referral/, async (msg) => {
  const user = await User.findOrCreate(msg.from.id, msg.from.username || `user_${msg.from.id}`);
  await handleReferral(msg.chat.id, user, getUserLanguage(user));
});

bot.onText(/\/history/, async (msg) => {
  const user = await User.findOrCreate(msg.from.id, msg.from.username || `user_${msg.from.id}`);
  await handleHistory(msg.chat.id, user, getUserLanguage(user));
});

bot.onText(/\/daily/, async (msg) => {
  const user = await User.findOrCreate(msg.from.id, msg.from.username || `user_${msg.from.id}`);
  await handleDailyReward(msg.chat.id, user, getUserLanguage(user));
});

bot.onText(/\/queue/, async (msg) => {
  const user = await User.findOrCreate(msg.from.id, msg.from.username || `user_${msg.from.id}`);
  await handleQueueStatus(msg.chat.id, user, getUserLanguage(user));
});

bot.onText(/\/language/, async (msg) => {
  const user = await User.findOrCreate(msg.from.id, msg.from.username || `user_${msg.from.id}`);
  await handleLanguageSelect(msg.chat.id, user, getUserLanguage(user));
});

bot.onText(/\/help/, async (msg) => {
  const user = await User.findOrCreate(msg.from.id, msg.from.username || `user_${msg.from.id}`);
  await handleHelp(msg.chat.id, getUserLanguage(user));
});

bot.onText(/\/cancel/, async (msg) => {
  const user = await User.findById(msg.from.id);
  const lang = getUserLanguage(user);
  queueCancel(msg.from.id);
  await User.updateState(msg.from.id, null, { temp_image_url: null, temp_file_id: null, temp_image_buffer: null });
  await bot.sendMessage(msg.chat.id, `✅ ${t(lang, 'errors.operation_cancelled')}`, { reply_markup: getMainMenuKeyboard(lang) });
});

// ========== ADMİN KOMUTLARI ==========

bot.onText(/\/admin/, async (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || '';

  if (username !== BOT_OWNER) {
    return await bot.sendMessage(chatId, '⛔ Bu komut sadece bot sahibine özeldir.');
  }

  try {
    const stats = await User.getAdminStats();
    const qStats = queueGetStats();
    const successRate = stats.totalGenerations > 0
      ? ((stats.completedGenerations / stats.totalGenerations) * 100).toFixed(1)
      : '0';

    let topList = '';
    stats.topUsers.forEach((u, i) => {
      topList += `${i + 1}. @${escapeHtml(u.username || 'bilinmiyor')} — ${u.gen_count} görsel\n`;
    });

    const message =
      `🛡️ <b>ADMİN PANELİ</b>\n\n` +
      `👥 <b>Kullanıcılar</b>\n` +
      `├ Toplam: <b>${stats.totalUsers}</b>\n` +
      `├ Bugün yeni: <b>${stats.todayUsers}</b>\n` +
      `└ Banlı: <b>${stats.bannedUsers}</b>\n\n` +
      `🎨 <b>Görseller</b>\n` +
      `├ Toplam: <b>${stats.totalGenerations}</b>\n` +
      `├ Bugün: <b>${stats.todayGenerations}</b>\n` +
      `└ Başarı oranı: <b>%${successRate}</b>\n\n` +
      `🔢 <b>Kuyruk</b>\n` +
      `├ Bekleyen: <b>${qStats.queueLength}</b>\n` +
      `└ İşlenen: <b>${qStats.processingCount}</b>\n\n` +
      `🏆 <b>En Aktif 5 Kullanıcı</b>\n${topList || 'Henüz veri yok'}\n\n` +
      `📋 <b>Komutlar:</b>\n` +
      `/addcredits @kullanıcı 10\n` +
      `/removecredits @kullanıcı 5\n` +
      `/ban @kullanıcı\n` +
      `/unban @kullanıcı\n` +
      `/broadcast mesaj`;

    await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
  } catch (error) {
    console.error('Admin panel hatası:', error);
    await bot.sendMessage(chatId, `❌ Hata: ${error.message}`);
  }
});

bot.onText(/\/addcredits(?: (.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || '';

  if (username !== BOT_OWNER) {
    return await bot.sendMessage(chatId, '⛔ Bu komut sadece bot sahibine özeldir.');
  }

  const args = match[1]?.trim().split(/\s+/);
  if (!args || args.length < 2) {
    return await bot.sendMessage(chatId, '❌ Kullanım: /addcredits @kullanıcı 10');
  }

  const targetUsername = args[0].replace('@', '');
  const amount = parseInt(args[1]);

  if (isNaN(amount) || amount <= 0) {
    return await bot.sendMessage(chatId, '❌ Geçerli bir sayı girin. Örnek: /addcredits @kullanıcı 10');
  }

  try {
    const targetUser = await User.findByUsername(targetUsername);
    if (!targetUser) {
      return await bot.sendMessage(chatId, `❌ @${targetUsername} bulunamadı.`);
    }

    await User.updateCredits(targetUser.telegram_id, amount);
    const updated = await User.findById(targetUser.telegram_id);

    await bot.sendMessage(chatId,
      `✅ <b>Kredi Eklendi</b>\n👤 @${escapeHtml(targetUsername)}\n➕ ${amount} hak eklendi\n📊 Yeni bakiye: <b>${updated.credits}</b>`,
      { parse_mode: 'HTML' }
    );

    try {
      await bot.sendMessage(targetUser.telegram_id,
        `🎁 Hesabınıza <b>${amount} hak</b> eklendi!\n📊 Yeni bakiyeniz: <b>${updated.credits}</b>`,
        { parse_mode: 'HTML' }
      );
    } catch (e) {}

    console.log(`➕ Admin kredi ekledi: @${targetUsername} +${amount}`);
  } catch (error) {
    await bot.sendMessage(chatId, `❌ Hata: ${error.message}`);
  }
});

bot.onText(/\/removecredits(?: (.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || '';

  if (username !== BOT_OWNER) {
    return await bot.sendMessage(chatId, '⛔ Bu komut sadece bot sahibine özeldir.');
  }

  const args = match[1]?.trim().split(/\s+/);
  if (!args || args.length < 2) {
    return await bot.sendMessage(chatId, '❌ Kullanım: /removecredits @kullanıcı 5');
  }

  const targetUsername = args[0].replace('@', '');
  const amount = parseInt(args[1]);

  if (isNaN(amount) || amount <= 0) {
    return await bot.sendMessage(chatId, '❌ Geçerli bir sayı girin. Örnek: /removecredits @kullanıcı 5');
  }

  try {
    const targetUser = await User.findByUsername(targetUsername);
    if (!targetUser) {
      return await bot.sendMessage(chatId, `❌ @${targetUsername} bulunamadı.`);
    }

    await User.updateCredits(targetUser.telegram_id, -amount);
    const updated = await User.findById(targetUser.telegram_id);

    await bot.sendMessage(chatId,
      `✅ <b>Kredi Düşüldü</b>\n👤 @${escapeHtml(targetUsername)}\n➖ ${amount} hak düşüldü\n📊 Yeni bakiye: <b>${Math.max(0, updated.credits)}</b>`,
      { parse_mode: 'HTML' }
    );

    console.log(`➖ Admin kredi düşürdü: @${targetUsername} -${amount}`);
  } catch (error) {
    await bot.sendMessage(chatId, `❌ Hata: ${error.message}`);
  }
});

bot.onText(/\/ban(?: (.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || '';

  if (username !== BOT_OWNER) {
    return await bot.sendMessage(chatId, '⛔ Bu komut sadece bot sahibine özeldir.');
  }

  const targetUsername = match[1]?.trim().replace('@', '');
  if (!targetUsername) {
    return await bot.sendMessage(chatId, '❌ Kullanım: /ban @kullanıcı');
  }

  try {
    const targetUser = await User.findByUsername(targetUsername);
    if (!targetUser) {
      return await bot.sendMessage(chatId, `❌ @${targetUsername} bulunamadı.`);
    }

    if (targetUser.is_banned === 1) {
      return await bot.sendMessage(chatId, `⚠️ @${targetUsername} zaten banlı.`);
    }

    await User.banUser(targetUser.telegram_id);

    await bot.sendMessage(chatId,
      `🔨 <b>Kullanıcı Banlandı</b>\n👤 @${escapeHtml(targetUsername)}\n🆔 ID: ${targetUser.telegram_id}`,
      { parse_mode: 'HTML' }
    );

    try {
      await bot.sendMessage(targetUser.telegram_id, '⛔ Hesabınız yasaklanmıştır. Destek için bot sahibiyle iletişime geçin.');
    } catch (e) {}

    console.log(`🔨 BAN: @${targetUsername} (${targetUser.telegram_id})`);
  } catch (error) {
    await bot.sendMessage(chatId, `❌ Hata: ${error.message}`);
  }
});

bot.onText(/\/unban(?: (.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || '';

  if (username !== BOT_OWNER) {
    return await bot.sendMessage(chatId, '⛔ Bu komut sadece bot sahibine özeldir.');
  }

  const targetUsername = match[1]?.trim().replace('@', '');
  if (!targetUsername) {
    return await bot.sendMessage(chatId, '❌ Kullanım: /unban @kullanıcı');
  }

  try {
    const targetUser = await User.findByUsername(targetUsername);
    if (!targetUser) {
      return await bot.sendMessage(chatId, `❌ @${targetUsername} bulunamadı.`);
    }

    if (targetUser.is_banned === 0) {
      return await bot.sendMessage(chatId, `⚠️ @${targetUsername} zaten banlı değil.`);
    }

    await User.unbanUser(targetUser.telegram_id);

    await bot.sendMessage(chatId,
      `✅ <b>Ban Kaldırıldı</b>\n👤 @${escapeHtml(targetUsername)}\n🆔 ID: ${targetUser.telegram_id}`,
      { parse_mode: 'HTML' }
    );

    try {
      await bot.sendMessage(targetUser.telegram_id, '✅ Hesabınızın yasağı kaldırılmıştır. Botu tekrar kullanabilirsiniz!');
    } catch (e) {}

    console.log(`✅ UNBAN: @${targetUsername} (${targetUser.telegram_id})`);
  } catch (error) {
    await bot.sendMessage(chatId, `❌ Hata: ${error.message}`);
  }
});

bot.onText(/\/broadcast(?: ([\s\S]+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || '';

  if (username !== BOT_OWNER) {
    return await bot.sendMessage(chatId, '⛔ Bu komut sadece bot sahibine özeldir.');
  }

  const message = match[1]?.trim();
  if (!message) {
    return await bot.sendMessage(chatId, '❌ Kullanım: /broadcast Merhaba! Yeni özellikler eklendi.');
  }

  try {
    const allUsers = await User.getAllUsers();
    const activeUsers = allUsers.filter(u => u.is_banned === 0);

    global.pendingBroadcast = message;

    const confirmKeyboard = {
      inline_keyboard: [[
        { text: `✅ Gönder (${activeUsers.length} kullanıcı)`, callback_data: `broadcast_confirm_${Date.now()}` },
        { text: '❌ İptal', callback_data: 'broadcast_cancel' }
      ]]
    };

    await bot.sendMessage(chatId,
      `📢 <b>Broadcast Önizleme</b>\n\n${escapeHtml(message)}\n\n` +
      `👥 Gönderilecek: <b>${activeUsers.length}</b> kullanıcı\n⚠️ Banlı kullanıcılar hariç tutuldu.`,
      { parse_mode: 'HTML', reply_markup: confirmKeyboard }
    );
  } catch (error) {
    await bot.sendMessage(chatId, `❌ Hata: ${error.message}`);
  }
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
    `📸 <b>${t(lang, 'generate.mode_title')}</b>\n\n${t(lang, 'generate.send_image')}.\n❌ ${t(lang, 'generate.cancel_hint')}: /cancel`,
    { parse_mode: 'HTML' }
  );
}

async function handleBuy(chatId, user, lang) {
  const isUnlimited = await User.hasUnlimitedCredits(user.telegram_id);
  
  let message = `⭐ <b>${t(lang, 'buy.title')}</b>\n\n`;
  message += `🎫 ${t(lang, 'buy.current_credits')}: <b>${isUnlimited ? t(lang, 'general.unlimited') : user.credits}</b>\n\n📦 <b>${t(lang, 'buy.packages')}:</b>\n\n`;
  
  const packages = [
    { id: 'credits_3', stars: 75, credits: 3 },
    { id: 'credits_5', stars: 125, credits: 5 },
    { id: 'credits_10', stars: 250, credits: 10 },
    { id: 'credits_20', stars: 450, credits: 20 },
    { id: 'credits_50', stars: 1000, credits: 50 }
  ];
  
  packages.forEach((p, i) => {
    message += `${i + 1}. ${t(lang, `packages.${p.id}.title`)}\n   ⭐ ${p.stars} → 🎫 ${p.credits}\n\n`;
  });
  
  const keyboard = {
    inline_keyboard: [
      [{ text: '🎫 3 - 75⭐', callback_data: 'buy_credits_3' }, { text: '🎫 5 - 125⭐', callback_data: 'buy_credits_5' }],
      [{ text: '🎫 10 - 250⭐', callback_data: 'buy_credits_10' }, { text: '🎫 20 - 450⭐', callback_data: 'buy_credits_20' }],
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
    `📈 ${t(lang, 'general.total')}: ${stats.total} | ✅ ${stats.completed} | ❌ ${stats.failed}`,
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
    `💰 ${t(lang, 'referral.how_works')}\n` +
    `• ${t(lang, 'referral.link_comer')}: +1 | ${t(lang, 'referral.you_get')}: +1\n\n` +
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
  const stats = queueGetStats();
  await bot.sendMessage(chatId, 
    `📈 ${t(lang, 'stats.title')}\n🔢 Kuyruk: ${stats.queueLength} bekleyen, ${stats.processingCount} işlenen`,
    { reply_markup: getMainMenuKeyboard(lang) }
  );
}

async function handleDailyReward(chatId, user, lang) {
  try {
    const check = await User.canClaimDailyReward(user.telegram_id);
    
    if (!check) {
      return await bot.sendMessage(chatId, `❌ Hata oluştu.`, { reply_markup: getMainMenuKeyboard(lang) });
    }
    
    if (check.canClaim === true) {
      const keyboard = {
        inline_keyboard: [[{ text: t(lang, 'daily.claim_button'), callback_data: 'claim_daily' }]]
      };
      return await bot.sendMessage(chatId, 
        `🎁 <b>${t(lang, 'daily.title')}</b>\n\n✅ ${t(lang, 'daily.claim_button')}!\n🎫 +1 ${t(lang, 'general.credits')}`,
        { parse_mode: 'HTML', reply_markup: keyboard }
      );
    }
    
    if (check.reason === 'vip') {
      return await bot.sendMessage(chatId, 
        `👑 ${t(lang, 'general.vip_badge')}\n\n${t(lang, 'general.unlimited')}!`,
        { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard(lang) }
      );
    }
    
    const timeStr = (check.remainingHours > 0) 
      ? `${check.remainingHours} ${t(lang, 'daily.in_hours')}`
      : `${check.remainingMinutes || 0} ${t(lang, 'daily.in_minutes')}`;
    
    await bot.sendMessage(chatId, 
      `🎁 <b>${t(lang, 'daily.title')}</b>\n\n⏳ ${t(lang, 'daily.already_claimed')}\n\n🕐 ${t(lang, 'daily.next_reward')}: ${timeStr}`,
      { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard(lang) }
    );
  } catch (error) {
    console.error('Daily reward hatası:', error);
    await bot.sendMessage(chatId, `❌ Hata: ${error.message}`, { reply_markup: getMainMenuKeyboard(lang) });
  }
}

async function handleQueueStatus(chatId, user, lang) {
  const status = queueGetStatus(user.telegram_id);
  const stats = queueGetStats();
  
  let message = `🔢 <b>${t(lang, 'queue.title')}</b>\n\n`;
  
  if (status.status === 'processing') {
    message += `🔄 ${t(lang, 'queue.processing_now')}!`;
  } else if (status.status === 'queued') {
    message += `📍 ${t(lang, 'queue.position')}: <b>${status.position}</b>\n`;
    message += `⏱️ ~${status.estimatedWait} ${t(lang, 'queue.minutes')}`;
  } else {
    message += `✅ ${t(lang, 'queue.not_in_queue')}.\n\n`;
    message += `📊 Kuyruk: ${stats.queueLength} bekleyen`;
  }
  
  await bot.sendMessage(chatId, message, { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard(lang) });
}

async function handleLanguageSelect(chatId, user, lang) {
  await bot.sendMessage(chatId, 
    `🌐 <b>${t(lang, 'language.title')}</b>\n\n${t(lang, 'language.current')}: ${getLanguageName(lang)}`,
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
    `/daily - ${t(lang, 'commands.daily')}\n` +
    `/queue - ${t(lang, 'commands.queue')}\n` +
    `/language - ${t(lang, 'commands.language')}\n` +
    `/help - ${t(lang, 'commands.help')}`,
    { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard(lang) }
  );
}

// ========== FOTOĞRAF İŞLEYİCİ ==========

bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;

  // Ban kontrolü
  const banned = await User.isBanned(msg.from.id);
  if (banned) {
    return await bot.sendMessage(chatId, '⛔ Hesabınız yasaklanmıştır.');
  }

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
  const isUnlimited = await User.hasUnlimitedCredits(user.telegram_id);
  
  if (!isUnlimited && user.credits <= 0) {
    await User.updateState(msg.from.id, null, { temp_image_url: null, temp_file_id: null, temp_image_buffer: null });
    return await bot.sendMessage(chatId, `❌ ${t(lang, 'generate.no_credits')}!`, { reply_markup: getMainMenuKeyboard(lang) });
  }
  
  const queueResult = queueEnqueue(msg.from.id, { prompt, user });
  
  if (!queueResult.success && queueResult.message === 'already_in_queue') {
    return await bot.sendMessage(chatId, 
      `📥 ${t(lang, 'queue.queue_info')}.\n📍 ${t(lang, 'queue.position')}: ${queueResult.position}`,
      { reply_markup: getMainMenuKeyboard(lang) }
    );
  }
  
  if (!queueResult.success && queueResult.message === 'already_processing') {
    return await bot.sendMessage(chatId, `🔄 ${t(lang, 'queue.processing_now')}!`, { reply_markup: getMainMenuKeyboard(lang) });
  }
  
  await User.updateState(msg.from.id, 'processing', { temp_image_url: null, temp_file_id: null, temp_image_buffer: null });
  
  const statusMsg = await bot.sendMessage(chatId, 
    `📥 ${t(lang, 'queue.queue_info')}\n📍 ${t(lang, 'queue.position')}: ${queueResult.position}\n\n📝 "${escapeHtml(prompt)}"`,
    { parse_mode: 'HTML' }
  );
  
  const startTime = Date.now();
  let inputMessageId = null;
  
  try {
    let maxWait = 300;
    let waited = 0;
    while (waited < maxWait) {
      const item = queueDequeue();
      if (item && item.userId === msg.from.id) break;
      await new Promise(resolve => setTimeout(resolve, 2000));
      waited += 2;
      
      const currentStatus = queueGetStatus(msg.from.id);
      if (currentStatus.status === 'queued') {
        try {
          await bot.editMessageText(
            `📥 ${t(lang, 'queue.queue_info')}\n📍 ${t(lang, 'queue.position')}: ${currentStatus.position}\n\n📝 "${escapeHtml(prompt)}"`,
            { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' }
          );
        } catch (e) {}
      }
    }
    
    try {
      await bot.editMessageText(
        `⏳ <b>${t(lang, 'generate.processing_started')}</b>\n\n📝 "${escapeHtml(prompt)}"`,
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
      queueComplete(msg.from.id);
      
      const updatedUser = await User.findById(msg.from.id);
      await sendOutputToChannel(result.imageBuffer, prompt, user.username, msg.from.id, inputMessageId, processingTime);
      
      await Generation.create({
        user_id: msg.from.id,
        username: user.username,
        prompt,
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
    queueComplete(msg.from.id);
    await sendErrorToChannel(prompt, user.username, msg.from.id, error.message, inputMessageId);
    await Generation.create({ user_id: msg.from.id, username: user.username, prompt, status: 'failed', error_message: error.message });
    try { await bot.deleteMessage(chatId, statusMsg.message_id); } catch (e) {}
    await bot.sendMessage(chatId, 
      `😔 <b>${t(lang, 'generate.error_occurred')}</b>\n\n🔄 ${t(lang, 'generate.try_again')}: /generate`,
      { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard(lang) }
    );
  }
}

// ========== CALLBACK QUERY ==========

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const userId = query.from.id;
  
  // Günlük ödül
  if (data === 'claim_daily') {
    const user = await User.findById(userId);
    const lang = getUserLanguage(user);
    const result = await User.claimDailyReward(userId);
    
    if (result && result.success) {
      await bot.answerCallbackQuery(query.id, { text: `🎉 +1 ${t(lang, 'general.credits')}!`, show_alert: true });
      await bot.sendMessage(chatId, 
        `🎁 ${t(lang, 'daily.claim_success')}!\n🎫 ${t(lang, 'daily.earned_credit')}\n📊 ${t(lang, 'general.total')}: ${result.newCredits}`,
        { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard(lang) }
      );
    } else {
      await bot.answerCallbackQuery(query.id, { text: `⏳ ${t(lang, 'daily.already_claimed')}`, show_alert: true });
    }
    return;
  }
  
  // Dil değiştirme
  if (data.startsWith('lang_')) {
    const newLang = data.replace('lang_', '');
    await User.setLanguage(userId, newLang);
    await bot.answerCallbackQuery(query.id, { text: `✅ ${getLanguageName(newLang)}`, show_alert: false });
    
    await bot.sendMessage(chatId, 
      `🌐 <b>${t(newLang, 'language.title')}</b>\n\n✅ ${t(newLang, 'language.changed')}!\n${t(newLang, 'language.current')}: ${getLanguageName(newLang)}`,
      { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard(newLang) }
    );
    
    try { await bot.deleteMessage(chatId, query.message.message_id); } catch (e) {}
    return;
  }

  // Broadcast onayla
  if (data.startsWith('broadcast_confirm_')) {
    const adminUser = await User.findById(userId);
    if (adminUser?.username !== BOT_OWNER) return;

    if (!global.pendingBroadcast) {
      return await bot.answerCallbackQuery(query.id, { text: '❌ Broadcast mesajı bulunamadı.', show_alert: true });
    }

    await bot.answerCallbackQuery(query.id, { text: '📢 Gönderiliyor...' });

    const broadcastMessage = global.pendingBroadcast;
    global.pendingBroadcast = null;

    const allUsers = await User.getAllUsers();
    const activeUsers = allUsers.filter(u => u.is_banned === 0);

    let sent = 0, failed = 0;

    for (const u of activeUsers) {
      try {
        await bot.sendMessage(u.telegram_id,
          `📢 <b>Duyuru</b>\n\n${escapeHtml(broadcastMessage)}`,
          { parse_mode: 'HTML' }
        );
        sent++;
        await new Promise(r => setTimeout(r, 50));
      } catch (e) {
        failed++;
      }
    }

    await bot.sendMessage(chatId,
      `✅ <b>Broadcast Tamamlandı</b>\n📤 Gönderildi: <b>${sent}</b>\n❌ Başarısız: <b>${failed}</b>`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  // Broadcast iptal
  if (data === 'broadcast_cancel') {
    global.pendingBroadcast = null;
    await bot.answerCallbackQuery(query.id, { text: '❌ İptal edildi.' });
    try { await bot.deleteMessage(chatId, query.message.message_id); } catch (e) {}
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
      await bot.sendInvoice(chatId, title, description, `stars_${userId}_${productId}`, '', 'XTR', [{ label: title, amount: product.stars }]);
      await bot.answerCallbackQuery(query.id, { text: t(lang, 'buy.payment_opening') });
    } catch (error) {
      await bot.answerCallbackQuery(query.id, { text: `Error: ${error.message}`, show_alert: true });
    }
  }
});

// ========== YILDIZ ÖDEME ==========

bot.on('successful_payment', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username || `user_${userId}`;
  const payment = msg.successful_payment;
  
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
        `🎉 <b>${t(lang, 'buy.payment_success')}</b>!\n\n🎫 ${product.credits} ${t(lang, 'general.credits')}\n📊 ${t(lang, 'general.total')}: ${updatedUser.credits}`,
        { parse_mode: 'HTML', reply_markup: getMainMenuKeyboard(lang) }
      );
      return;
    }
  }
  
  const credits = Math.floor(payment.total_amount / 25);
  if (credits > 0) {
    await User.updateCredits(userId, credits);
    const updatedUser = await User.findById(userId);
    await bot.sendMessage(chatId, 
      `🎉 <b>${t(lang, 'buy.payment_success')}</b>!\n🎫 ${credits} ${t(lang, 'buy.added_credits')}`,
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
