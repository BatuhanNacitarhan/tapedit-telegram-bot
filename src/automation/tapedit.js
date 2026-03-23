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
      
      // Upload butonunu bul ve tıkla
      const uploadButton = await page.$('text=Upload Image, text=Upload, button:has-text("Upload")');
      const fileInput = await page.$('input[type="file"]');
      
      if (fileInput) {
        await fileInput.setInputFiles(imagePath);
        console.log('✅ Dosya input ile yüklendi');
      } else if (uploadButton) {
        const [fileChooser] = await Promise.all([
          page.waitForEvent('filechooser', { timeout: 10000 }),
          uploadButton.click()
        ]);
        await fileChooser.setFiles(imagePath);
        console.log('✅ Dosya filechooser ile yüklendi');
      } else {
        throw new Error('Upload alanı bulunamadı');
      }
      
      // Yüklenme bekle
      await page.waitForTimeout(3000);
      console.log('✅ Görsel yüklendi');
      
      // ========== ADIM 2: PROMPT GİRME ==========
      console.log('📝 Prompt giriliyor...');
      
      // Prompt textarea bul
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
      
      // Aspect Ratio: Default (zaten default olabilir)
      const defaultRatio = await page.$('text=Default');
      if (defaultRatio) {
        await defaultRatio.click();
        console.log('✅ Aspect Ratio: Default');
      }
      
      // Image Resolution: 1K (zaten 1K olabilir)
      const resolution1K = await page.$('text=1K, text=1k');
      if (resolution1K) {
        await resolution1K.click();
        console.log('✅ Resolution: 1K');
      }
      
      // Number of Images: 1 (zaten 1 olabilir)
      const oneImage = await page.$('button:has-text("1")');
      if (oneImage) {
        await oneImage.click();
        console.log('✅ Number of Images: 1');
      }
      
      // Output Format: JPG
      const jpgFormat = await page.$('text=JPG, text=jpg');
      if (jpgFormat) {
        await jpgFormat.click();
        console.log('✅ Output Format: JPG');
      }
      
      await page.waitForTimeout(500);
      
      // ========== ADIM 4: GENERATE BUTONU ==========
      console.log('🔘 Generate Images butonuna tıklanıyor...');
      
      // "Generate Images" butonunu bul
      const generateButton = await page.$('button:has-text("Generate"), button:has-text("Generate Images")');
      
      if (generateButton) {
        await generateButton.click();
        console.log('✅ Generate Images butonuna tıklandı');
      } else {
        // Alternatif: Yeşil buton ara
        const greenButton = await page.$('button.bg-green-500, button.bg-green-600, button[class*="green"]');
        if (greenButton) {
          await greenButton.click();
          console.log('✅ Yeşil generate butonuna tıklandı');
        } else {
          throw new Error('Generate butonu bulunamadı');
        }
      }
      
      // ========== ADIM 5: SONUÇ BEKLEME ==========
      console.log('⏳ AI görsel oluşturuyor... (60-120 saniye bekleyin)');
      
      // Loading göstergesi bekle ve bitmesini bekle
      await page.waitForTimeout(5000);
      
      // Download butonunun görünmesini bekle (oluşturma tamamlandı göstergesi)
      let downloadButton = null;
      let waitTime = 0;
      const maxWaitTime = 180; // 3 dakika max
      
      while (!downloadButton && waitTime < maxWaitTime) {
        downloadButton = await page.$('button:has-text("Download"), a:has-text("Download"), button:has-text("download")');
        
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
      
      // ========== ADIM 6: SONUÇ GÖRSELİNİ ALMA ==========
      console.log('📸 Oluşturulan görsel alınıyor...');
      
      // Sol taraftaki BÜYÜK görseli bul (uploaded preview DEĞIL!)
      // Generated görsel genelde sol tarafta büyük görünür
      
      // Tüm görselleri al
      const images = await page.$$('img');
      console.log(`📸 Sayfada ${images.length} görsel bulundu`);
      
      let generatedImageSrc = null;
      let generatedImageElement = null;
      
      // En büyük görseli bul (oluşturulan görsel en büyük olacak)
      let maxSize = 0;
      
      for (const img of images) {
        const src = await img.getAttribute('src');
        const alt = await img.getAttribute('alt');
        
        // Uploaded preview'i atla
        if (alt && alt.toLowerCase().includes('upload')) continue;
        if (src && src.includes('upload')) continue;
        
        // Logo ve iconları atla
        const width = await img.evaluate(el => el.naturalWidth || el.width);
        const height = await img.evaluate(el => el.naturalHeight || el.height);
        
        console.log(`🔍 Görsel: ${src ? src.substring(0, 50) : 'no-src'} | ${width}x${height} | alt: ${alt || 'none'}`);
        
        // En büyük görseli seç (generated image en büyük olmalı)
        if (width > 200 && height > 200 && width * height > maxSize) {
          maxSize = width * height;
          generatedImageSrc = src;
          generatedImageElement = img;
        }
      }
      
      if (!generatedImageSrc) {
        throw new Error('Oluşturulan görsel bulunamadı');
      }
      
      console.log(`✅ Oluşturulan görsel bulundu: ${generatedImageSrc.substring(0, 80)}...`);
      
      // ========== ADIM 7: GÖRSELİ İNDİR ==========
      console.log('📥 Görsel indiriliyor...');
      
      let imageBuffer;
      
      if (generatedImageSrc.startsWith('data:')) {
        // Base64
        const base64Data = generatedImageSrc.split(',')[1];
        imageBuffer = Buffer.from(base64Data, 'base64');
      } else if (generatedImageSrc.startsWith('blob:')) {
        // Blob URL - sayfa içinden fetch yap
        console.log('🔮 Blob URL işleniyor...');
        
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
        }, generatedImageSrc);
        
        if (imageData && imageData.startsWith('data:')) {
          const base64Data = imageData.split(',')[1];
          imageBuffer = Buffer.from(base64Data, 'base64');
        } else {
          throw new Error('Blob URL fetch edilemedi');
        }
      } else if (generatedImageSrc.startsWith('http')) {
        // HTTP URL
        const response = await axios.get(generatedImageSrc, {
          responseType: 'arraybuffer',
          timeout: 30000,
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        imageBuffer = Buffer.from(response.data, 'binary');
      } else {
        // Relative URL
        const fullUrl = 'https://tapedit.ai' + generatedImageSrc;
        const response = await axios.get(fullUrl, {
          responseType: 'arraybuffer',
          timeout: 30000,
          headers: { 'User-Agent': 'Mozilla/5.0' }
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
      
      // Debug için ekran görüntüsü al
      if (page) {
        try {
          const screenshotPath = `/tmp/error_${Date.now()}.png`;
          await page.screenshot({ path: screenshotPath, fullPage: true });
          console.log(`📸 Hata ekran görüntüsü: ${screenshotPath}`);
        } catch (e) {}
        
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
