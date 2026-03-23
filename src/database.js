const fs = require('fs');
const path = require('path');
const axios = require('axios');

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

let db = null;
let isTurso = false;
let httpClient = null;

// Turso HTTP client (Hrana protocol)
class TursoHTTP {
  constructor(url, token) {
    // libsql://xxx.turso.io -> https://xxx.turso.io
    this.baseUrl = url.replace('libsql://', 'https://');
    this.token = token;
    this.baton = null;
  }
  
  async request(statements) {
    const body = { requests: [] };
    
    for (const stmt of statements) {
      body.requests.push({
        type: 'execute',
        stmt: { sql: stmt.sql, args: stmt.args || [] }
      });
    }
    
    body.requests.push({ type: 'close' });
    
    const res = await axios.post(this.baseUrl, body, {
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      }
    });
    
    // Parse response
    const results = [];
    for (const r of res.data.results || []) {
      if (r.type === 'execute') {
        if (r.response?.error) {
          throw new Error(r.response.error.message || r.response.error);
        }
        results.push({
          rows: r.response?.result?.rows?.map(row => {
            const obj = {};
            const cols = r.response.result.columns || [];
            row.forEach((val, i) => {
              obj[cols[i]] = val;
            });
            return obj;
          }) || [],
          affected: r.response?.result?.affected_row_count || 0,
          lastInsertRowid: r.response?.result?.last_insert_rowid
        });
      }
    }
    
    return results;
  }
  
  async execute(sql, args = []) {
    const results = await this.request([{ sql, args }]);
    return results[0] || { rows: [], affected: 0 };
  }
  
  async batch(statements) {
    return await this.request(statements);
  }
}

async function initDatabase() {
  if (TURSO_URL && TURSO_AUTH_TOKEN) {
    console.log('🗄️ Turso HTTP API...');
    isTurso = true;
    
    httpClient = new TursoHTTP(TURSO_URL, TURSO_AUTH_TOKEN);
    
    console.log('📋 Tablolar oluşturuluyor...');
    
    // Tabloları tek tek oluştur
    const tables = [
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
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
        created_at TEXT DEFAULT (datetime('now')),
        last_active TEXT DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS generations (
        id INTEGER PRIMARY KEY,
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
        created_at TEXT DEFAULT (datetime('now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id)`,
      `CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code)`,
      `CREATE INDEX IF NOT EXISTS idx_generations_user_id ON generations(user_id)`
    ];
    
    for (const sql of tables) {
      try {
        await httpClient.execute(sql);
      } catch (e) {
        // Index veya tablo zaten varsa hata yok say
      }
    }
    
    console.log('✅ Turso hazır!');
    
    // Test sorgusu
    try {
      const r = await httpClient.execute('SELECT COUNT(*) as c FROM users');
      console.log(`📊 Kullanıcı: ${r.rows[0]?.c || 0}`);
    } catch (e) {
      console.log('⚠️ Test hatası:', e.message);
    }
    
  } else {
    console.log('🗄️ Local SQLite...');
    
    const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    
    const Database = require('better-sqlite3');
    db = new Database(path.join(DATA_DIR, 'tapedit.db'));
    db.pragma('journal_mode = WAL');
    
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
      CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
      CREATE INDEX IF NOT EXISTS idx_generations_user_id ON generations(user_id);
    `);
    
    console.log('✅ Local SQLite hazır');
  }
}

const dbHelper = {
  isTurso: () => isTurso,
  
  async get(sql, params = []) {
    if (isTurso) {
      const r = await httpClient.execute(sql, params);
      return r.rows[0] || null;
    }
    return db.prepare(sql).get(...params);
  },
  
  async all(sql, params = []) {
    if (isTurso) {
      const r = await httpClient.execute(sql, params);
      return r.rows;
    }
    return db.prepare(sql).all(...params);
  },
  
  async run(sql, params = []) {
    if (isTurso) {
      const r = await httpClient.execute(sql, params);
      return { changes: r.affected, lastInsertRowid: r.lastInsertRowid };
    }
    return db.prepare(sql).run(...params);
  }
};

module.exports = { initDatabase, dbHelper, isTurso: () => isTurso };
