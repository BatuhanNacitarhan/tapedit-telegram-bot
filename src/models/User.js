const db = require('../database');
const crypto = require('crypto');

// Sınırsız hak sahibi kullanıcılar
const UNLIMITED_USERS = ['wraith0_0', 'Irresistible_2'];

class User {
  static async findOrCreate(telegramId, username = '') {
    // Önce kullanıcıyı kontrol et
    let user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
    
    if (!user) {
      // YENİ KULLANICI - İlk kez kayıt oluyor
      const referralCode = crypto
        .createHash('md5')
        .update(telegramId.toString())
        .digest('hex')
        .substring(0, 8)
        .toUpperCase();
      
      // Sınırsız hak kontrolü
      const isUnlimited = UNLIMITED_USERS.includes(username.replace('@', ''));
      const initialCredits = isUnlimited ? 999999 : 5;
      
      db.prepare(`
        INSERT INTO users (telegram_id, username, credits, referral_code, is_unlimited)
        VALUES (?, ?, ?, ?, ?)
      `).run(telegramId, username, initialCredits, referralCode, isUnlimited ? 1 : 0);
      
      user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
      console.log(`👤 YENİ kullanıcı: ${username} | Kredi: ${initialCredits}${isUnlimited ? ' (SINIRSIZ)' : ''}`);
    } else {
      // MEVCUT KULLANICI - Krediyi SIFIRLAMA!
      // Sadece username güncelle (değişmiş olabilir)
      if (username && user.username !== username) {
        db.prepare('UPDATE users SET username = ?, last_active = CURRENT_TIMESTAMP WHERE telegram_id = ?')
          .run(username, telegramId);
      }
      console.log(`👤 Mevcut kullanıcı: ${user.username} | Kredi: ${user.credits}`);
    }
    
    return user;
  }
  
  static findById(telegramId) {
    return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
  }
  
  static findByUsername(username) {
    return db.prepare('SELECT * FROM users WHERE username = ?').get(username.replace('@', ''));
  }
  
  static findByReferralCode(code) {
    return db.prepare('SELECT * FROM users WHERE referral_code = ?').get(code);
  }
  
  static updateState(telegramId, state, extras = {}) {
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
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE telegram_id = ?`).run(...values);
  }
  
  static updateCredits(telegramId, change) {
    const user = this.findById(telegramId);
    
    // Sınırsız kullanıcılar için kredi düşürme
    if (user && user.is_unlimited === 1) {
      console.log(`∞ Sınırsız kullanıcı, kredi düşürülmedi`);
      return;
    }
    
    db.prepare('UPDATE users SET credits = credits + ?, last_active = CURRENT_TIMESTAMP WHERE telegram_id = ?')
      .run(change, telegramId);
  }
  
  static setReferredBy(telegramId, referredBy) {
    db.prepare('UPDATE users SET referred_by = ? WHERE telegram_id = ?')
      .run(referredBy, telegramId);
  }
  
  static hasUnlimitedCredits(telegramId) {
    const user = this.findById(telegramId);
    return user && user.is_unlimited === 1;
  }
}

module.exports = User;
