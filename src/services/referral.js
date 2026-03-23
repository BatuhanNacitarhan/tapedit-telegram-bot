const crypto = require('crypto');
const User = require('../models/User');
const db = require('../database');

class ReferralService {
  // Kullanıcının MEVCUT referans kodunu getir (yeni oluşturma!)
  static getReferralCode(telegramId) {
    const user = User.findById(telegramId);
    if (user && user.referral_code) {
      return user.referral_code;
    }
    
    // Sadece kod yoksa yeni oluştur
    const newCode = crypto
      .createHash('md5')
      .update(telegramId.toString())
      .digest('hex')
      .substring(0, 8)
      .toUpperCase();
    
    return newCode;
  }
  
  static generateReferralLink(referralCode, botUsername) {
    return `https://t.me/${botUsername}?start=${referralCode}`;
  }
  
  static processReferral(newUserId, referralCode) {
    const referrer = User.findByReferralCode(referralCode);
    
    if (!referrer) {
      console.log('❌ Referans kodu bulunamadı:', referralCode);
      return { success: false, reason: 'invalid_code' };
    }
    
    if (referrer.telegram_id === newUserId) {
      console.log('❌ Kullanıcı kendi kodunu kullandı');
      return { success: false, reason: 'self_referral' };
    }
    
    const newUser = User.findById(newUserId);
    if (!newUser) {
      return { success: false, reason: 'user_not_found' };
    }
    
    if (newUser.referred_by !== null) {
      console.log('❌ Kullanıcının zaten referansı var');
      return { success: false, reason: 'already_referred' };
    }
    
    const REFERRED_BONUS = parseInt(process.env.REFERRED_BONUS) || 2;
    const REFERRER_BONUS = parseInt(process.env.REFERRER_BONUS) || 3;
    
    // Yeni kullanıcıya bonus
    User.setReferredBy(newUserId, referrer.telegram_id);
    User.updateCredits(newUserId, REFERRED_BONUS);
    
    // Referans sahibine bonus
    User.updateCredits(referrer.telegram_id, REFERRER_BONUS);
    
    console.log(`✅ Referans başarılı: ${referrer.username} -> ${newUser.username}`);
    
    return {
      success: true,
      referrer_bonus: REFERRER_BONUS,
      referred_bonus: REFERRED_BONUS
    };
  }
  
  static getReferralStats(telegramId) {
    const result = db.prepare(`
      SELECT COUNT(*) as total_referrals
      FROM users 
      WHERE referred_by = ?
    `).get(telegramId);
    
    const REFERRER_BONUS = parseInt(process.env.REFERRER_BONUS) || 3;
    
    return {
      total_referrals: result.total_referrals,
      total_credits_earned: result.total_referrals * REFERRER_BONUS
    };
  }
  
  // Kullanıcının referansla gelenleri listele
  static getReferrals(telegramId) {
    return db.prepare(`
      SELECT telegram_id, username, credits, created_at
      FROM users
      WHERE referred_by = ?
      ORDER BY created_at DESC
    `).all(telegramId);
  }
}

module.exports = ReferralService;
