/**
 * OCR Module - Hybrid Online/Offline OCR
 * Uses ocr.space API online, Tesseract.js offline
 */
const OCR = {
    API_URL: '/api/ocr',
    tesseractWorker: null,
    isOnline: navigator.onLine,

    init() {
        // Listen for online/offline events
        window.addEventListener('online', () => {
            this.isOnline = true;
            console.log('[OCR] Online mode');
        });
        window.addEventListener('offline', () => {
            this.isOnline = false;
            console.log('[OCR] Offline mode');
        });
    },

    async process(file, onProgress) {
        // Check current network status
        this.isOnline = navigator.onLine;

        if (this.isOnline) {
            try {
                return await this.processOnline(file, onProgress);
            } catch (err) {
                console.warn('[OCR] Online failed, trying offline:', err.message);
                onProgress && onProgress('Online failed, using offline OCR...');
                return await this.processOffline(file, onProgress);
            }
        } else {
            onProgress && onProgress('📴 Offline mode - using local OCR...');
            return await this.processOffline(file, onProgress);
        }
    },

    /**
     * Online OCR using backend proxy
     */
    async processOnline(file, onProgress) {
        onProgress && onProgress('Enhancing image...');

        const enhanced = await this.enhanceImage(file);

        onProgress && onProgress('Sending to OCR...');

        const formData = new FormData();
        formData.append('file', enhanced, 'image.jpg');

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);

        try {
            const response = await fetch(this.API_URL, {
                method: 'POST',
                body: formData,
                signal: controller.signal
            });

            clearTimeout(timeout);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            console.log('[OCR] Online response:', data);

            if (data.IsErroredOnProcessing) {
                throw new Error(data.ErrorMessage || 'OCR failed');
            }

            onProgress && onProgress('Done!');

            const text = data.ParsedResults?.[0]?.ParsedText || '';
            console.log('[OCR] Text:', text);

            return text;
        } catch (err) {
            clearTimeout(timeout);
            if (err.name === 'AbortError') {
                throw new Error('Request timed out');
            }
            throw err;
        }
    },

    /**
     * Offline OCR using Tesseract.js
     */
    async processOffline(file, onProgress) {
        onProgress && onProgress('Loading offline OCR engine...');

        // Load Tesseract.js dynamically if not already loaded
        if (typeof Tesseract === 'undefined') {
            await this.loadTesseract();
        }

        onProgress && onProgress('Processing image offline...');

        try {
            const enhanced = await this.enhanceImage(file);
            const imageUrl = URL.createObjectURL(enhanced);

            const result = await Tesseract.recognize(imageUrl, 'eng', {
                logger: m => {
                    if (m.status === 'recognizing text') {
                        const progress = Math.round(m.progress * 100);
                        onProgress && onProgress(`Processing... ${progress}%`);
                    }
                }
            });

            URL.revokeObjectURL(imageUrl);

            onProgress && onProgress('Done! (Offline)');

            console.log('[OCR] Offline result:', result.data.text);
            return result.data.text;
        } catch (err) {
            console.error('[OCR] Offline error:', err);
            throw new Error('Offline OCR failed: ' + err.message);
        }
    },

    /**
     * Dynamically load Tesseract.js from CDN or cache
     */
    async loadTesseract() {
        return new Promise((resolve, reject) => {
            if (typeof Tesseract !== 'undefined') {
                resolve();
                return;
            }

            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
            script.onload = () => {
                console.log('[OCR] Tesseract.js loaded');
                resolve();
            };
            script.onerror = () => {
                reject(new Error('Failed to load Tesseract.js'));
            };
            document.head.appendChild(script);
        });
    },

    /**
     * Enhance image for better OCR accuracy
     */
    async enhanceImage(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(file);

            img.onload = () => {
                URL.revokeObjectURL(url);

                const maxWidth = 1400;
                let w = img.width;
                let h = img.height;

                if (w > maxWidth) {
                    h = (h * maxWidth) / w;
                    w = maxWidth;
                }

                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');

                ctx.drawImage(img, 0, 0, w, h);
                this.applyEnhancements(ctx, w, h);

                canvas.toBlob(
                    blob => blob ? resolve(blob) : reject(new Error('Processing failed')),
                    'image/jpeg',
                    0.92
                );
            };

            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Failed to load image'));
            };

            img.src = url;
        });
    },

    /**
     * Apply image enhancements for better OCR
     */
    applyEnhancements(ctx, w, h) {
        const imageData = ctx.getImageData(0, 0, w, h);
        const data = imageData.data;

        let totalBrightness = 0;
        for (let i = 0; i < data.length; i += 4) {
            totalBrightness += (data[i] + data[i + 1] + data[i + 2]) / 3;
        }
        const avgBrightness = totalBrightness / (data.length / 4);

        const contrast = 1.3;
        const brightnessFactor = avgBrightness < 128 ? 20 : 0;

        for (let i = 0; i < data.length; i += 4) {
            data[i] = Math.min(255, Math.max(0, ((data[i] - 128) * contrast) + 128 + brightnessFactor));
            data[i + 1] = Math.min(255, Math.max(0, ((data[i + 1] - 128) * contrast) + 128 + brightnessFactor));
            data[i + 2] = Math.min(255, Math.max(0, ((data[i + 2] - 128) * contrast) + 128 + brightnessFactor));
        }

        ctx.putImageData(imageData, 0, 0);
        ctx.filter = 'contrast(1.1) saturate(0.9)';
    }
};

// Initialize OCR module
OCR.init();
