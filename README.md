# 🤖 Tapedit AI Image Bot

Telegram bot for AI image editing using Tapedit.ai

## 🚀 Features

- 🎨 AI-powered image editing
- ⭐ Telegram Stars payment system
- 👑 VIP unlimited credits system
- 🔗 Referral system
- 📊 Statistics and performance tracking
- 💾 Persistent data storage

## 📦 Deployment (Koyeb)

### ⚠️ ÖNEMLİ: Persistent Volume Kurulumu

Verilerin (kullanıcılar, haklar, istatistikler) silinmemesi için **Persistent Volume** eklemeniz gerekiyor!

#### Adım 1: Volume Oluştur

1. Koyeb Dashboard → **Volumes** sekmesine git
2. **Create Volume** butonuna tıkla
3. Ayarlar:
   - **Name:** `tapedit-data`
   - **Size:** `1 GB` (yeterli)
   - **Region:** App ile aynı region

#### Adım 2: App'e Volume Bağla

1. App ayarlarına git
2. **Volumes** bölümünden volume ekle
3. **Mount Path:** `/data`
4. Volume'ü seç: `tapedit-data`

#### Adım 3: Environment Variables

```
TELEGRAM_BOT_TOKEN=your_bot_token
BOT_USERNAME=GrokAi_ImageBot
STORAGE_CHANNEL_ID=-1003273407339
DATA_DIR=/data
PORT=8000
```

### 🔄 Yeniden Deploy

Volume bağlandıktan sonra:
- ✅ Kullanıcı verileri korunur
- ✅ Kalan haklar korunur
- ✅ İstatistikler korunur
- ✅ Referans geçmişi korunur

## 📱 Bot Commands

| Komut | Açıklama |
|-------|----------|
| `/start` | Botu başlat |
| `/generate` | AI görsel oluştur |
| `/buy` | Yıldız ile hak satın al |
| `/balance` | Hak durumunu göster |
| `/referral` | Referans linkini al |
| `/history` | Görsel geçmişini göster |
| `/stats` | İstatistikleri göster (VIP) |
| `/help` | Yardım menüsü |

## ⭐ Pricing (Telegram Stars)

| Paket | Fiyat |
|-------|-------|
| 3 Hak | 75 ⭐ |
| 5 Hak | 125 ⭐ |
| 10 Hak | 250 ⭐ |
| 20 Hak | 450 ⭐ |
| 50 Hak | 1000 ⭐ |

## 👑 VIP Users

Sınırsız hak:
- @wraith0_0
- @Irresistible_2

## 💰 Bot Owner

- @GloriusSerpent

## 🛠️ Local Development

```bash
# Install dependencies
npm install

# Install Playwright
npx playwright install chromium

# Run
npm start
```

## 📁 File Structure

```
├── src/
│   ├── index.js          # Main bot file
│   ├── database.js       # SQLite database
│   ├── automation/
│   │   └── tapedit.js    # Playwright automation
│   ├── models/
│   │   ├── User.js       # User model
│   │   └── Generation.js # Generation model
│   └── services/
│       └── referral.js   # Referral service
├── data/                 # SQLite database (local)
├── downloads/            # Temporary files
├── Dockerfile
├── package.json
└── README.md
```

## ⚠️ Troubleshooting

### Veriler sıfırlanıyor?
- Persistent Volume `/data` mount edilmiş mi kontrol et
- `DATA_DIR=/data` environment variable set edilmiş mi?

### Bot çalışmıyor?
- `TELEGRAM_BOT_TOKEN` doğru mu?
- Health check port 8000 açık mı?

### Ödeme çalışmıyor?
- Telegram Stars bot için aktif mi?
- BotFather'dan payments özelliği açılmış mı?
