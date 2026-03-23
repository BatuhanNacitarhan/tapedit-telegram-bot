const crypto = require('crypto');
const User = require('../models/User');
const { dbHelper } = require('../database');

class ReferralService {
  // Kullanıcının MEVCUT referans kodunu getir
  static getReferralCode(telegramId) {
    // Bu fonksiyon sync kalmalı çünkü basit hash üretimi
    return crypto
      .createHash('md5')
      .update(telegramId.toString())
      .digest('hex')
      .substring(0, 8)
      .toUpperCase();
  }
  
  static generateReferralLink(referralCode, botUsername) {
    return `https://t.me/${botUsername}?start=${referralCode}`;
  }
  
  static async processReferral(newUserId, referralCode) {
    const referrer = await User.findByReferralCode(referralCode);
    
    if (!referrer) {
      console.log('❌ Referans kodu bulunamadı:', referralCode);
      return { success: false, reason: 'invalid_code' };
    }
    
    if (referrer.telegram_id === newUserId) {
      console.log('❌ Kullanıcı kendi kodunu kullandı');
      return { success: false, reason: 'self_referral' };
    }
    
    const newUser = await User.findById(newUserId);
    if (!newUser) {
      return { success: false, reason: 'user_not_found' };
    }
    
    if (newUser.referred_by !== null) {
      console.log('❌ Kullanıcının zaten referansı var');
      return { success: false, reason: 'already_referred' };
    }
    
    // HER İKİ TARAFA DA 1 HAK
    const REFERRED_BONUS = 1; // Davet edilene
    const REFERRER_BONUS = 1; // Davet edene
    
    // Yeni kullanıcıya bonus
    await User.setReferredBy(newUserId, referrer.telegram_id);
    await User.updateCredits(newUserId, REFERRED_BONUS);
    
    // Referans sahibine bonus
    await User.updateCredits(referrer.telegram_id, REFERRER_BONUS);
    
    console.log(`✅ Referans başarılı: ${referrer.username} -> ${newUser.username} (+1 hak her ikisine)`);
    
    return {
      success: true,
      referrer_bonus: REFERRER_BONUS,
      referred_bonus: REFERRED_BONUS
    };
  }
  
  static async getReferralStats(telegramId) {
    const result = await dbHelper.get(
      'SELECT COUNT(*) as total_referrals FROM users WHERE referred_by = ?',
      [telegramId]
    );
    
    return {
      total_referrals: result?.total_referrals || 0,
      total_credits_earned: (result?.total_referrals || 0) * 1
    };
  }
  
  static async getReferrals(telegramId) {
    return await dbHelper.all(
      `SELECT telegram_id, username, credits, created_at
       FROM users
       WHERE referred_by = ?
       ORDER BY created_at DESC`,
      [telegramId]
    );
  }
}

module.exports = ReferralService;
