const fs = require('fs');
const path = require('path');

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

let db;
let isTurso = false;

async function initDatabase() {
  if (TURSO_URL && TURSO_AUTH_TOKEN) {
    // TURSO KULLAN
    console.log('🗄️ Turso Database bağlanılıyor...');
    isTurso = true;
    
    const { createClient } = require('@libsql/client');
    
    db = createClient({
      url: TURSO_URL,
      authToken: TURSO_AUTH_TOKEN
    });
    
    // Tabloları TEK TEK oluştur (batch sorun çıkarabilir)
    console.log('📋 Tablolar oluşturuluyor...');
    
    // Users tablosu
    await db.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id INTEGER UNIQUE NOT NULL,
        username TEXT DEFAULT '',
        credits INTEGER DEFAULT 5,
        referral_code TEXT UNIQUE,
        referred_by INTEGER DEFAULT NULL,
        is_unlimited INTEGER DEFAULT 0,
        state TEXT DEFAULT NULL,
        temp_image_url TEXT DEFAULT NULL,
        temp_file_id TEXT DEFAULT NULL,
        temp_image_buffer TEXT DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_active DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ users tablosu');
    
    // Generations tablosu
    await db.execute(`
      CREATE TABLE IF NOT EXISTS generations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        username TEXT,
        prompt TEXT NOT NULL,
        input_file_id TEXT,
        input_image_url TEXT,
        output_file_id TEXT,
        output_image_url TEXT,
        status TEXT DEFAULT 'pending',
        error_message TEXT,
        processing_time REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(telegram_id)
      )
    `);
    console.log('✅ generations tablosu');
    
    // Indexler
    await db.execute('CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_generations_user_id ON generations(user_id)');
    console.log('✅ indexler');
    
    console.log('✅ Turso Database bağlantısı başarılı!');
    console.log(`📡 URL: ${TURSO_URL}`);
    
  } else {
    // LOCAL SQLITE KULLAN
    console.log('🗄️ Local SQLite kullanılıyor...');
    
    const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    
    const dbPath = path.join(DATA_DIR, 'tapedit.db');
    const Database = require('better-sqlite3');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    
    // Tabloları oluştur
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id INTEGER UNIQUE NOT NULL,
        username TEXT DEFAULT '',
        credits INTEGER DEFAULT 5,
        referral_code TEXT UNIQUE,
        referred_by INTEGER DEFAULT NULL,
        is_unlimited INTEGER DEFAULT 0,
        state TEXT DEFAULT NULL,
        temp_image_url TEXT DEFAULT NULL,
        temp_file_id TEXT DEFAULT NULL,
        temp_image_buffer TEXT DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_active DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS generations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        username TEXT,
        prompt TEXT NOT NULL,
        input_file_id TEXT,
        input_image_url TEXT,
        output_file_id TEXT,
        output_image_url TEXT,
        status TEXT DEFAULT 'pending',
        error_message TEXT,
        processing_time REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(telegram_id)
      );

      CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
      CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
      CREATE INDEX IF NOT EXISTS idx_generations_user_id ON generations(user_id);
    `);
    
    console.log('✅ Local SQLite başlatıldı');
    console.log(`📁 Veritabanı: ${dbPath}`);
  }
  
  // Mevcut verileri logla
  try {
    let userCount, generationCount;
    
    if (isTurso) {
      userCount = await db.execute('SELECT COUNT(*) as count FROM users');
      generationCount = await db.execute('SELECT COUNT(*) as count FROM generations');
      console.log(`📊 Mevcut kullanıcı: ${userCount.rows[0].count}`);
      console.log(`📊 Mevcut görsel kaydı: ${generationCount.rows[0].count}`);
    } else {
      userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
      generationCount = db.prepare('SELECT COUNT(*) as count FROM generations').get();
      console.log(`📊 Mevcut kullanıcı: ${userCount.count}`);
      console.log(`📊 Mevcut görsel kaydı: ${generationCount.count}`);
    }
  } catch (e) {
    console.log('📊 Yeni veritabanı, henüz veri yok');
  }
}

// Helper fonksiyonlar
const dbHelper = {
  isTurso: () => isTurso,
  
  async get(sql, params = []) {
    if (isTurso) {
      const result = await db.execute({ sql, args: params });
      return result.rows[0] || null;
    } else {
      return db.prepare(sql).get(...params);
    }
  },
  
  async all(sql, params = []) {
    if (isTurso) {
      const result = await db.execute({ sql, args: params });
      return result.rows;
    } else {
      return db.prepare(sql).all(...params);
    }
  },
  
  async run(sql, params = []) {
    if (isTurso) {
      const result = await db.execute({ sql, args: params });
      return { changes: result.rowsAffected, lastInsertRowid: result.lastInsertRowid };
    } else {
      return db.prepare(sql).run(...params);
    }
  }
};

module.exports = { 
  initDatabase, 
  dbHelper,
  getDb: () => db,
  isTurso: () => isTurso
};
