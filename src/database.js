const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const dbPath = path.join(DATA_DIR, 'tapedit.db');
const Database = require('better-sqlite3');
const db = new Database(dbPath);

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
    language TEXT DEFAULT 'tr',
    last_daily_reward DATETIME DEFAULT NULL,
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
  CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
  CREATE INDEX IF NOT EXISTS idx_generations_user_id ON generations(user_id);
`);

// Yeni sütunları kontrol et ve ekle (eski DB'ler için)
try {
  const columns = db.prepare("PRAGMA table_info(users)").all();
  
  const langCol = columns.find(col => col.name === 'language');
  if (!langCol) {
    db.exec('ALTER TABLE users ADD COLUMN language TEXT DEFAULT "tr"');
    console.log('✅ language sütunu eklendi');
  }
  
  const dailyCol = columns.find(col => col.name === 'last_daily_reward');
  if (!dailyCol) {
    db.exec('ALTER TABLE users ADD COLUMN last_daily_reward DATETIME DEFAULT NULL');
    console.log('✅ last_daily_reward sütunu eklendi');
  }
} catch (error) {
  console.log('⚠️ Sütun kontrolü:', error.message);
}

const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get();
const genCount = db.prepare('SELECT COUNT(*) as c FROM generations').get();

console.log(`✅ SQLite hazır: ${dbPath}`);
console.log(`📊 Kullanıcı: ${userCount.c}, Görsel: ${genCount.c}`);

const dbHelper = {
  isTurso: () => false,
  
  async get(sql, params = []) {
    return db.prepare(sql).get(...params);
  },
  
  async all(sql, params = []) {
    return db.prepare(sql).all(...params);
  },
  
  async run(sql, params = []) {
    return db.prepare(sql).run(...params);
  }
};

function getLocalDb() {
  return db;
}

function isTurso() {
  return false;
}

module.exports = { initDatabase: () => {}, dbHelper, getLocalDb, isTurso };
