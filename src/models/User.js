const crypto = require('crypto');
const { dbHelper } = require('../database');

const UNLIMITED_USERS = ['wraith0_0', 'Irresistible_2'];

class User {
  static async findOrCreate(telegramId, username = '') {
    let user = await dbHelper.get('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
    
    if (!user) {
      const referralCode = crypto.createHash('md5').update(telegramId.toString()).digest('hex').substring(0, 8).toUpperCase();
      const isUnlimited = UNLIMITED_USERS.includes(username.replace('@', ''));
      const credits = isUnlimited ? 999999 : 5;
      
      await dbHelper.run(
        'INSERT INTO users (telegram_id, username, credits, referral_code, is_unlimited) VALUES (?, ?, ?, ?, ?)',
        [telegramId, username, credits, referralCode, isUnlimited ? 1 : 0]
      );
      
      user = await dbHelper.get('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
      console.log(`👤 YENİ: ${username} | Kredi: ${credits}${isUnlimited ? ' (SINIRSIZ)' : ''}`);
    } else {
      if (username && user.username !== username) {
        await dbHelper.run('UPDATE users SET username = ? WHERE telegram_id = ?', [username, telegramId]);
      }
      console.log(`👤 Mevcut: ${user.username} | Kredi: ${user.credits}`);
    }
    
    return user;
  }
  
  static async findById(telegramId) {
    return await dbHelper.get('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
  }
  
  static async findByReferralCode(code) {
    return await dbHelper.get('SELECT * FROM users WHERE referral_code = ?', [code]);
  }
  
  static async updateState(telegramId, state, extras = {}) {
    const sets = ['state = ?'];
    const vals = [state];
    
    if (extras.temp_image_url !== undefined) { sets.push('temp_image_url = ?'); vals.push(extras.temp_image_url); }
    if (extras.temp_file_id !== undefined) { sets.push('temp_file_id = ?'); vals.push(extras.temp_file_id); }
    if (extras.temp_image_buffer !== undefined) { sets.push('temp_image_buffer = ?'); vals.push(extras.temp_image_buffer); }
    
    vals.push(telegramId);
    await dbHelper.run(`UPDATE users SET ${sets.join(', ')} WHERE telegram_id = ?`, vals);
  }
  
  static async updateCredits(telegramId, change) {
    const user = await this.findById(telegramId);
    if (user && user.is_unlimited === 1) {
      console.log('∞ Sınırsız kullanıcı');
      return;
    }
    await dbHelper.run('UPDATE users SET credits = credits + ? WHERE telegram_id = ?', [change, telegramId]);
  }
  
  static async setReferredBy(telegramId, referredBy) {
    await dbHelper.run('UPDATE users SET referred_by = ? WHERE telegram_id = ?', [referredBy, telegramId]);
  }
  
  static async hasUnlimitedCredits(telegramId) {
    const user = await this.findById(telegramId);
    return user && user.is_unlimited === 1;
  }
}

module.exports = User;
