const crypto = require('crypto');
const { dbHelper, isTurso } = require('../database');

// Sınırsız hak sahibi kullanıcılar
const UNLIMITED_USERS = ['wraith0_0', 'Irresistible_2'];

class User {
  static async findOrCreate(telegramId, username = '') {
    // Önce kullanıcıyı kontrol et
    let user = await dbHelper.get('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
    
    if (!user) {
      // YENİ KULLANICI - İlk kez kayıt oluyor
      const referralCode = crypto
        .createHash('md5')
        .update(telegramId.toString())
        .digest('hex')
        .substring(0, 8)
        .toUpperCase();
      
      // Sınırsız hak kontrolü
      const cleanUsername = username.replace('@', '');
      const isUnlimited = UNLIMITED_USERS.includes(cleanUsername);
      const initialCredits = isUnlimited ? 999999 : 5;
      
      await dbHelper.run(
        `INSERT INTO users (telegram_id, username, credits, referral_code, is_unlimited)
         VALUES (?, ?, ?, ?, ?)`,
        [telegramId, username, initialCredits, referralCode, isUnlimited ? 1 : 0]
      );
      
      user = await dbHelper.get('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
      console.log(`👤 YENİ kullanıcı: ${username} | Kredi: ${initialCredits}${isUnlimited ? ' (SINIRSIZ)' : ''}`);
    } else {
      // MEVCUT KULLANICI - Krediyi SIFIRLAMA!
      // Sadece username güncelle (değişmiş olabilir)
      if (username && user.username !== username) {
        await dbHelper.run(
          'UPDATE users SET username = ?, last_active = CURRENT_TIMESTAMP WHERE telegram_id = ?',
          [username, telegramId]
        );
      }
      console.log(`👤 Mevcut kullanıcı: ${user.username} | Kredi: ${user.credits}`);
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
    
    // Sınırsız kullanıcılar için kredi düşürme
    if (user && user.is_unlimited === 1) {
      console.log(`∞ Sınırsız kullanıcı, kredi düşürülmedi`);
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
  
  // Sync wrapper'lar (eski kodlarla uyumluluk için)
  static findByIdSync(telegramId) {
    if (isTurso()) {
      throw new Error('Turso kullanırken async metodları kullanın');
    }
    // Local SQLite için senkron erişim
    const db = require('../database').getDb();
    return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
  }
}

module.exports = User;
