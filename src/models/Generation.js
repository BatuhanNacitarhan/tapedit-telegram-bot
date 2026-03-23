const db = require('../database');

class Generation {
  static create(data) {
    return db.prepare('INSERT INTO generations (user_id, prompt, input_image_url, status, processing_time) VALUES (?, ?, ?, ?, ?)')
      .run(data.user_id, data.prompt, data.input_image_url || null, data.status || 'pending', data.processing_time || null).lastInsertRowid;
  }
  
  static getStats(telegramId) {
    return db.prepare('SELECT COUNT(*) as total, SUM(CASE WHEN status = "completed" THEN 1 ELSE 0 END) as completed, SUM(CASE WHEN status = "failed" THEN 1 ELSE 0 END) as failed FROM generations WHERE user_id = ?').get(telegramId);
  }
}

module.exports = Generation;
