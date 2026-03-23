const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'tapedit.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

// Users tablosu
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
  )
`);

// Generations tablosu (görsel kayıtları)
db.exec(`
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

// Indexler
db.exec(`CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_generations_user_id ON generations(user_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_generations_created_at ON generations(created_at)`);

// is_unlimited kolonu yoksa ekle
try {
  db.exec(`ALTER TABLE users ADD COLUMN is_unlimited INTEGER DEFAULT 0`);
} catch (e) {
  // Kolon zaten var, hata yoksay
}

// temp_image_buffer kolonu yoksa ekle
try {
  db.exec(`ALTER TABLE users ADD COLUMN temp_image_buffer TEXT`);
} catch (e) {
  // Kolon zaten var, hata yoksay
}

// output_file_id ve output_image_url kolonları yoksa ekle
try {
  db.exec(`ALTER TABLE generations ADD COLUMN input_file_id TEXT`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE generations ADD COLUMN output_file_id TEXT`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE generations ADD COLUMN output_image_url TEXT`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE generations ADD COLUMN username TEXT`);
} catch (e) {}

console.log('✅ SQLite başlatıldı');

module.exports = db;
