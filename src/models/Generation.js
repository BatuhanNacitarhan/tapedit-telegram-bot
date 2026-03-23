const { dbHelper, isTurso } = require('../database');

class Generation {
  static async create(data) {
    const result = await dbHelper.run(
      `INSERT INTO generations (user_id, username, prompt, input_file_id, input_image_url, output_file_id, output_image_url, status, processing_time, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.user_id,
        data.username || null,
        data.prompt,
        data.input_file_id || null,
        data.input_image_url || null,
        data.output_file_id || null,
        data.output_image_url || null,
        data.status || 'pending',
        data.processing_time || null,
        data.error_message || null
      ]
    );
    
    return result.lastInsertRowid;
  }
  
  static async updateOutput(id, output_file_id, output_image_url) {
    await dbHelper.run(
      `UPDATE generations 
       SET output_file_id = ?, output_image_url = ?, status = 'completed'
       WHERE id = ?`,
      [output_file_id, output_image_url, id]
    );
  }
  
  static async getStats(telegramId) {
    const result = await dbHelper.get(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
       FROM generations 
       WHERE user_id = ?`,
      [telegramId]
    );
    
    return result || { total: 0, completed: 0, failed: 0 };
  }
  
  static async getUserHistory(telegramId, limit = 50) {
    return await dbHelper.all(
      `SELECT 
        id, prompt, input_file_id, output_file_id, 
        input_image_url, output_image_url, 
        status, processing_time, created_at
       FROM generations 
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [telegramId, limit]
    );
  }
  
  static async getAllHistory(limit = 100) {
    return await dbHelper.all(
      `SELECT 
        g.id, g.user_id, g.username, g.prompt, 
        g.input_file_id, g.output_file_id,
        g.input_image_url, g.output_image_url,
        g.status, g.processing_time, g.created_at
       FROM generations g
       ORDER BY g.created_at DESC
       LIMIT ?`,
      [limit]
    );
  }
  
  static async getTotalStats() {
    const result = await dbHelper.get(
      `SELECT 
        COUNT(*) as total_generations,
        COUNT(DISTINCT user_id) as total_users,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
       FROM generations`
    );
    
    return result || { total_generations: 0, total_users: 0, completed: 0, failed: 0 };
  }
  
  // Sync wrapper (eski kodlarla uyumluluk için)
  static getStatsSync(telegramId) {
    if (isTurso()) {
      throw new Error('Turso kullanırken async metodları kullanın');
    }
    const db = require('../database').getDb();
    return db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM generations 
      WHERE user_id = ?
    `).get(telegramId);
  }
  
  static getUserHistorySync(telegramId, limit = 50) {
    if (isTurso()) {
      throw new Error('Turso kullanırken async metodları kullanın');
    }
    const db = require('../database').getDb();
    return db.prepare(`
      SELECT 
        id, prompt, input_file_id, output_file_id, 
        input_image_url, output_image_url, 
        status, processing_time, created_at
      FROM generations 
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(telegramId, limit);
  }
}

module.exports = Generation;
