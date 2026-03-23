const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Koyeb Persistent Volume için /data dizini kullan
// Local development için ./data dizini
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

// Dizin yoksa oluştur
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log(`📁 Veri dizini oluşturuldu: ${DATA_DIR}`);
}

const dbPath = path.join(DATA_DIR, 'tapedit.db');
console.log(`🗄️ Veritabanı yolu: ${dbPath}`);

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

// Referrals tablosu
db.exec(`
  CREATE TABLE IF NOT EXISTS referrals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    referrer_id INTEGER NOT NULL,
    referred_id INTEGER NOT NULL,
    credits_awarded INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (referrer_id) REFERENCES users(telegram_id),
    FOREIGN KEY (referred_id) REFERENCES users(telegram_id)
  )
`);

// Indexler
db.exec(`CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_generations_user_id ON generations(user_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_generations_created_at ON generations(created_at)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id)`);

// Eksik kolonları ekle (migration)
const migrations = [
  { table: 'users', column: 'is_unlimited', type: 'INTEGER DEFAULT 0' },
  { table: 'users', column: 'temp_image_buffer', type: 'TEXT' },
  { table: 'generations', column: 'input_file_id', type: 'TEXT' },
  { table: 'generations', column: 'output_file_id', type: 'TEXT' },
  { table: 'generations', column: 'output_image_url', type: 'TEXT' },
  { table: 'generations', column: 'username', type: 'TEXT' }
];

migrations.forEach(({ table, column, type }) => {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  } catch (e) {
    // Kolon zaten var
  }
});

// Mevcut kullanıcı sayısını logla
const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
const generationCount = db.prepare('SELECT COUNT(*) as count FROM generations').get();

console.log(`✅ SQLite başlatıldı`);
console.log(`📊 Mevcut kullanıcı: ${userCount.count}`);
console.log(`📊 Mevcut görsel kaydı: ${generationCount.count}`);

module.exports = db;
