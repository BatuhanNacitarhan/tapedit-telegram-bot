const crypto = require('crypto');
const User = require('../models/User');
const db = require('../database');

class ReferralService {
  static generateReferralLink(code, botUsername) {
    return `https://t.me/${botUsername}?start=${code}`;
  }
  
  static processReferral(newUserId, referralCode) {
    const referrer = User.findByReferralCode(referralCode);
    if (!referrer || referrer.telegram_id === newUserId) return false;
    
    const newUser = User.findById(newUserId);
    if (!newUser || newUser.referred_by !== null) return false;
    
    const REFERRED_BONUS = parseInt(process.env.REFERRED_BONUS) || 2;
    const REFERRER_BONUS = parseInt(process.env.REFERRER_BONUS) || 3;
    
    User.setReferredBy(newUserId, referrer.telegram_id);
    User.updateCredits(newUserId, REFERRED_BONUS);
    User.updateCredits(referrer.telegram_id, REFERRER_BONUS);
    
    console.log(`✅ Referans: ${referrer.telegram_id} -> ${newUserId}`);
    return true;
  }
  
  static getReferralStats(telegramId) {
    const result = db.prepare('SELECT COUNT(*) as total_referrals FROM users WHERE referred_by = ?').get(telegramId);
    return { total_referrals: result.total_referrals, total_credits_earned: result.total_referrals * (parseInt(process.env.REFERRER_BONUS) || 3) };
  }
}

module.exports = ReferralService;
