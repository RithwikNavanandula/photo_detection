/**
 * OCR Module - Online OCR with enhanced accuracy
 */
const OCR = {
    API_KEY: 'K85403682988957',
    API_URL: 'https://api.ocr.space/parse/image',

    async process(file, onProgress) {
        onProgress && onProgress('Enhancing image...');

        // Preprocess and enhance image for better OCR
        const enhanced = await this.enhanceImage(file);

        onProgress && onProgress('Sending to OCR...');

        // Create form data with optimized settings
        const formData = new FormData();
        formData.append('apikey', this.API_KEY);
        formData.append('file', enhanced, 'image.jpg');
        formData.append('language', 'eng');
        formData.append('OCREngine', '2');  // Engine 2 is better for printed text
        formData.append('scale', 'true');   // Auto-scale for better accuracy
        formData.append('isTable', 'false');
        formData.append('detectOrientation', 'true');  // Auto-rotate

        // Send request with timeout
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 45000);  // Longer timeout

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
            console.log('OCR Response:', data);

            if (data.IsErroredOnProcessing) {
                throw new Error(data.ErrorMessage || 'OCR failed');
            }

            onProgress && onProgress('Done!');

            const text = data.ParsedResults?.[0]?.ParsedText || '';
            console.log('OCR Raw Text:', text);

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
     * Enhance image for better OCR accuracy
     * - Higher resolution (1200px instead of 800px)
     * - Higher quality (0.85 instead of 0.6)
     * - Apply sharpening and contrast
     */
    async enhanceImage(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(file);

            img.onload = () => {
                URL.revokeObjectURL(url);

                // Use higher resolution for better accuracy
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

                // Draw image
                ctx.drawImage(img, 0, 0, w, h);

                // Apply image enhancements
                this.applyEnhancements(ctx, w, h);

                // Higher quality output
                canvas.toBlob(
                    blob => blob ? resolve(blob) : reject(new Error('Processing failed')),
                    'image/jpeg',
                    0.92  // Higher quality
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

        // Calculate brightness
        let totalBrightness = 0;
        for (let i = 0; i < data.length; i += 4) {
            totalBrightness += (data[i] + data[i + 1] + data[i + 2]) / 3;
        }
        const avgBrightness = totalBrightness / (data.length / 4);

        // Adjust contrast and brightness
        const contrast = 1.3;  // Increase contrast
        const brightnessFactor = avgBrightness < 128 ? 20 : 0;  // Boost dark images

        for (let i = 0; i < data.length; i += 4) {
            // Apply contrast
            data[i] = Math.min(255, Math.max(0, ((data[i] - 128) * contrast) + 128 + brightnessFactor));
            data[i + 1] = Math.min(255, Math.max(0, ((data[i + 1] - 128) * contrast) + 128 + brightnessFactor));
            data[i + 2] = Math.min(255, Math.max(0, ((data[i + 2] - 128) * contrast) + 128 + brightnessFactor));
        }

        ctx.putImageData(imageData, 0, 0);

        // Apply slight sharpening using convolution
        ctx.filter = 'contrast(1.1) saturate(0.9)';
    }
};
