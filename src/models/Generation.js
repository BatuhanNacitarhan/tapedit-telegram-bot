const db = require('../database');

class Generation {
  static create(data) {
    const result = db.prepare(`
      INSERT INTO generations (user_id, username, prompt, input_file_id, input_image_url, output_file_id, output_image_url, status, processing_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.user_id,
      data.username || null,
      data.prompt,
      data.input_file_id || null,
      data.input_image_url || null,
      data.output_file_id || null,
      data.output_image_url || null,
      data.status || 'pending',
      data.processing_time || null
    );
    
    return result.lastInsertRowid;
  }
  
  static updateOutput(id, output_file_id, output_image_url) {
    db.prepare(`
      UPDATE generations 
      SET output_file_id = ?, output_image_url = ?, status = 'completed'
      WHERE id = ?
    `).run(output_file_id, output_image_url, id);
  }
  
  static getStats(telegramId) {
    return db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM generations 
      WHERE user_id = ?
    `).get(telegramId);
  }
  
  // Kullanıcının tüm görsel geçmişi
  static getUserHistory(telegramId, limit = 50) {
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
  
  // Tüm kullanıcıların geçmişi (admin için)
  static getAllHistory(limit = 100) {
    return db.prepare(`
      SELECT 
        g.id, g.user_id, g.username, g.prompt, 
        g.input_file_id, g.output_file_id,
        g.input_image_url, g.output_image_url,
        g.status, g.processing_time, g.created_at
      FROM generations g
      ORDER BY g.created_at DESC
      LIMIT ?
    `).all(limit);
  }
  
  // İstatistikler
  static getTotalStats() {
    return db.prepare(`
      SELECT 
        COUNT(*) as total_generations,
        COUNT(DISTINCT user_id) as total_users,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM generations
    `).get();
  }
}

module.exports = Generation;
