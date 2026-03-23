const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'tapedit.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER UNIQUE NOT NULL,
    username TEXT DEFAULT '',
    credits INTEGER DEFAULT 5,
    referral_code TEXT UNIQUE,
    referred_by INTEGER DEFAULT NULL,
    state TEXT DEFAULT NULL,
    temp_image_url TEXT DEFAULT NULL,
    temp_file_id TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_active DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS generations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    prompt TEXT NOT NULL,
    input_image_url TEXT,
    output_image_url TEXT,
    status TEXT DEFAULT 'pending',
    error_message TEXT,
    processing_time REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(telegram_id)
  )
`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_generations_user_id ON generations(user_id)`);

console.log('✅ SQLite başlatıldı');

module.exports = db;
