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
    // ... tüm çeviriler
  },
  en: { /* İngilizce */ },
  ru: { /* Rusça */ },
  zh: { /* Çince */ }
};

function getUserLanguage(user) { return user?.language || 'tr'; }
function t(lang, key, params = {}) { /* çeviri fonksiyonu */ }
function getLanguageKeyboard() { /* dil seçim butonları */ }
