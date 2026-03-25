const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');

// ================================================================
//  TapeditAutomation — Stabil versiyon
//  Strateji sırası:
//   1) Network intercept  → API response'dan URL yakala
//   2) CDN polling        → cdn.tapedit.ai/edit/ URL'si bekle
//   3) Largest image      → Sayfadaki en büyük görseli al
//   4) Download intercept → Download tıkla, blob/URL yakala
// ================================================================

const SITE_URL   = 'https://tapedit.ai';
const MAX_WAIT_S = 180;   // toplam bekleme süresi (saniye)
const POLL_MS    = 3000;  // her kontrol aralığı (ms)

class TapeditAutomation {
  constructor() {
    this.browser = null;
    this.context = null;
    this._launching = false;
  }

  // ── Browser başlat ──────────────────────────────────────────
  async initBrowser() {
    if (this.browser) {
      try { await this.browser.version(); return; } catch (_) {
        this.browser = null; this.context = null;
      }
    }
    if (this._launching) {
      await new Promise(r => setTimeout(r, 2000));
      return this.initBrowser();
    }
    this._launching = true;
    try {
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox', '--disable-setuid-sandbox',
          '--disable-dev-shm-usage', '--disable-gpu',
          '--single-process', '--no-zygote',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process'
        ]
      });
      this.context = await this.browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        acceptDownloads: true,
        ignoreHTTPSErrors: true
      });
      console.log('✅ Browser başlatıldı');
    } finally {
      this._launching = false;
    }
  }

  // ── Browser'ı tamamen yenile ─────────────────────────────────
  async resetBrowser() {
    try {
      if (this.browser) await this.browser.close();
    } catch (_) {}
    this.browser = null;
    this.context = null;
    await this.initBrowser();
  }

  // ── Ana fonksiyon ────────────────────────────────────────────
  async generateImage(imagePath, prompt, retryCount = 0) {
    const MAX_RETRIES = 2;
    const startTime   = Date.now();
    let   page        = null;

    try {
      await this.initBrowser();
      page = await this.context.newPage();

      // ── Tüm network response'larını dinle ───────────────────
      const capturedUrls = new Set();

      page.on('response', async (response) => {
        try {
          const url         = response.url();
          const contentType = response.headers()['content-type'] || '';

          // CDN görsel URL'lerini yakala
          if (
            url.includes('cdn.tapedit.ai') ||
            url.includes('tapedit.ai') && (
              url.includes('/edit/') ||
              url.includes('/output/') ||
              url.includes('/result/') ||
              url.includes('/generated/')
            )
          ) {
            if (contentType.includes('image') || url.match(/\.(jpg|jpeg|png|webp)(\?|$)/i)) {
              capturedUrls.add(url);
              console.log(`🌐 Network görsel yakalandı: ${url}`);
            }
          }

          // JSON response içinde URL ara
          if (contentType.includes('application/json') || contentType.includes('text/')) {
            try {
              const text = await response.text().catch(() => '');
              if (text && text.includes('cdn.tapedit.ai')) {
                const urlMatches = text.match(/https?:\/\/cdn\.tapedit\.ai\/[^\s"']+/g);
                if (urlMatches) {
                  urlMatches.forEach(u => {
                    const clean = u.replace(/[",\\}]+$/, '');
                    capturedUrls.add(clean);
                    console.log(`📡 JSON'dan URL yakalandı: ${clean}`);
                  });
                }
              }
            } catch (_) {}
          }
        } catch (_) {}
      });

      // ── Download event'ini dinle ─────────────────────────────
      let downloadUrl = null;
      page.on('download', async (download) => {
        try {
          const suggestedPath = `/tmp/tapedit_dl_${Date.now()}.jpg`;
          await download.saveAs(suggestedPath);
          downloadUrl = suggestedPath;
          console.log(`💾 Download yakalandı: ${suggestedPath}`);
        } catch (_) {}
      });

      // ── Sayfaya git ──────────────────────────────────────────
      console.log('🌐 Tapedit.ai bağlanılıyor...');
      await page.goto(SITE_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });
      await page.waitForTimeout(3000);
      console.log('✅ Sayfa yüklendi');

      // ── Görsel yükleme ───────────────────────────────────────
      console.log('📤 Görsel yükleniyor...');
      const uploaded = await this._uploadImage(page, imagePath);
      if (!uploaded) throw new Error('Görsel yüklenemedi');
      await page.waitForTimeout(2000);

      // ── Prompt girme ─────────────────────────────────────────
      console.log('📝 Prompt giriliyor...');
      const prompted = await this._enterPrompt(page, prompt);
      if (!prompted) throw new Error('Prompt girilemedi');
      await page.waitForTimeout(500);

      // ── Generate tıkla ───────────────────────────────────────
      console.log('🔘 Generate tıklanıyor...');
      const generated = await this._clickGenerate(page);
      if (!generated) throw new Error('Generate butonu bulunamadı');

      console.log('⏳ Görsel oluşturuluyor...');

      // ── Strateji 1: Network'ten URL bekleme ──────────────────
      let imageUrl = await this._waitForNetworkImage(capturedUrls, page);

      // ── Strateji 2: DOM'da CDN görseli ara ──────────────────
      if (!imageUrl) {
        console.log('🔍 Strateji 2: DOM CDN görseli aranıyor...');
        imageUrl = await this._waitForDomImage(page);
      }

      // ── Strateji 3: Download butonuna tıkla ─────────────────
      if (!imageUrl && !downloadUrl) {
        console.log('🔍 Strateji 3: Download butonu deneniyor...');
        await this._tryClickDownload(page);
        await page.waitForTimeout(3000);
        imageUrl = downloadUrl;
      }

      // ── Strateji 4: Sayfadaki en büyük görsel ───────────────
      if (!imageUrl) {
        console.log('🔍 Strateji 4: En büyük görsel aranıyor...');
        imageUrl = await this._getLargestImage(page, imagePath);
      }

      if (!imageUrl) {
        throw new Error('Hiçbir stratejide görsel bulunamadı');
      }

      // ── Görseli indir ────────────────────────────────────────
      console.log(`📥 Görsel indiriliyor: ${imageUrl}`);
      const imageBuffer = await this._downloadImage(imageUrl, page);

      if (!imageBuffer || imageBuffer.length < 5000) {
        throw new Error(`Görsel buffer çok küçük: ${imageBuffer?.length || 0} bytes`);
      }

      const totalTime = (Date.now() - startTime) / 1000;
      console.log(`✅ TAMAMLANDI! Süre: ${totalTime.toFixed(1)}s | Boyut: ${(imageBuffer.length / 1024).toFixed(1)}KB`);

      await page.close().catch(() => {});
      return { success: true, imageBuffer, processingTime: totalTime };

    } catch (error) {
      console.error(`❌ Hata (deneme ${retryCount + 1}): ${error.message}`);

      if (page) await page.close().catch(() => {});

      // Retry mantığı
      if (retryCount < MAX_RETRIES) {
        console.log(`🔄 ${retryCount + 1}. retry yapılıyor...`);
        await this.resetBrowser();
        await new Promise(r => setTimeout(r, 5000));
        return this.generateImage(imagePath, prompt, retryCount + 1);
      }

      return { success: false, error: error.message };
    }
  }

  // ================================================================
  //  YARDIMCI FONKSİYONLAR
  // ================================================================

  // ── Görsel yükleme ─────────────────────────────────────────────
  async _uploadImage(page, imagePath) {
    // Yöntem 1: Direkt file input
    try {
      const fileInput = await page.$('input[type="file"]');
      if (fileInput) {
        await fileInput.setInputFiles(imagePath);
        console.log('✅ File input ile yüklendi');
        return true;
      }
    } catch (_) {}

    // Yöntem 2: Gizli file input'u tetikle
    try {
      const inputs = await page.$$('input[type="file"]');
      for (const inp of inputs) {
        try {
          await inp.setInputFiles(imagePath);
          console.log('✅ Gizli file input ile yüklendi');
          return true;
        } catch (_) {}
      }
    } catch (_) {}

    // Yöntem 3: Drag-and-drop bölgesini bul ve tıkla
    try {
      const dropZoneSelectors = [
        '[class*="upload"]', '[class*="drop"]', '[class*="Upload"]',
        '[class*="Drop"]', '[data-testid*="upload"]', 'label[for]',
        '[class*="input"]'
      ];

      for (const sel of dropZoneSelectors) {
        const el = await page.$(sel);
        if (el) {
          await el.click().catch(() => {});
          await page.waitForTimeout(500);

          // Tıklamadan sonra input açıldı mı?
          const newInput = await page.$('input[type="file"]');
          if (newInput) {
            await newInput.setInputFiles(imagePath);
            console.log(`✅ ${sel} üzerinden yüklendi`);
            return true;
          }
        }
      }
    } catch (_) {}

    // Yöntem 4: JS ile dosya input'u inject et
    try {
      await page.evaluate(() => {
        const input = document.createElement('input');
        input.type = 'file';
        input.id = '__injected_file_input__';
        input.style.position = 'fixed';
        input.style.top = '0';
        input.style.left = '0';
        input.style.opacity = '0.01';
        document.body.appendChild(input);
      });

      const injected = await page.$('#__injected_file_input__');
      if (injected) {
        await injected.setInputFiles(imagePath);

        // Dosyayı drag-drop event ile tetikle
        await page.evaluate(() => {
          const input = document.getElementById('__injected_file_input__');
          const dropZone = document.querySelector('[class*="upload"], [class*="drop"], main, body');
          if (input && input.files[0] && dropZone) {
            const dt = new DataTransfer();
            dt.items.add(input.files[0]);
            const event = new DragEvent('drop', { dataTransfer: dt, bubbles: true });
            dropZone.dispatchEvent(event);
          }
        });

        console.log('✅ Inject yöntemi ile yüklendi');
        return true;
      }
    } catch (_) {}

    console.error('❌ Görsel yükleme başarısız');
    return false;
  }

  // ── Prompt girme ───────────────────────────────────────────────
  async _enterPrompt(page, prompt) {
    const selectors = [
      'textarea',
      'input[type="text"][placeholder*="prompt" i]',
      'input[type="text"][placeholder*="describe" i]',
      'input[type="text"][placeholder*="edit" i]',
      '[contenteditable="true"]',
      '[class*="prompt"] textarea',
      '[class*="prompt"] input',
      '[class*="Prompt"] textarea',
      '[class*="input"] textarea'
    ];

    for (const sel of selectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.click();
          await el.fill('');
          await el.type(prompt, { delay: 30 });
          const val = await el.inputValue().catch(() => '');
          if (val && val.length > 0) {
            console.log(`✅ Prompt girildi (${sel})`);
            return true;
          }
        }
      } catch (_) {}
    }

    // contenteditable
    try {
      const ce = await page.$('[contenteditable]');
      if (ce) {
        await ce.click();
        await page.keyboard.selectAll();
        await page.keyboard.type(prompt, { delay: 30 });
        console.log('✅ Prompt contenteditable ile girildi');
        return true;
      }
    } catch (_) {}

    console.error('❌ Prompt alanı bulunamadı');
    return false;
  }

  // ── Generate butonu ────────────────────────────────────────────
  async _clickGenerate(page) {
    // Text tabanlı
    const textSelectors = [
      'button:has-text("Generate")',
      'button:has-text("generate")',
      'button:has-text("Create")',
      'button:has-text("Edit")',
      'button:has-text("Apply")',
      'button:has-text("Submit")',
      'button:has-text("Run")'
    ];

    for (const sel of textSelectors) {
      try {
        const btn = await page.$(sel);
        if (btn) {
          const isDisabled = await btn.isDisabled();
          if (!isDisabled) {
            await btn.click();
            console.log(`✅ Generate: ${sel}`);
            return true;
          }
        }
      } catch (_) {}
    }

    // Class tabanlı
    const classSelectors = [
      '[class*="generate"]', '[class*="Generate"]',
      '[class*="submit"]',   '[class*="Submit"]',
      '[class*="create"]',   '[class*="Create"]',
      '[type="submit"]'
    ];

    for (const sel of classSelectors) {
      try {
        const btn = await page.$(sel);
        if (btn) {
          const tag = await btn.evaluate(el => el.tagName);
          if (tag === 'BUTTON' || tag === 'INPUT') {
            await btn.click();
            console.log(`✅ Generate (class): ${sel}`);
            return true;
          }
        }
      } catch (_) {}
    }

    // Son çare: Sayfadaki tüm butonları tara
    try {
      const buttons = await page.$$('button');
      const keywords = ['generate', 'create', 'edit', 'apply', 'submit', 'run', 'start'];

      for (const btn of buttons) {
        const text = (await btn.textContent()).toLowerCase().trim();
        if (keywords.some(k => text.includes(k))) {
          const isDisabled = await btn.isDisabled();
          if (!isDisabled) {
            await btn.click();
            console.log(`✅ Generate (tarama): "${text}"`);
            return true;
          }
        }
      }
    } catch (_) {}

    console.error('❌ Generate butonu bulunamadı');
    return false;
  }

  // ── Strateji 1: Network'ten URL bekle ─────────────────────────
  async _waitForNetworkImage(capturedUrls, page) {
    const deadline = Date.now() + MAX_WAIT_S * 1000;

    while (Date.now() < deadline) {
      // Önceki isteklerden yakalanan URL var mı?
      for (const url of capturedUrls) {
        if (this._isLikelyGeneratedImage(url)) {
          console.log(`✅ Network URL bulundu: ${url}`);
          return url;
        }
      }

      // Sayfada loading göstergesi var mı?
      const isLoading = await page.evaluate(() => {
        const loaders = document.querySelectorAll(
          '[class*="loading"], [class*="spinner"], [class*="progress"], [class*="Loading"]'
        );
        return loaders.length > 0;
      }).catch(() => false);

      if (!isLoading && capturedUrls.size > 0) {
        // Loading bitti, son URL'yi dön
        const lastUrl = [...capturedUrls].pop();
        if (lastUrl) {
          console.log(`✅ Loading bitti, son URL: ${lastUrl}`);
          return lastUrl;
        }
      }

      await page.waitForTimeout(POLL_MS);
      console.log(`⏳ Network bekleniyor... (${Math.round((deadline - Date.now()) / 1000)}s kaldı)`);
    }

    return null;
  }

  // ── Strateji 2: DOM'da CDN görseli bekle ──────────────────────
  async _waitForDomImage(page) {
    const deadline = Date.now() + MAX_WAIT_S * 1000;

    while (Date.now() < deadline) {
      const found = await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll('img'));

        // cdn.tapedit.ai içeren resimler
        const cdnImgs = imgs.filter(img => {
          const src = img.src || img.getAttribute('src') || '';
          return (
            src.includes('cdn.tapedit.ai') ||
            src.includes('/edit/') ||
            src.includes('/output/') ||
            src.includes('/result/') ||
            src.includes('/generated/')
          );
        });

        if (cdnImgs.length > 0) {
          // En büyük olanı seç
          let best = null, bestSize = 0;
          for (const img of cdnImgs) {
            const size = (img.naturalWidth || img.width) * (img.naturalHeight || img.height);
            if (size > bestSize) { bestSize = size; best = img; }
          }
          return best ? (best.src || best.getAttribute('src')) : null;
        }

        return null;
      }).catch(() => null);

      if (found) {
        console.log(`✅ DOM CDN görseli bulundu: ${found}`);
        return found;
      }

      await page.waitForTimeout(POLL_MS);
      console.log(`⏳ DOM taranıyor... (${Math.round((deadline - Date.now()) / 1000)}s kaldı)`);
    }

    return null;
  }

  // ── Strateji 3: Download butonuna tıkla ───────────────────────
  async _tryClickDownload(page) {
    const textSelectors = [
      'button:has-text("Download")', 'button:has-text("download")',
      'a:has-text("Download")',      'a:has-text("download")',
      '[class*="download"]',         '[class*="Download"]'
    ];

    for (const sel of textSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.click();
          console.log(`✅ Download tıklandı: ${sel}`);
          return true;
        }
      } catch (_) {}
    }
    return false;
  }

  // ── Strateji 4: Sayfadaki en büyük görsel ─────────────────────
  async _getLargestImage(page, originalImagePath) {
    const originalName = require('path').basename(originalImagePath);

    const found = await page.evaluate((origName) => {
      const imgs = Array.from(document.querySelectorAll('img'));
      let best = null, bestSize = 0;

      for (const img of imgs) {
        const src = img.src || img.getAttribute('src') || '';
        if (!src || src.startsWith('data:') && src.length < 1000) continue;

        // Orijinal görseli hariç tut
        if (src.includes(origName)) continue;

        // UI ikonlarını hariç tut (çok küçük görseller)
        const w = img.naturalWidth  || img.width  || 0;
        const h = img.naturalHeight || img.height || 0;
        const size = w * h;

        if (size > bestSize && size > (300 * 300)) {
          bestSize = size;
          best = src;
        }
      }

      return best;
    }, originalName).catch(() => null);

    if (found) {
      console.log(`✅ En büyük görsel: ${found}`);
    }
    return found;
  }

  // ── Görseli indir ──────────────────────────────────────────────
  async _downloadImage(imageUrl, page) {
    // Disk dosyası ise direkt oku
    if (imageUrl && !imageUrl.startsWith('http') && fs.existsSync(imageUrl)) {
      const buf = fs.readFileSync(imageUrl);
      try { fs.unlinkSync(imageUrl); } catch (_) {}
      return buf;
    }

    // Data URI
    if (imageUrl.startsWith('data:')) {
      const base64Data = imageUrl.split(',')[1];
      return Buffer.from(base64Data, 'base64');
    }

    // Tam URL'ye çevir
    let fullUrl = imageUrl;
    if (fullUrl.startsWith('//'))  fullUrl = 'https:' + fullUrl;
    if (fullUrl.startsWith('/'))   fullUrl = SITE_URL + fullUrl;

    // Yöntem 1: Axios ile indir
    try {
      const response = await axios.get(fullUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
        headers: {
          'User-Agent':  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer':     SITE_URL + '/',
          'Accept':      'image/webp,image/apng,image/*,*/*;q=0.8',
          'Origin':      SITE_URL
        }
      });
      const buf = Buffer.from(response.data, 'binary');
      if (buf.length > 5000) return buf;
    } catch (e) {
      console.log(`⚠️ Axios hatası: ${e.message}`);
    }

    // Yöntem 2: Playwright page.evaluate ile fetch
    try {
      const base64 = await page.evaluate(async (url) => {
        const res  = await fetch(url, { credentials: 'include' });
        const blob = await res.blob();
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result.split(',')[1]);
          reader.readAsDataURL(blob);
        });
      }, fullUrl);

      if (base64) {
        const buf = Buffer.from(base64, 'base64');
        if (buf.length > 5000) {
          console.log('✅ Page.evaluate fetch ile indirildi');
          return buf;
        }
      }
    } catch (e) {
      console.log(`⚠️ Page evaluate hatası: ${e.message}`);
    }

    return null;
  }

  // ── URL'nin generated görsel olup olmadığını kontrol et ────────
  _isLikelyGeneratedImage(url) {
    if (!url) return false;
    const lower = url.toLowerCase();
    return (
      lower.includes('cdn.tapedit.ai') ||
      lower.includes('/edit/')         ||
      lower.includes('/output/')       ||
      lower.includes('/result/')       ||
      lower.includes('/generated/')    ||
      (lower.includes('tapedit') && lower.match(/\.(jpg|jpeg|png|webp)/))
    );
  }

  // ── Temizlik ────────────────────────────────────────────────────
  async close() {
    try {
      if (this.browser) await this.browser.close();
    } catch (_) {}
    this.browser = null;
    this.context = null;
  }
}

module.exports = TapeditAutomation;
