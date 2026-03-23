const { chromium } = require('playwright');
const axios = require('axios');

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
      let imageSrc = null;
      
      for (let i = 0; i < 24; i++) {
        const images = await page.$$('img');
        console.log(`📸 Bulunan görsel sayısı: ${images.length}`);
        
        for (const img of images) {
          const src = await img.getAttribute('src');
          const alt = await img.getAttribute('alt');
          console.log(`🔍 Görsel: ${src ? src.substring(0, 50) + '...' : 'no-src'} | alt: ${alt || 'no-alt'}`);
          
          if (src && !src.includes('upload') && !src.includes('placeholder') && !src.includes('icon')) {
            const width = await img.evaluate(el => el.naturalWidth || el.width);
            const height = await img.evaluate(el => el.naturalHeight || el.height);
            console.log(`📐 Boyutlar: ${width}x${height}`);
            
            if (width > 100 && height > 100) {
              resultImage = img;
              imageSrc = src;
              console.log(`✅ Sonuç görseli bulundu!`);
              break;
            }
          }
        }
        if (resultImage) break;
        await page.waitForTimeout(5000);
        console.log(`⏳ ${i * 5 + 5}s bekleniyor...`);
      }
      
      if (!resultImage || !imageSrc) {
        throw new Error('Sonuç görseli bulunamadı - timeout');
      }
      
      console.log(`📥 Görsel indiriliyor: ${imageSrc.substring(0, 80)}...`);
      
      let imageBuffer;
      
      if (imageSrc.startsWith('data:')) {
        // Base64 görsel
        console.log('📦 Base64 formatında görsel');
        const base64Data = imageSrc.split(',')[1];
        if (!base64Data) throw new Error('Base64 data parsing hatası');
        imageBuffer = Buffer.from(base64Data, 'base64');
      } else if (imageSrc.startsWith('http://') || imageSrc.startsWith('https://')) {
        // URL görsel - axios ile indir
        console.log('🌐 URL formatında görsel, axios ile indiriliyor...');
        const response = await axios.get(imageSrc, { 
          responseType: 'arraybuffer',
          timeout: 30000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        imageBuffer = Buffer.from(response.data, 'binary');
      } else if (imageSrc.startsWith('blob:')) {
        // Blob URL - sayfa üzerinden getir
        console.log('🔮 Blob URL tespit edildi, alternatif yöntem...');
        const imageData = await page.evaluate(async (blobUrl) => {
          try {
            const response = await fetch(blobUrl);
            const blob = await response.blob();
            return new Promise((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result);
              reader.readAsDataURL(blob);
            });
          } catch (e) {
            return null;
          }
        }, imageSrc);
        
        if (imageData && imageData.startsWith('data:')) {
          const base64Data = imageData.split(',')[1];
          imageBuffer = Buffer.from(base64Data, 'base64');
        } else {
          throw new Error('Blob URL işlenemedi');
        }
      } else {
        throw new Error(`Bilinmeyen URL formatı: ${imageSrc.substring(0, 30)}`);
      }
      
      if (!imageBuffer || imageBuffer.length < 1000) {
        throw new Error('Görsel buffer boş veya çok küçük');
      }
      
      const time = (Date.now() - startTime) / 1000;
      console.log(`✅ Tamamlandı: ${time.toFixed(1)}s | Boyut: ${(imageBuffer.length / 1024).toFixed(1)}KB`);
      
      await page.close();
      return { success: true, imageBuffer, processingTime: time };
      
    } catch (error) {
      console.error('❌ Hata:', error.message);
      if (page) {
        try { await page.close(); } catch (e) {}
      }
      return { success: false, error: error.message };
    }
  }
  
  async close() {
    if (this.browser) { 
      await this.browser.close(); 
      this.browser = null; 
      this.context = null; 
    }
  }
}

module.exports = TapeditAutomation;
