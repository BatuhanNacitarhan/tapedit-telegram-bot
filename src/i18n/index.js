/**
 * Çoklu Dil Desteği - i18n Module
 * Desteklenen diller: Türkçe (tr), İngilizce (en), Rusça (ru), Çince (zh)
 */

const translations = {
  // ========== TÜRKÇE ==========
  tr: {
    menu: {
      generate: '🎨 Görsel Oluştur',
      buy: '⭐ Hak Satın Al',
      account: '📊 Hesabım',
      referral: '🔗 Referansım',
      history: '📜 Geçmiş',
      stats: '📈 İstatistikler',
      help: '❓ Yardım',
      daily_reward: '🎁 Günlük Ödül',
      queue_status: '🔢 Sıramı Gör',
      language: '🌐 Dil Seç'
    },
    general: {
      vip_badge: '👑 VIP',
      unlimited: '∞ SINIRSIZ',
      credits: 'Hak',
      remaining: 'Kalan Hak',
      total: 'Toplam',
      completed: 'Tamamlandı',
      failed: 'Başarısız',
      registered: 'Kayıt',
      cancel: 'İptal',
      processing: 'İşleniyor',
      ready: 'Hazır',
      error: 'Hata',
      success: 'Başarılı',
      welcome: 'Hoş geldiniz',
      seconds: 'saniye'
    },
    commands: {
      start: 'Botu başlat',
      generate: 'AI görsel oluştur',
      buy: 'Yıldız ile hak satın al',
      balance: 'Hak durumunu göster',
      referral: 'Referans linkini al',
      history: 'Görsel geçmişini göster',
      stats: 'İstatistikler (VIP)',
      help: 'Yardım menüsü',
      daily: 'Günlük ödül al',
      queue: 'Sıra durumunu göster',
      language: 'Dil değiştir'
    },
    start: {
      title: 'Tapedit AI Image Bot',
      welcome: 'Hoş geldiniz',
      credits_display: 'Kalan Hak',
      select_menu: 'Menüden seçim yapın',
      referral_bonus: 'Referans bonusu!',
      earned_credits: 'hak kazandınız!'
    },
    generate: {
      no_credits: 'Hakkınız kalmadı!',
      buy_credits: 'Hak Satın Al butonuna tıklayın',
      mode_title: 'Görüntü Oluşturma Modu',
      send_image: 'Lütfen düzenlemek istediğiniz görseli gönderin',
      cancel_hint: 'İptal',
      image_received: 'Görsel alındı!',
      write_prompt: 'Ne yapılmasını istediğinizi yazın',
      processing_started: 'İşlem başladı...',
      result_ready: 'Hazır!',
      error_occurred: 'Hata oluştu',
      try_again: 'Tekrar deneyin'
    },
    buy: {
      title: 'YILDIZ İLE HAK SATIN AL',
      vip_status: 'VIP statünüz var!',
      current_credits: 'Mevcut Hak',
      packages: 'Paketler',
      select_package: 'Paket seçin',
      product_not_found: 'Ürün bulunamadı!',
      payment_opening: 'Ödeme açılıyor...',
      payment_success: 'Ödeme Başarılı!',
      stars: 'Yıldız',
      added_credits: 'Hak eklendi'
    },
    packages: {
      credits_3: { title: '3 Görsel Hakkı', description: '3 adet AI görsel üretme hakkı' },
      credits_5: { title: '5 Görsel Hakkı', description: '5 adet AI görsel üretme hakkı' },
      credits_10: { title: '10 Görsel Hakkı', description: '10 adet AI görsel üretme hakkı' },
      credits_20: { title: '20 Görsel Hakkı', description: '20 adet AI görsel üretme hakkı' },
      credits_50: { title: '50 Görsel Hakkı', description: '50 adet AI görsel üretme hakkı' }
    },
    account: {
      title: 'Hesap Durumunuz',
      username: 'Kullanıcı adı',
      remaining_credits: 'Kalan Hak',
      total_generations: 'Toplam görsel',
      registration_date: 'Kayıt tarihi'
    },
    referral: {
      title: 'Referans Sistemi',
      code: 'Kod',
      link: 'Link',
      how_works: 'Nasıl Çalışır?',
      link_comer: 'Linkinizle gelen',
      you_get: 'Siz',
      total_referrals: 'Toplam referans'
    },
    history: {
      title: 'Son Görselleriniz',
      empty: 'Henüz görsel geçmişiniz yok'
    },
    stats: {
      title: 'İstatistikler',
      data_available: 'saatlik veri mevcut',
      vip_only: 'Bu komut sadece VIP ve bot sahibi için'
    },
    help: {
      title: 'Yardım',
      bot_description: 'AI görüntü düzenleme botu',
      commands_title: 'Komutlar',
      usage_title: 'Kullanım',
      usage_step1: "Görsel Oluştur'a tıklayın",
      usage_step2: 'Görsel gönderin',
      usage_step3: 'Prompt yazın',
      usage_step4: 'Sonucu bekleyin'
    },
    daily: {
      title: 'Günlük Ödül',
      already_claimed: 'Ödülünüzü zaten aldınız!',
      next_reward: 'Sonraki ödül',
      in_hours: 'saat sonra',
      in_minutes: 'dakika sonra',
      claim_success: 'Günlük ödül aldınız!',
      earned_credit: '1 hak kazandınız',
      claim_button: 'Ödülü Al',
      check_time: 'Kontrol Et'
    },
    queue: {
      title: 'Kuyruk Durumu',
      in_queue: 'Kuyruktasınız',
      position: 'Sıranız',
      not_in_queue: 'Kuyrukta değilsiniz',
      estimated_wait: 'Tahmini bekleme',
      minutes: 'dakika',
      queue_info: 'İşleminiz sıraya alındı',
      processing_now: 'İşleminiz yapılıyor',
      people_ahead: 'kişi önce'
    },
    language: {
      title: 'Dil Seçimi',
      select: 'Dil seçin',
      current: 'Mevcut dil',
      changed: 'Dil değiştirildi!',
      select_new: 'Yeni dil seçin'
    },
    errors: {
      general: 'Bir hata oluştu',
      no_image: 'Önce Görsel Oluştur butonuna tıklayın',
      operation_cancelled: 'İşlem iptal edildi'
    }
  },
  
  // ========== İNGİLİZCE ==========
  en: {
    menu: {
      generate: '🎨 Create Image',
      buy: '⭐ Buy Credits',
      account: '📊 My Account',
      referral: '🔗 My Referral',
      history: '📜 History',
      stats: '📈 Statistics',
      help: '❓ Help',
      daily_reward: '🎁 Daily Reward',
      queue_status: '🔢 My Queue',
      language: '🌐 Language'
    },
    general: {
      vip_badge: '👑 VIP',
      unlimited: '∞ UNLIMITED',
      credits: 'Credits',
      remaining: 'Remaining',
      total: 'Total',
      completed: 'Completed',
      failed: 'Failed',
      registered: 'Registered',
      cancel: 'Cancel',
      processing: 'Processing',
      ready: 'Ready',
      error: 'Error',
      success: 'Success',
      welcome: 'Welcome',
      seconds: 'seconds'
    },
    commands: {
      start: 'Start the bot',
      generate: 'Create AI image',
      buy: 'Buy credits with stars',
      balance: 'Show credit status',
      referral: 'Get referral link',
      history: 'Show image history',
      stats: 'Statistics (VIP)',
      help: 'Help menu',
      daily: 'Claim daily reward',
      queue: 'Show queue status',
      language: 'Change language'
    },
    start: {
      title: 'Tapedit AI Image Bot',
      welcome: 'Welcome',
      credits_display: 'Remaining Credits',
      select_menu: 'Select from menu',
      referral_bonus: 'Referral bonus!',
      earned_credits: 'credits earned!'
    },
    generate: {
      no_credits: 'No credits remaining!',
      buy_credits: 'Click Buy Credits button',
      mode_title: 'Image Creation Mode',
      send_image: 'Please send the image you want to edit',
      cancel_hint: 'Cancel',
      image_received: 'Image received!',
      write_prompt: 'Write what you want to do',
      processing_started: 'Processing started...',
      result_ready: 'Ready!',
      error_occurred: 'Error occurred',
      try_again: 'Try again'
    },
    buy: {
      title: 'BUY CREDITS WITH STARS',
      vip_status: 'You have VIP status!',
      current_credits: 'Current Credits',
      packages: 'Packages',
      select_package: 'Select package',
      product_not_found: 'Product not found!',
      payment_opening: 'Opening payment...',
      payment_success: 'Payment Successful!',
      stars: 'Stars',
      added_credits: 'credits added'
    },
    packages: {
      credits_3: { title: '3 Image Credits', description: '3 AI image generation credits' },
      credits_5: { title: '5 Image Credits', description: '5 AI image generation credits' },
      credits_10: { title: '10 Image Credits', description: '10 AI image generation credits' },
      credits_20: { title: '20 Image Credits', description: '20 AI image generation credits' },
      credits_50: { title: '50 Image Credits', description: '50 AI image generation credits' }
    },
    account: {
      title: 'Your Account Status',
      username: 'Username',
      remaining_credits: 'Remaining Credits',
      total_generations: 'Total images',
      registration_date: 'Registration date'
    },
    referral: {
      title: 'Referral System',
      code: 'Code',
      link: 'Link',
      how_works: 'How it works?',
      link_comer: 'Link visitor',
      you_get: 'You get',
      total_referrals: 'Total referrals'
    },
    history: {
      title: 'Your Recent Images',
      empty: 'No image history yet'
    },
    stats: {
      title: 'Statistics',
      data_available: 'hours of data available',
      vip_only: 'This command is for VIP and bot owner only'
    },
    help: {
      title: 'Help',
      bot_description: 'AI image editing bot',
      commands_title: 'Commands',
      usage_title: 'Usage',
      usage_step1: 'Click Create Image',
      usage_step2: 'Send image',
      usage_step3: 'Write prompt',
      usage_step4: 'Wait for result'
    },
    daily: {
      title: 'Daily Reward',
      already_claimed: 'You already claimed your reward!',
      next_reward: 'Next reward',
      in_hours: 'hours',
      in_minutes: 'minutes',
      claim_success: 'Daily reward claimed!',
      earned_credit: 'You earned 1 credit',
      claim_button: 'Claim Reward',
      check_time: 'Check Time'
    },
    queue: {
      title: 'Queue Status',
      in_queue: 'You are in queue',
      position: 'Your position',
      not_in_queue: 'You are not in queue',
      estimated_wait: 'Estimated wait',
      minutes: 'minutes',
      queue_info: 'Your request is queued',
      processing_now: 'Processing now',
      people_ahead: 'people ahead'
    },
    language: {
      title: 'Language Selection',
      select: 'Select language',
      current: 'Current language',
      changed: 'Language changed!',
      select_new: 'Select new language'
    },
    errors: {
      general: 'An error occurred',
      no_image: 'Click Create Image button first',
      operation_cancelled: 'Operation cancelled'
    }
  },
  
  // ========== RUSÇA ==========
  ru: {
    menu: {
      generate: '🎨 Создать изображение',
      buy: '⭐ Купить кредиты',
      account: '📊 Мой аккаунт',
      referral: '🔗 Моя реферал',
      history: '📜 История',
      stats: '📈 Статистика',
      help: '❓ Помощь',
      daily_reward: '🎁 Ежедневная награда',
      queue_status: '🔢 Моя очередь',
      language: '🌐 Язык'
    },
    general: {
      vip_badge: '👑 VIP',
      unlimited: '∞ БЕЗЛИМИТ',
      credits: 'Кредиты',
      remaining: 'Осталось',
      total: 'Всего',
      completed: 'Выполнено',
      failed: 'Ошибка',
      registered: 'Регистрация',
      cancel: 'Отмена',
      processing: 'Обработка',
      ready: 'Готово',
      error: 'Ошибка',
      success: 'Успех',
      welcome: 'Добро пожаловать',
      seconds: 'секунд'
    },
    commands: {
      start: 'Запустить бота',
      generate: 'Создать AI изображение',
      buy: 'Купить кредиты за звёзды',
      balance: 'Показать баланс',
      referral: 'Получить реферальную ссылку',
      history: 'Показать историю',
      stats: 'Статистика (VIP)',
      help: 'Меню помощи',
      daily: 'Получить ежедневную награду',
      queue: 'Показать статус очереди',
      language: 'Сменить язык'
    },
    start: {
      title: 'Tapedit AI Image Bot',
      welcome: 'Добро пожаловать',
      credits_display: 'Осталось кредитов',
      select_menu: 'Выберите в меню',
      referral_bonus: 'Реферальный бонус!',
      earned_credits: 'кредитов получено!'
    },
    generate: {
      no_credits: 'Кредиты закончились!',
      buy_credits: 'Нажмите Купить кредиты',
      mode_title: 'Режим создания изображений',
      send_image: 'Отправьте изображение для редактирования',
      cancel_hint: 'Отмена',
      image_received: 'Изображение получено!',
      write_prompt: 'Напишите что хотите сделать',
      processing_started: 'Обработка началась...',
      result_ready: 'Готово!',
      error_occurred: 'Произошла ошибка',
      try_again: 'Попробуйте снова'
    },
    buy: {
      title: 'КУПИТЬ КРЕДИТЫ ЗА ЗВЁЗДЫ',
      vip_status: 'У вас VIP статус!',
      current_credits: 'Текущие кредиты',
      packages: 'Пакеты',
      select_package: 'Выберите пакет',
      product_not_found: 'Продукт не найден!',
      payment_opening: 'Открытие оплаты...',
      payment_success: 'Оплата успешна!',
      stars: 'Звёзд',
      added_credits: 'кредитов добавлено'
    },
    packages: {
      credits_3: { title: '3 кредита', description: '3 кредита на создание AI изображений' },
      credits_5: { title: '5 кредитов', description: '5 кредитов на создание AI изображений' },
      credits_10: { title: '10 кредитов', description: '10 кредитов на создание AI изображений' },
      credits_20: { title: '20 кредитов', description: '20 кредитов на создание AI изображений' },
      credits_50: { title: '50 кредитов', description: '50 кредитов на создание AI изображений' }
    },
    account: {
      title: 'Статус вашего аккаунта',
      username: 'Имя пользователя',
      remaining_credits: 'Осталось кредитов',
      total_generations: 'Всего изображений',
      registration_date: 'Дата регистрации'
    },
    referral: {
      title: 'Реферальная система',
      code: 'Код',
      link: 'Ссылка',
      how_works: 'Как это работает?',
      link_comer: 'Пришедший по ссылке',
      you_get: 'Вы получаете',
      total_referrals: 'Всего рефералов'
    },
    history: {
      title: 'Ваши последние изображения',
      empty: 'История пуста'
    },
    stats: {
      title: 'Статистика',
      data_available: 'часов данных доступно',
      vip_only: 'Только для VIP и владельца бота'
    },
    help: {
      title: 'Помощь',
      bot_description: 'Бот для редактирования изображений с AI',
      commands_title: 'Команды',
      usage_title: 'Использование',
      usage_step1: 'Нажмите Создать изображение',
      usage_step2: 'Отправьте изображение',
      usage_step3: 'Напишите промпт',
      usage_step4: 'Ожидайте результат'
    },
    daily: {
      title: 'Ежедневная награда',
      already_claimed: 'Вы уже получили награду!',
      next_reward: 'Следующая награда через',
      in_hours: 'часов',
      in_minutes: 'минут',
      claim_success: 'Ежедневная награда получена!',
      earned_credit: 'Вы получили 1 кредит',
      claim_button: 'Получить награду',
      check_time: 'Проверить время'
    },
    queue: {
      title: 'Статус очереди',
      in_queue: 'Вы в очереди',
      position: 'Ваша позиция',
      not_in_queue: 'Вы не в очереди',
      estimated_wait: 'Примерное ожидание',
      minutes: 'минут',
      queue_info: 'Ваш запрос в очереди',
      processing_now: 'Обрабатывается',
      people_ahead: 'человек впереди'
    },
    language: {
      title: 'Выбор языка',
      select: 'Выберите язык',
      current: 'Текущий язык',
      changed: 'Язык изменён!',
      select_new: 'Выберите новый язык'
    },
    errors: {
      general: 'Произошла ошибка',
      no_image: 'Сначала нажмите Создать изображение',
      operation_cancelled: 'Операция отменена'
    }
  },
  
  // ========== ÇİNCE ==========
  zh: {
    menu: {
      generate: '🎨 创建图像',
      buy: '⭐ 购买积分',
      account: '📊 我的账户',
      referral: '🔗 我的推荐',
      history: '📜 历史',
      stats: '📈 统计',
      help: '❓ 帮助',
      daily_reward: '🎁 每日奖励',
      queue_status: '🔢 我的队列',
      language: '🌐 语言'
    },
    general: {
      vip_badge: '👑 VIP',
      unlimited: '∞ 无限',
      credits: '积分',
      remaining: '剩余',
      total: '总计',
      completed: '完成',
      failed: '失败',
      registered: '注册',
      cancel: '取消',
      processing: '处理中',
      ready: '完成',
      error: '错误',
      success: '成功',
      welcome: '欢迎',
      seconds: '秒'
    },
    commands: {
      start: '启动机器人',
      generate: '创建AI图像',
      buy: '用星星购买积分',
      balance: '显示积分状态',
      referral: '获取推荐链接',
      history: '显示图像历史',
      stats: '统计 (VIP)',
      help: '帮助菜单',
      daily: '领取每日奖励',
      queue: '显示队列状态',
      language: '更改语言'
    },
    start: {
      title: 'Tapedit AI图像机器人',
      welcome: '欢迎',
      credits_display: '剩余积分',
      select_menu: '从菜单中选择',
      referral_bonus: '推荐奖励！',
      earned_credits: '积分已获得！'
    },
    generate: {
      no_credits: '积分已用完！',
      buy_credits: '点击购买积分按钮',
      mode_title: '图像创建模式',
      send_image: '请发送您要编辑的图像',
      cancel_hint: '取消',
      image_received: '图像已收到！',
      write_prompt: '写下您想做什么',
      processing_started: '处理已开始...',
      result_ready: '完成！',
      error_occurred: '发生错误',
      try_again: '重试'
    },
    buy: {
      title: '用星星购买积分',
      vip_status: '您有VIP身份！',
      current_credits: '当前积分',
      packages: '套餐',
      select_package: '选择套餐',
      product_not_found: '产品未找到！',
      payment_opening: '正在打开支付...',
      payment_success: '支付成功！',
      stars: '星星',
      added_credits: '积分已添加'
    },
    packages: {
      credits_3: { title: '3个积分', description: '3个AI图像生成积分' },
      credits_5: { title: '5个积分', description: '5个AI图像生成积分' },
      credits_10: { title: '10个积分', description: '10个AI图像生成积分' },
      credits_20: { title: '20个积分', description: '20个AI图像生成积分' },
      credits_50: { title: '50个积分', description: '50个AI图像生成积分' }
    },
    account: {
      title: '您的账户状态',
      username: '用户名',
      remaining_credits: '剩余积分',
      total_generations: '总图像数',
      registration_date: '注册日期'
    },
    referral: {
      title: '推荐系统',
      code: '代码',
      link: '链接',
      how_works: '如何运作？',
      link_comer: '链接访客',
      you_get: '您获得',
      total_referrals: '总推荐数'
    },
    history: {
      title: '您最近的图像',
      empty: '暂无图像历史'
    },
    stats: {
      title: '统计',
      data_available: '小时数据可用',
      vip_only: '此命令仅限VIP和机器人所有者'
    },
    help: {
      title: '帮助',
      bot_description: 'AI图像编辑机器人',
      commands_title: '命令',
      usage_title: '使用方法',
      usage_step1: '点击创建图像',
      usage_step2: '发送图像',
      usage_step3: '写入提示词',
      usage_step4: '等待结果'
    },
    daily: {
      title: '每日奖励',
      already_claimed: '您已领取奖励！',
      next_reward: '下次奖励',
      in_hours: '小时后',
      in_minutes: '分钟后',
      claim_success: '每日奖励已领取！',
      earned_credit: '您获得1个积分',
      claim_button: '领取奖励',
      check_time: '查看时间'
    },
    queue: {
      title: '队列状态',
      in_queue: '您在队列中',
      position: '您的位置',
      not_in_queue: '您不在队列中',
      estimated_wait: '预计等待',
      minutes: '分钟',
      queue_info: '您的请求已排队',
      processing_now: '正在处理',
      people_ahead: '人 ahead'
    },
    language: {
      title: '语言选择',
      select: '选择语言',
      current: '当前语言',
      changed: '语言已更改！',
      select_new: '选择新语言'
    },
    errors: {
      general: '发生错误',
      no_image: '请先点击创建图像按钮',
      operation_cancelled: '操作已取消'
    }
  }
};

// Dil isimleri
const languageNames = {
  tr: '🇹🇷 Türkçe',
  en: '🇬🇧 English',
  ru: '🇷🇺 Русский',
  zh: '🇨🇳 中文'
};

/**
 * Kullanıcının dilini al, varsayılan Türkçe
 */
function getUserLanguage(user) {
  return user?.language || 'tr';
}

/**
 * Çeviri fonksiyonu
 */
function t(lang, key, params) {
  if (!lang) lang = 'tr';
  
  const keys = key.split('.');
  let value = translations[lang];
  
  if (!value) {
    value = translations['tr'];
  }
  
  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = value[k];
    } else {
      // Fallback to Turkish
      value = translations['tr'];
      for (const k2 of keys) {
        if (value && typeof value === 'object' && k2 in value) {
          value = value[k2];
        } else {
          return key;
        }
      }
      break;
    }
  }
  
  if (typeof value !== 'string') {
    return key;
  }
  
  return value;
}

/**
 * Dil seçimi için inline keyboard
 */
function getLanguageKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '🇹🇷 Türkçe', callback_data: 'lang_tr' },
        { text: '🇬🇧 English', callback_data: 'lang_en' }
      ],
      [
        { text: '🇷🇺 Русский', callback_data: 'lang_ru' },
        { text: '🇨🇳 中文', callback_data: 'lang_zh' }
      ]
    ]
  };
}

/**
 * Dil adını al
 */
function getLanguageName(lang) {
  return languageNames[lang] || lang;
}

// EXPORT
module.exports = {
  translations,
  languageNames,
  getUserLanguage,
  t,
  getLanguageKeyboard,
  getLanguageName
};
