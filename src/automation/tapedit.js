const { chromium } = require('playwright');
const axios = require('axios');

const SITE_URL    = 'https://tapedit.ai';
const MAX_WAIT_MS = 180_000;

class TapeditAutomation {
  constructor() { this.browser = null; }

  async initBrowser() {
    if (this.browser) {
      try { await this.browser.version(); return; } catch (_) { this.browser = null; }
    }
    this.browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
             '--disable-gpu','--single-process','--no-zygote']
    });
    console.log('✅ Browser başlatıldı');
  }

  // Her istekte temiz context + sayfa açılır — cache/state sorunu olmaz
  async newPage() {
    await this.initBrowser();
    const context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
      acceptDownloads: true,
      ignoreHTTPSErrors: true,
      // Cache tamamen kapalı — response'lar her zaman network'ten geçer
      bypassCSP: true
    });
    // Cache'i devre dışı bırak
    await context.route('**/*', route => route.continue());
    const page = await context.newPage();
    await page.setCacheEnabled(false);
    return { page, context };
  }

  async generateImage(imagePath, prompt, retryCount = 0) {
    const MAX_RETRIES = 2;
    const startTime   = Date.now();
    let   page        = null;
    let   context     = null;

    try {
      ({ page, context } = await this.newPage());

      console.log('🌐 Tapedit.ai bağlanılıyor...');
      await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(2000);
      console.log('✅ Sayfa yüklendi');

      console.log('📤 Görsel yükleniyor...');
      await this._uploadImage(page, imagePath);
      await page.waitForTimeout(1500);

      console.log('📝 Prompt giriliyor...');
      await this._enterPrompt(page, prompt);
      await page.waitForTimeout(500);

      // ── Listener Generate'den ÖNCE kurulur ──────────────────
      const resultPromise = this._buildResultPromise(page);

      console.log('🔘 Generate tıklanıyor...');
      await this._clickGenerate(page);
      console.log('⏳ Görsel oluşturuluyor...');

      const resultUrl = await resultPromise;
      if (!resultUrl) throw new Error('Sonuç görseli bulunamadı (timeout)');

      console.log(`📥 İndiriliyor: ${resultUrl}`);
      const imageBuffer = await this._downloadImage(resultUrl, page);
      if (!imageBuffer || imageBuffer.length < 5000)
        throw new Error(`Buffer çok küçük: ${imageBuffer?.length || 0} bytes`);

      const totalTime = (Date.now() - startTime) / 1000;
      console.log(`✅ TAMAMLANDI! ${totalTime.toFixed(1)}s | ${(imageBuffer.length/1024).toFixed(1)}KB`);

      await page.close().catch(() => {});
      await context.close().catch(() => {});
      return { success: true, imageBuffer, processingTime: totalTime };

    } catch (error) {
      console.error(`❌ Hata (deneme ${retryCount + 1}): ${error.message}`);
      if (page)    await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});

      if (retryCount < MAX_RETRIES) {
        console.log(`🔄 ${retryCount + 1}. retry...`);
        await new Promise(r => setTimeout(r, 3000));
        return this.generateImage(imagePath, prompt, retryCount + 1);
      }
      return { success: false, error: error.message };
    }
  }

  _buildResultPromise(page) {
    return Promise.race([

      // YÖNTEM 1: Network response — Generate anında tetiklenir
      page.waitForResponse(
        (res) => {
          const url = res.url();
          const ct  = res.headers()['content-type'] || '';
          return ct.startsWith('image/') &&
                 (url.includes('pbsimgs') ||
                  url.includes('/edit/single/') ||
                  url.includes('/output/'));
        },
        { timeout: MAX_WAIT_MS }
      ).then((res) => {
        const url = res.url();
        console.log(`✅ [Network] Görsel geldi: ${url}`);
        return url;
      }).catch(() => null),

      // YÖNTEM 2: DOM — img[alt="Generated result"] veya pbsimgs URL
      page.waitForFunction(
        () => {
          const img = document.querySelector('img[alt="Generated result"]');
          if (img && img.src && img.src.startsWith('http') && img.naturalWidth > 0)
            return img.src;
          for (const i of document.querySelectorAll('img')) {
            const src = i.src || '';
            if ((src.includes('pbsimgs') ||
                 src.includes('/edit/single/') ||
                 src.includes('/output/')) && i.naturalWidth > 0)
              return src;
          }
          return false;
        },
        { timeout: MAX_WAIT_MS, polling: 500 }
      ).then(h => h.jsonValue()).then((url) => {
        console.log(`✅ [DOM] Görsel bulundu: ${url}`);
        return url;
      }).catch(() => null),

      // YÖNTEM 3: Timeout
      new Promise(r => setTimeout(() => r(null), MAX_WAIT_MS))
    ]);
  }

  async _uploadImage(page, imagePath) {
    try {
      const inp = await page.$('input[type="file"]');
      if (inp) { await inp.setInputFiles(imagePath); console.log('✅ File input yüklendi'); return; }
    } catch (_) {}
    for (const sel of ['[class*="upload"]','[class*="Upload"]','[class*="drop"]','label']) {
      try {
        const el = await page.$(sel); if (!el) continue;
        await el.click(); await page.waitForTimeout(400);
        const inp = await page.$('input[type="file"]');
        if (inp) { await inp.setInputFiles(imagePath); console.log(`✅ Upload (${sel})`); return; }
      } catch (_) {}
    }
    throw new Error('Görsel yükleme alanı bulunamadı');
  }

  async _enterPrompt(page, prompt) {
    for (const sel of [
      'textarea',
      'input[placeholder*="prompt" i]',
      'input[placeholder*="describe" i]',
      'input[placeholder*="edit" i]',
      '[contenteditable="true"]'
    ]) {
      try {
        const el = await page.$(sel); if (!el) continue;
        await el.click(); await el.fill(''); await el.fill(prompt);
        console.log(`✅ Prompt girildi (${sel})`); return;
      } catch (_) {}
    }
    throw new Error('Prompt alanı bulunamadı');
  }

  async _clickGenerate(page) {
    for (const sel of [
      'button:has-text("Generate Images")',
      'button:has-text("Generate")',
      'button:has-text("Edit Image")',
      'button:has-text("Create")',
      'button:has-text("Apply")',
    ]) {
      try {
        const btn = await page.$(sel);
        if (btn && !(await btn.isDisabled())) {
          await btn.click(); console.log(`✅ Generate: ${sel}`); return;
        }
      } catch (_) {}
    }
    for (const btn of await page.$$('button')) {
      try {
        const text = (await btn.textContent()).toLowerCase().trim();
        if (['generate','create','edit','apply'].some(k => text.includes(k)) &&
            !(await btn.isDisabled())) {
          await btn.click(); console.log(`✅ Generate (tarama): "${text}"`); return;
        }
      } catch (_) {}
    }
    throw new Error('Generate butonu bulunamadı');
  }

  async _downloadImage(url, page) {
    try {
      const res = await axios.get(url, {
        responseType: 'arraybuffer', timeout: 30000,
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': SITE_URL+'/', 'Accept': 'image/*,*/*' }
      });
      const buf = Buffer.from(res.data, 'binary');
      if (buf.length > 5000) { console.log('✅ Axios indirildi'); return buf; }
    } catch (e) { console.log(`⚠️ Axios: ${e.message}`); }
    try {
      const b64 = await page.evaluate(async u => {
        const r = await fetch(u, { credentials: 'include' });
        const blob = await r.blob();
        return new Promise(res => {
          const fr = new FileReader();
          fr.onloadend = () => res(fr.result.split(',')[1]);
          fr.readAsDataURL(blob);
        });
      }, url);
      if (b64) {
        const buf = Buffer.from(b64, 'base64');
        if (buf.length > 5000) { console.log('✅ Fetch indirildi'); return buf; }
      }
    } catch (e) { console.log(`⚠️ Fetch: ${e.message}`); }
    return null;
  }

  async close() {
    try { if (this.browser) await this.browser.close(); } catch (_) {}
    this.browser = null;
  }
}

module.exports = TapeditAutomation;
