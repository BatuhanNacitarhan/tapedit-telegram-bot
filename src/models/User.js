const db = require('../database');
const crypto = require('crypto');

class User {
  static async findOrCreate(telegramId, username = '') {
    let user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
    
    if (!user) {
      const referralCode = crypto.createHash('md5').update(telegramId.toString() + Date.now().toString()).digest('hex').substring(0, 8).toUpperCase();
      db.prepare('INSERT INTO users (telegram_id, username, credits, referral_code) VALUES (?, ?, ?, ?)').run(telegramId, username, 5, referralCode);
      user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
      console.log(`👤 Yeni kullanıcı: ${username}`);
    }
    return user;
  }
  
  static findById(telegramId) {
    return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
  }
  
  static findByReferralCode(code) {
    return db.prepare('SELECT * FROM users WHERE referral_code = ?').get(code);
  }
  
  static updateState(telegramId, state, extras = {}) {
    const updates = ['state = ?', 'last_active = CURRENT_TIMESTAMP'];
    const values = [state];
    if (extras.temp_image_url !== undefined) { updates.push('temp_image_url = ?'); values.push(extras.temp_image_url); }
    if (extras.temp_file_id !== undefined) { updates.push('temp_file_id = ?'); values.push(extras.temp_file_id); }
    values.push(telegramId);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE telegram_id = ?`).run(...values);
  }
  
  static updateCredits(telegramId, change) {
    db.prepare('UPDATE users SET credits = credits + ?, last_active = CURRENT_TIMESTAMP WHERE telegram_id = ?').run(change, telegramId);
  }
  
  static setReferredBy(telegramId, referredBy) {
    db.prepare('UPDATE users SET referred_by = ? WHERE telegram_id = ?').run(referredBy, telegramId);
  }
}

module.exports = User;
