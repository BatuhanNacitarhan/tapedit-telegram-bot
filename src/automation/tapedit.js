const { chromium } = require('playwright');

class TapeditAutomation {
  constructor() {
    this.browser = null;
    this.context = null;
  }
  
  async initBrowser() {
    if (this.browser) return;
    
    this.browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process', '--no-zygote']
    });
    
    this.context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 }
    });
  }
  
  async generateImage(imagePath, prompt) {
    const startTime = Date.now();
    let page = null;
    
    try {
      await this.initBrowser();
      page = await this.context.newPage();
      
      console.log('🌐 Tapedit.ai bağlanılıyor...');
      await page.goto('https://tapedit.ai', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForLoadState('networkidle', { timeout: 30000 });
      
      console.log('📤 Görsel yükleniyor...');
      const fileInput = await page.$('input[type="file"]');
      if (!fileInput) throw new Error('Dosya input bulunamadı');
      await fileInput.setInputFiles(imagePath);
      await page.waitForTimeout(3000);
      
      console.log('📝 Prompt giriliyor...');
      const promptInput = await page.$('textarea, input[type="text"]');
      if (!promptInput) throw new Error('Prompt input bulunamadı');
      await promptInput.fill(prompt);
      await page.waitForTimeout(1000);
      
      console.log('🔘 Generate tıklanıyor...');
      const buttons = await page.$$('button');
      let clicked = false;
      for (const btn of buttons) {
        const text = await btn.textContent();
        if (text && (text.toLowerCase().includes('generate') || text.toLowerCase().includes('create'))) {
          await btn.click();
          clicked = true;
          break;
        }
      }
      if (!clicked) throw new Error('Generate butonu bulunamadı');
      
      console.log('⏳ Sonuç bekleniyor...');
      await page.waitForTimeout(5000);
      
      let resultImage = null;
      for (let i = 0; i < 24; i++) {
        const images = await page.$$('img');
        for (const img of images) {
          const src = await img.getAttribute('src');
          if (src && !src.includes('upload') && !src.includes('placeholder')) {
            const width = await img.evaluate(el => el.naturalWidth || el.width);
            if (width > 100) { resultImage = img; break; }
          }
        }
        if (resultImage) break;
        await page.waitForTimeout(5000);
        console.log(`⏳ ${i * 5 + 5}s...`);
      }
      
      if (!resultImage) throw new Error('Sonuç bulunamadı');
      
      const imageSrc = await resultImage.getAttribute('src');
      let imageBuffer;
      if (imageSrc.startsWith('data:')) {
        imageBuffer = Buffer.from(imageSrc.split(',')[1], 'base64');
      } else {
        const response = await page.request.get(imageSrc);
        imageBuffer = await response.body();
      }
      
      const time = (Date.now() - startTime) / 1000;
      console.log(`✅ Tamamlandı: ${time.toFixed(1)}s`);
      
      await page.close();
      return { success: true, imageBuffer, processingTime: time };
      
    } catch (error) {
      console.error('❌ Hata:', error.message);
      if (page) await page.close();
      return { success: false, error: error.message };
    }
  }
  
  async close() {
    if (this.browser) { await this.browser.close(); this.browser = null; this.context = null; }
  }
}

module.exports = TapeditAutomation;
