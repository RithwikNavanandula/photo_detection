/**
 * Label Scanner App - Main Controller
 * Clean, simple implementation
 */
const App = {
    currentScan: null,

    // UI Elements
    el: {},

    async init() {
        console.log('Initializing Label Scanner...');

        // Cache elements
        this.el = {
            quickMode: document.getElementById('quick-mode'),
            fileInput: document.getElementById('file-input'),
            loading: document.getElementById('loading'),
            loadingText: document.getElementById('loading-text'),
            results: document.getElementById('results'),
            preview: document.getElementById('preview'),
            batch: document.getElementById('batch'),
            mfg: document.getElementById('mfg'),
            expiry: document.getElementById('expiry'),
            flavour: document.getElementById('flavour'),
            godown: document.getElementById('godown'),
            confBatch: document.getElementById('conf-batch'),
            confMfg: document.getElementById('conf-mfg'),
            confExpiry: document.getElementById('conf-expiry'),
            rawText: document.getElementById('raw-text'),
            saveBtn: document.getElementById('save-btn'),
            sheetsBtn: document.getElementById('sheets-btn'),
            clearBtn: document.getElementById('clear-btn'),
            continuous: document.getElementById('continuous'),
            exportBtn: document.getElementById('export-btn'),
            search: document.getElementById('search'),
            historyList: document.getElementById('history-list'),
            toast: document.getElementById('toast'),
            cropModal: document.getElementById('crop-modal'),
            cropImage: document.getElementById('crop-image'),
            cropBox: document.getElementById('crop-box'),
            cropSkip: document.getElementById('crop-skip'),
            cropConfirm: document.getElementById('crop-confirm')
        };

        // Init storage
        await Storage.init();
        console.log('Storage ready');

        // Bind events
        this.bindEvents();

        // Load history
        await this.loadHistory();

        // Load saved godown locations
        this.loadGodownOptions();

        console.log('App ready!');
    },

    bindEvents() {
        // File upload
        this.el.fileInput.addEventListener('change', e => this.handleFile(e));

        // Actions
        this.el.saveBtn.addEventListener('click', () => this.save());
        this.el.sheetsBtn.addEventListener('click', () => this.sendToSheets());
        this.el.clearBtn.addEventListener('click', () => this.clear());
        this.el.exportBtn.addEventListener('click', () => this.export());
        this.el.search.addEventListener('input', e => this.search(e.target.value));

        // Crop modal
        this.el.cropSkip.addEventListener('click', () => this.cropResolve(null));
        this.el.cropConfirm.addEventListener('click', () => this.cropAndProcess());

        // Make crop box draggable
        this.initCropDrag();
    },

    async handleFile(e) {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const dataUrl = await this.fileToDataUrl(file);

            // Quick mode = skip cropping
            let imageToProcess = file;

            if (!this.el.quickMode.checked) {
                // Show crop modal
                const cropped = await this.showCropModal(dataUrl);
                if (cropped) {
                    imageToProcess = new File([cropped], 'cropped.jpg', { type: 'image/jpeg' });
                }
            }

            // Show loading
            this.el.loading.classList.remove('hidden');
            this.el.results.classList.add('hidden');

            // Process OCR
            const text = await OCR.process(imageToProcess, status => {
                this.el.loadingText.textContent = status;
            });

            // Parse
            const parsed = Parser.parse(text);

            // Store
            this.currentScan = {
                timestamp: new Date().toLocaleString('en-IN'),
                rawText: text,
                ...parsed
            };

            // Show preview
            this.el.preview.src = dataUrl;

            // Display results
            this.showResults(this.currentScan);

            // Auto-save if continuous mode
            if (this.el.continuous.checked) {
                await this.save();
                this.toast('✅ Saved! Ready for next');
            }

        } catch (err) {
            console.error('Error:', err);
            this.toast('❌ ' + err.message);
        } finally {
            this.el.loading.classList.add('hidden');
            e.target.value = '';
        }
    },

    showResults(scan) {
        this.el.batch.value = scan.batchNo || '';
        this.el.mfg.value = scan.mfgDate || '';
        this.el.expiry.value = scan.expiryDate || '';
        this.el.flavour.value = scan.flavour || '';
        this.el.rawText.textContent = scan.rawText || '';

        // Confidence badges
        this.setBadge(this.el.confBatch, scan.confidence?.batchNo);
        this.setBadge(this.el.confMfg, scan.confidence?.mfgDate);
        this.setBadge(this.el.confExpiry, scan.confidence?.expiryDate);

        this.el.results.classList.remove('hidden');
        this.el.results.scrollIntoView({ behavior: 'smooth' });
    },

    setBadge(el, level) {
        el.className = 'badge';
        if (level === 'high') {
            el.textContent = '✓';
            el.classList.add('high');
        } else if (level === 'low') {
            el.textContent = '?';
            el.classList.add('low');
        } else if (level === 'swapped') {
            el.textContent = '↔';
            el.classList.add('swapped');
        } else {
            el.textContent = '';
        }
    },

    async save() {
        if (!this.currentScan) {
            this.toast('Nothing to save');
            return;
        }

        // Read from inputs (user may have edited)
        this.currentScan.batchNo = this.el.batch.value || null;
        this.currentScan.mfgDate = this.el.mfg.value || null;
        this.currentScan.expiryDate = this.el.expiry.value || null;
        this.currentScan.flavour = this.el.flavour.value || null;
        this.currentScan.godown = this.el.godown.value || null;

        // Save new godown location to dropdown
        if (this.currentScan.godown) {
            this.saveGodownOption(this.currentScan.godown);
        }

        await Storage.save(this.currentScan);
        this.toast('💾 Saved!');
        await this.loadHistory();
        this.clear();
    },

    // Google Sheets Web App URL - User needs to set this up
    SHEETS_URL: 'https://script.google.com/macros/s/AKfycbz7HFMARa_UMZPotHCqELdpXgCD_STSH9NlhbaSjk9nAbW_gnEyAswKHXvs7kUgNTkM/exec', // Will be set after user creates the Apps Script

    async sendToSheets() {
        if (!this.currentScan) {
            this.toast('Nothing to send');
            return;
        }

        if (!this.SHEETS_URL) {
            this.toast('⚠️ Sheets not configured');
            this.showSheetsSetupGuide();
            return;
        }

        // Read current values
        const data = {
            timestamp: this.currentScan.timestamp || new Date().toLocaleString('en-IN'),
            batchNo: this.el.batch.value || '',
            mfgDate: this.el.mfg.value || '',
            expiryDate: this.el.expiry.value || '',
            flavour: this.el.flavour.value || '',
            godown: this.el.godown.value || ''
        };

        try {
            this.toast('📤 Sending...');

            const response = await fetch(this.SHEETS_URL, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            this.toast('✅ Sent to Google Sheets!');

            // Also save locally
            await this.save();
        } catch (err) {
            console.error('Sheets error:', err);
            this.toast('❌ Failed to send');
        }
    },

    showSheetsSetupGuide() {
        alert(
            '📊 Google Sheets Setup:\n\n' +
            '1. Go to Google Sheets and create a new sheet\n' +
            '2. Add headers: Timestamp, Batch, Mfg, Expiry, Flavour, Godown\n' +
            '3. Go to Extensions → Apps Script\n' +
            '4. Paste the code from sheets-setup.txt\n' +
            '5. Deploy as Web App\n' +
            '6. Copy the URL and paste in app.js'
        );
    },

    clear() {
        this.currentScan = null;
        this.el.results.classList.add('hidden');
        this.el.preview.src = '';
        this.el.batch.value = '';
        this.el.mfg.value = '';
        this.el.expiry.value = '';
        this.el.flavour.value = '';
        this.el.godown.value = '';
    },

    // ===== Godown Location Management =====

    // Default locations that are always shown
    defaultGodowns: ['Godown A', 'Godown B', 'Godown C', 'Warehouse 1', 'Warehouse 2', 'Cold Storage'],

    loadGodownOptions() {
        // Get saved custom locations from localStorage
        const saved = localStorage.getItem('godownLocations');
        const custom = saved ? JSON.parse(saved) : [];

        // Combine defaults with custom
        const all = [...new Set([...this.defaultGodowns, ...custom])];

        // Update datalist
        const datalist = document.getElementById('godown-list');
        datalist.innerHTML = all.map(loc => `<option value="${loc}">`).join('');

        console.log('Godown locations loaded:', all.length);
    },

    saveGodownOption(location) {
        if (!location || this.defaultGodowns.includes(location)) return;

        // Get existing custom locations
        const saved = localStorage.getItem('godownLocations');
        const custom = saved ? JSON.parse(saved) : [];

        // Add if not already exists
        if (!custom.includes(location)) {
            custom.push(location);
            localStorage.setItem('godownLocations', JSON.stringify(custom));
            this.loadGodownOptions(); // Refresh dropdown
            console.log('New godown saved:', location);
        }
    },

    async loadHistory() {
        const scans = await Storage.getAll();

        if (scans.length === 0) {
            this.el.historyList.innerHTML = '<p class="empty">No scans yet</p>';
            return;
        }

        this.el.historyList.innerHTML = scans.map(s => `
            <div class="history-item" data-id="${s.id}">
                <div class="info">
                    <div class="time">${s.timestamp}</div>
                    <div class="batch">Batch: ${s.batchNo || 'N/A'}</div>
                    <div class="dates">Mfg: ${s.mfgDate || 'N/A'} | Exp: ${s.expiryDate || 'N/A'}</div>
                </div>
                <button class="delete" onclick="App.deleteItem(${s.id})">🗑️</button>
            </div>
        `).join('');
    },

    async deleteItem(id) {
        await Storage.delete(id);
        this.toast('Deleted');
        await this.loadHistory();
    },

    search(query) {
        const items = this.el.historyList.querySelectorAll('.history-item');
        const q = query.toLowerCase();
        items.forEach(item => {
            item.style.display = item.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
    },

    async export() {
        const scans = await Storage.getAll();
        if (scans.length === 0) {
            this.toast('No data');
            return;
        }

        const csv = [
            'Timestamp,Batch,Mfg,Expiry,Flavour',
            ...scans.map(s => `"${s.timestamp}","${s.batchNo || ''}","${s.mfgDate || ''}","${s.expiryDate || ''}","${s.flavour || ''}"`)
        ].join('\n');

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `scans_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        this.toast(`📥 Exported ${scans.length} scans`);
    },

    // ===== Crop Functions =====

    cropResolve: null,

    showCropModal(dataUrl) {
        return new Promise(resolve => {
            this.cropResolve = resolve;
            this.el.cropImage.src = dataUrl;
            this.el.cropModal.classList.remove('hidden');
        });
    },

    cropAndProcess() {
        const cropped = this.getCroppedImage();
        this.el.cropModal.classList.add('hidden');
        if (this.cropResolve) {
            this.cropResolve(cropped);
        }
    },

    getCroppedImage() {
        const img = this.el.cropImage;
        const box = this.el.cropBox;
        const container = document.getElementById('crop-container');

        const scale = img.naturalWidth / img.clientWidth;
        const rect = box.getBoundingClientRect();
        const contRect = container.getBoundingClientRect();

        const x = (rect.left - contRect.left) * scale;
        const y = (rect.top - contRect.top) * scale;
        const w = rect.width * scale;
        const h = rect.height * scale;

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, x, y, w, h, 0, 0, w, h);

        return new Promise(resolve => {
            canvas.toBlob(resolve, 'image/jpeg', 0.9);
        });
    },

    initCropDrag() {
        const box = this.el.cropBox;
        let dragging = false;
        let startX, startY, startL, startT;

        const start = e => {
            dragging = true;
            const t = e.touches ? e.touches[0] : e;
            startX = t.clientX;
            startY = t.clientY;
            startL = box.offsetLeft;
            startT = box.offsetTop;
            e.preventDefault();
        };

        const move = e => {
            if (!dragging) return;
            const t = e.touches ? e.touches[0] : e;
            const dx = t.clientX - startX;
            const dy = t.clientY - startY;
            const cont = document.getElementById('crop-container');
            const maxX = cont.clientWidth - box.clientWidth;
            const maxY = cont.clientHeight - box.clientHeight;
            box.style.left = Math.max(0, Math.min(maxX, startL + dx)) + 'px';
            box.style.top = Math.max(0, Math.min(maxY, startT + dy)) + 'px';
        };

        const end = () => { dragging = false; };

        box.addEventListener('mousedown', start);
        box.addEventListener('touchstart', start, { passive: false });
        document.addEventListener('mousemove', move);
        document.addEventListener('touchmove', move, { passive: false });
        document.addEventListener('mouseup', end);
        document.addEventListener('touchend', end);
    },

    // ===== Utilities =====

    fileToDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    },

    toast(msg) {
        this.el.toast.textContent = msg;
        this.el.toast.classList.remove('hidden');
        setTimeout(() => this.el.toast.classList.add('hidden'), 2500);
    }
};

// Start app
document.addEventListener('DOMContentLoaded', () => App.init());
