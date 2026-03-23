const crypto = require('crypto');
const { dbHelper, getLocalDb, isTurso } = require('../database');

const UNLIMITED_USERS = ['wraith0_0', 'Irresistible_2'];

class User {
  static async findOrCreate(telegramId, username = '') {
    let user = await dbHelper.get('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
    
    if (!user) {
      const referralCode = crypto
        .createHash('md5')
        .update(telegramId.toString())
        .digest('hex')
        .substring(0, 8)
        .toUpperCase();
      
      const cleanUsername = username.replace('@', '');
      const isUnlimited = UNLIMITED_USERS.includes(cleanUsername);
      const initialCredits = isUnlimited ? 999999 : 5;
      
      await dbHelper.run(
        `INSERT INTO users (telegram_id, username, credits, referral_code, is_unlimited, language)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [telegramId, username, initialCredits, referralCode, isUnlimited ? 1 : 0, 'tr']
      );
      
      user = await dbHelper.get('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
      console.log(`👤 YENİ: ${username} | Kredi: ${initialCredits}${isUnlimited ? ' (SINIRSIZ)' : ''}`);
    } else {
      if (username && user.username !== username) {
        await dbHelper.run(
          'UPDATE users SET username = ?, last_active = CURRENT_TIMESTAMP WHERE telegram_id = ?',
          [username, telegramId]
        );
      }
      console.log(`👤 Mevcut: ${user.username} | Kredi: ${user.credits}`);
    }
    
    return user;
  }
  
  static async findById(telegramId) {
    return await dbHelper.get('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
  }
  
  static async findByUsername(username) {
    return await dbHelper.get('SELECT * FROM users WHERE username = ?', [username.replace('@', '')]);
  }
  
  static async findByReferralCode(code) {
    return await dbHelper.get('SELECT * FROM users WHERE referral_code = ?', [code]);
  }
  
  static async updateState(telegramId, state, extras = {}) {
    const updates = ['state = ?', 'last_active = CURRENT_TIMESTAMP'];
    const values = [state];
    
    if (extras.temp_image_url !== undefined) {
      updates.push('temp_image_url = ?');
      values.push(extras.temp_image_url);
    }
    if (extras.temp_file_id !== undefined) {
      updates.push('temp_file_id = ?');
      values.push(extras.temp_file_id);
    }
    if (extras.temp_image_buffer !== undefined) {
      updates.push('temp_image_buffer = ?');
      values.push(extras.temp_image_buffer);
    }
    
    values.push(telegramId);
    await dbHelper.run(`UPDATE users SET ${updates.join(', ')} WHERE telegram_id = ?`, values);
  }
  
  static async updateCredits(telegramId, change) {
    const user = await this.findById(telegramId);
    
    if (user && user.is_unlimited === 1) {
      console.log(`∞ Sınırsız kullanıcı, kredi değişmedi`);
      return;
    }
    
    await dbHelper.run(
      'UPDATE users SET credits = credits + ?, last_active = CURRENT_TIMESTAMP WHERE telegram_id = ?',
      [change, telegramId]
    );
  }
  
  static async setReferredBy(telegramId, referredBy) {
    await dbHelper.run(
      'UPDATE users SET referred_by = ? WHERE telegram_id = ?',
      [referredBy, telegramId]
    );
  }
  
  static async hasUnlimitedCredits(telegramId) {
    const user = await this.findById(telegramId);
    return user && user.is_unlimited === 1;
  }
  
  // ========== DİL FONKSİYONLARI ==========
  
  static async setLanguage(telegramId, language) {
    await dbHelper.run(
      'UPDATE users SET language = ?, last_active = CURRENT_TIMESTAMP WHERE telegram_id = ?',
      [language, telegramId]
    );
  }
  
  static async getLanguage(telegramId) {
    const user = await this.findById(telegramId);
    return user?.language || 'tr';
  }
  
  // ========== GÜNLÜK ÖDÜL FONKSİYONLARI ==========
  
  static async canClaimDailyReward(telegramId) {
    try {
      const user = await this.findById(telegramId);
      
      // Kullanıcı yoksa
      if (!user) {
        return { canClaim: false, reason: 'user_not_found' };
      }
      
      // VIP kullanıcılar için
      if (user.is_unlimited === 1) {
        return { canClaim: false, reason: 'vip' };
      }
      
      // Hiç ödül almamışsa
      if (!user.last_daily_reward) {
        return { canClaim: true };
      }
      
      const lastReward = new Date(user.last_daily_reward);
      const now = new Date();
      const hoursSinceLastReward = (now - lastReward) / (1000 * 60 * 60);
      
      // 24 saat geçmişse
      if (hoursSinceLastReward >= 24) {
        return { canClaim: true };
      }
      
      // Süre dolmamış
      const nextRewardTime = new Date(lastReward.getTime() + 24 * 60 * 60 * 1000);
      const remainingMs = nextRewardTime - now;
      const remainingHours = Math.floor(remainingMs / (1000 * 60 * 60));
      const remainingMinutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
      
      return {
        canClaim: false,
        nextRewardTime,
        remainingHours: Math.max(0, remainingHours),
        remainingMinutes: Math.max(0, remainingMinutes)
      };
    } catch (error) {
      console.error('canClaimDailyReward hatası:', error);
      return { canClaim: false, reason: 'error', error: error.message };
    }
  }
  
  static async claimDailyReward(telegramId) {
    const check = await this.canClaimDailyReward(telegramId);
    
    if (!check.canClaim) {
      return { success: false, ...check };
    }
    
    // Kredi ekle
    await dbHelper.run(
      `UPDATE users 
       SET credits = credits + 1, 
           last_daily_reward = CURRENT_TIMESTAMP, 
           last_active = CURRENT_TIMESTAMP 
       WHERE telegram_id = ?`,
      [telegramId]
    );
    
    const user = await this.findById(telegramId);
    console.log(`🎁 Günlük ödül: ${telegramId} | Yeni kredi: ${user.credits}`);
    
    return { 
      success: true, 
      newCredits: user.credits 
    };
  }
  
  // Sync versiyon
  static findByIdSync(telegramId) {
    if (isTurso()) return null;
    const localDb = getLocalDb();
    if (localDb) {
      return localDb.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
    }
    return null;
  }
}

module.exports = User;
