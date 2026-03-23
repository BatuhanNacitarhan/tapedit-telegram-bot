const fs = require('fs');
const path = require('path');

// Turso veya Local SQLite kullan
const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

let db;
let isTurso = false;

// Tablo oluşturma SQL'leri
const CREATE_TABLES = `
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

  CREATE TABLE IF NOT EXISTS referrals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    referrer_id INTEGER NOT NULL,
    referred_id INTEGER NOT NULL,
    credits_awarded INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (referrer_id) REFERENCES users(telegram_id),
    FOREIGN KEY (referred_id) REFERENCES users(telegram_id)
  );

  CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
  CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
  CREATE INDEX IF NOT EXISTS idx_generations_user_id ON generations(user_id);
  CREATE INDEX IF NOT EXISTS idx_generations_created_at ON generations(created_at);
  CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
`;

// Migration SQL'leri
const migrations = [
  { table: 'users', column: 'is_unlimited', type: 'INTEGER DEFAULT 0' },
  { table: 'users', column: 'temp_image_buffer', type: 'TEXT' },
  { table: 'generations', column: 'input_file_id', type: 'TEXT' },
  { table: 'generations', column: 'output_file_id', type: 'TEXT' },
  { table: 'generations', column: 'output_image_url', type: 'TEXT' },
  { table: 'generations', column: 'username', type: 'TEXT' }
];

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
    
    // Tabloları oluştur
    await db.batch(CREATE_TABLES.split(';').filter(s => s.trim()).map(s => ({ sql: s })));
    
    // Migration'ları çalıştır
    for (const { table, column, type } of migrations) {
      try {
        await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      } catch (e) {
        // Kolon zaten var
      }
    }
    
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
    db.exec(CREATE_TABLES);
    
    // Migration'ları çalıştır
    for (const { table, column, type } of migrations) {
      try {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      } catch (e) {
        // Kolon zaten var
      }
    }
    
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

// Helper fonksiyonlar - hem Turso hem Local için
const dbHelper = {
  isTurso: () => isTurso,
  
  // Tek satır getir
  async get(sql, params = []) {
    if (isTurso) {
      const result = await db.execute({ sql, args: params });
      return result.rows[0] || null;
    } else {
      return db.prepare(sql).get(...params);
    }
  },
  
  // Tüm satırları getir
  async all(sql, params = []) {
    if (isTurso) {
      const result = await db.execute({ sql, args: params });
      return result.rows;
    } else {
      return db.prepare(sql).all(...params);
    }
  },
  
  // Çalıştır (INSERT, UPDATE, DELETE)
  async run(sql, params = []) {
    if (isTurso) {
      const result = await db.execute({ sql, args: params });
      return { changes: result.rowsAffected, lastInsertRowid: result.lastInsertRowid };
    } else {
      return db.prepare(sql).run(...params);
    }
  },
  
  // Batch (birden fazla sorgu)
  async batch(statements) {
    if (isTurso) {
      return await db.batch(statements.map(s => ({ sql: s.sql, args: s.params || [] })));
    } else {
      const results = [];
      for (const s of statements) {
        results.push(db.prepare(s.sql).run(...(s.params || [])));
      }
      return results;
    }
  }
};

// Senkron wrapper (mevcut kodlarla uyumluluk için)
function syncWrapper() {
  if (isTurso) {
    throw new Error('Turso kullanırken sync fonksiyonlar kullanılamaz. dbHelper kullanın.');
  }
  return db;
}

module.exports = { 
  initDatabase, 
  dbHelper,
  getDb: () => db,
  isTurso: () => isTurso
};
