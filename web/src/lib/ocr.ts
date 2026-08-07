export const OCR = {
  API_URL: "/api/ocr",
  isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,

  async process(file: Blob, onProgress?: (status: string) => void) {
    this.isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
    if (this.isOnline) {
      try {
        return await this.processOnline(file, onProgress);
      } catch {
        onProgress?.("Online failed, using offline OCR...");
        return await this.processOffline(file, onProgress);
      }
    }
    onProgress?.("Offline mode — using local OCR...");
    return await this.processOffline(file, onProgress);
  },

  async processOnline(file: Blob, onProgress?: (status: string) => void) {
    onProgress?.("Enhancing image...");
    const enhanced = await this.enhanceImage(file);
    onProgress?.("Sending to OCR...");

    const formData = new FormData();
    formData.append("file", enhanced, "image.jpg");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(this.API_URL, {
        method: "POST",
        body: formData,
        credentials: "include",
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data.IsErroredOnProcessing) {
        throw new Error(data.ErrorMessage || "OCR failed");
      }
      onProgress?.("Done!");
      return (data.ParsedResults?.[0]?.ParsedText as string) || "";
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error("Request timed out");
      }
      throw err;
    }
  },

  async processOffline(file: Blob, onProgress?: (status: string) => void) {
    onProgress?.("Loading offline OCR engine...");
    await this.loadTesseract();
    onProgress?.("Processing image offline...");
    const enhanced = await this.enhanceImage(file);
    const imageUrl = URL.createObjectURL(enhanced);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Tesseract = (window as any).Tesseract;
    const result = await Tesseract.recognize(imageUrl, "eng", {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      logger: (m: any) => {
        if (m.status === "recognizing text") {
          onProgress?.(`Processing... ${Math.round(m.progress * 100)}%`);
        }
      },
    });
    URL.revokeObjectURL(imageUrl);
    onProgress?.("Done! (Offline)");
    return result.data.text as string;
  },

  loadTesseract() {
    return new Promise<void>((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((window as any).Tesseract) {
        resolve();
        return;
      }
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load Tesseract.js"));
      document.head.appendChild(script);
    });
  },

  async enhanceImage(file: Blob) {
    return new Promise<Blob>((resolve, reject) => {
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
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas unavailable"));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        this.applyEnhancements(ctx, w, h);
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("Processing failed"))),
          "image/jpeg",
          0.92
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Failed to load image"));
      };
      img.src = url;
    });
  },

  applyEnhancements(ctx: CanvasRenderingContext2D, w: number, h: number) {
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
      data[i] = Math.min(255, Math.max(0, (data[i] - 128) * contrast + 128 + brightnessFactor));
      data[i + 1] = Math.min(
        255,
        Math.max(0, (data[i + 1] - 128) * contrast + 128 + brightnessFactor)
      );
      data[i + 2] = Math.min(
        255,
        Math.max(0, (data[i + 2] - 128) * contrast + 128 + brightnessFactor)
      );
    }
    ctx.putImageData(imageData, 0, 0);
  },
};
