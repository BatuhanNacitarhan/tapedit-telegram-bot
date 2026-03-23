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
      viewport: { width: 1920, height: 1080 }
    });
  }
  
  async generateImage(imagePath, prompt) {
    const startTime = Date.now();
    let page = null;
    
    try {
      await this.initBrowser();
      page = await this.context.newPage();
      
      console.log('🌐 Tapedit.ai bağlanılıyor...');
      await page.goto('https://tapedit.ai', { waitUntil: 'networkidle', timeout: 60000 });
      
      // ========== ADIM 1: GÖRSEL YÜKLEME ==========
      console.log('📤 Görsel yükleniyor...');
      
      const fileInput = await page.$('input[type="file"]');
      
      if (fileInput) {
        await fileInput.setInputFiles(imagePath);
        console.log('✅ Dosya input ile yüklendi');
      } else {
        throw new Error('Upload alanı bulunamadı');
      }
      
      await page.waitForTimeout(3000);
      console.log('✅ Görsel yüklendi');
      
      // ========== ADIM 2: PROMPT GİRME ==========
      console.log('📝 Prompt giriliyor...');
      
      const promptTextarea = await page.$('textarea');
      if (!promptTextarea) {
        throw new Error('Prompt textarea bulunamadı');
      }
      
      await promptTextarea.click();
      await promptTextarea.fill(prompt);
      await page.waitForTimeout(500);
      console.log(`✅ Prompt girildi: "${prompt}"`);
      
      // ========== ADIM 3: AYARLAR ==========
      console.log('⚙️ Ayarlar kontrol ediliyor...');
      
      // Aspect Ratio: Default
      const defaultRatio = await page.$('button:has-text("Default")');
      if (defaultRatio) {
        await defaultRatio.click();
        console.log('✅ Aspect Ratio: Default');
      }
      
      // Number of Images: 1
      const oneImage = await page.$('button:has-text("1")');
      if (oneImage) {
        await oneImage.click();
        console.log('✅ Number of Images: 1');
      }
      
      await page.waitForTimeout(500);
      
      // ========== ADIM 4: GENERATE BUTONU ==========
      console.log('🔘 Generate Images butonuna tıklanıyor...');
      
      const generateButton = await page.$('button:has-text("Generate")');
      
      if (generateButton) {
        await generateButton.click();
        console.log('✅ Generate Images butonuna tıklandı');
      } else {
        throw new Error('Generate butonu bulunamadı');
      }
      
      // ========== ADIM 5: SONUÇ BEKLEME ==========
      console.log('⏳ AI görsel oluşturuyor...');
      
      await page.waitForTimeout(5000);
      
      // Download butonunun görünmesini bekle
      let downloadButton = null;
      let waitTime = 0;
      const maxWaitTime = 180;
      
      while (!downloadButton && waitTime < maxWaitTime) {
        downloadButton = await page.$('button:has-text("Download")');
        
        if (downloadButton) {
          console.log(`✅ Download butonu göründü! (${waitTime}s)`);
          break;
        }
        
        await page.waitForTimeout(5000);
        waitTime += 5;
        console.log(`⏳ Bekleniyor... ${waitTime}s`);
      }
      
      if (!downloadButton) {
        throw new Error('Download butonu görünmedi - timeout');
      }
      
      // ========== ADIM 6: SONUÇ GÖRSELİNİ BULMA ==========
      console.log('📸 Oluşturulan görsel aranıyor...');
      
      // YÖNTEM 1: "Generated result" alt text'li görseli bul
      const generatedImage = await page.$('img[alt*="Generated"], img[alt*="generated"], img[alt*="result"]');
      
      let generatedImageSrc = null;
      
      if (generatedImage) {
        generatedImageSrc = await generatedImage.getAttribute('src');
        const alt = await generatedImage.getAttribute('alt');
        console.log(`✅ Generated result bulundu! alt="${alt}" src=${generatedImageSrc}`);
      } else {
        // YÖNTEM 2: cdn.tapedit.ai'den gelen görseli bul
        console.log('🔍 CDN görseli aranıyor...');
        
        const images = await page.$$('img');
        
        for (const img of images) {
          const src = await img.getAttribute('src');
          const alt = await img.getAttribute('alt');
          
          // cdn.tapedit.ai/edit/ yolunu içeren görsel
          if (src && src.includes('cdn.tapedit.ai') && src.includes('/edit/')) {
            generatedImageSrc = src;
            console.log(`✅ CDN edit görseli bulundu: ${src}`);
            break;
          }
        }
      }
      
      if (!generatedImageSrc) {
        // YÖNTEM 3: cdn.tapedit.ai'den herhangi bir görsel
        console.log('🔍 Herhangi bir CDN görseli aranıyor...');
        
        const images = await page.$$('img');
        
        for (const img of images) {
          const src = await img.getAttribute('src');
          
          if (src && src.includes('cdn.tapedit.ai')) {
            const width = await img.evaluate(el => el.naturalWidth || el.width);
            const height = await img.evaluate(el => el.naturalHeight || el.height);
            
            // Makul boyutlarda olmalı
            if (width >= 500 && height >= 500) {
              generatedImageSrc = src;
              console.log(`✅ CDN görseli bulundu: ${src} (${width}x${height})`);
              break;
            }
          }
        }
      }
      
      if (!generatedImageSrc) {
        throw new Error('Oluşturulan görsel bulunamadı');
      }
      
      // ========== ADIM 7: GÖRSELİ İNDİR ==========
      console.log('📥 Görsel indiriliyor...');
      
      let imageBuffer;
      
      // URL'yi tam URL'ye çevir
      let fullUrl = generatedImageSrc;
      if (!fullUrl.startsWith('http')) {
        if (fullUrl.startsWith('//')) {
          fullUrl = 'https:' + fullUrl;
        } else if (fullUrl.startsWith('/')) {
          fullUrl = 'https://tapedit.ai' + fullUrl;
        }
      }
      
      console.log(`🔗 İndirilen URL: ${fullUrl}`);
      
      if (fullUrl.startsWith('data:')) {
        const base64Data = fullUrl.split(',')[1];
        imageBuffer = Buffer.from(base64Data, 'base64');
      } else {
        const response = await axios.get(fullUrl, {
          responseType: 'arraybuffer',
          timeout: 30000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://tapedit.ai/',
            'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8'
          }
        });
        imageBuffer = Buffer.from(response.data, 'binary');
      }
      
      if (!imageBuffer || imageBuffer.length < 5000) {
        throw new Error(`Görsel buffer çok küçük: ${imageBuffer ? imageBuffer.length : 0} bytes`);
      }
      
      const totalTime = (Date.now() - startTime) / 1000;
      console.log(`✅ TAMAMLANDI! Süre: ${totalTime.toFixed(1)}s | Boyut: ${(imageBuffer.length / 1024).toFixed(1)}KB`);
      
      await page.close();
      
      return {
        success: true,
        imageBuffer,
        processingTime: totalTime
      };
      
    } catch (error) {
      console.error('❌ HATA:', error.message);
      
      if (page) {
        try { await page.close(); } catch (e) {}
      }
      
      return {
        success: false,
        error: error.message
      };
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
