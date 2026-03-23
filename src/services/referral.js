const crypto = require('crypto');
const User = require('../models/User');
const { dbHelper } = require('../database');

class ReferralService {
  static getReferralCode(telegramId) {
    return crypto.createHash('md5').update(telegramId.toString()).digest('hex').substring(0, 8).toUpperCase();
  }
  
  static generateReferralLink(code, botUsername) {
    return `https://t.me/${botUsername}?start=${code}`;
  }
  
  static async processReferral(newUserId, code) {
    const referrer = await User.findByReferralCode(code);
    
    if (!referrer) return { success: false, reason: 'invalid_code' };
    if (referrer.telegram_id === newUserId) return { success: false, reason: 'self' };
    
    const newUser = await User.findById(newUserId);
    if (!newUser) return { success: false, reason: 'not_found' };
    if (newUser.referred_by !== null) return { success: false, reason: 'already' };
    
    await User.setReferredBy(newUserId, referrer.telegram_id);
    await User.updateCredits(newUserId, 1);
    await User.updateCredits(referrer.telegram_id, 1);
    
    console.log(`✅ Referral: ${referrer.username} -> ${newUser.username}`);
    return { success: true, referrer_bonus: 1, referred_bonus: 1 };
  }
  
  static async getReferralStats(telegramId) {
    const result = await dbHelper.get('SELECT COUNT(*) as c FROM users WHERE referred_by = ?', [telegramId]);
    return { total_referrals: result?.c || 0, total_credits_earned: (result?.c || 0) };
  }
}

module.exports = ReferralService;
