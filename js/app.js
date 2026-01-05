/**
 * Label Scanner App - Main Controller
 * Clean, simple implementation
 */
const App = {
    currentScan: null,

    // Google Apps Script Email URL - Sends emails with CSV attachments via Gmail
    GMAIL_EMAIL_URL: 'https://script.google.com/macros/s/AKfycbz_VAYQyP7MiMayNKZ4vmcur2pWPR5aqFtaN0YDR4R_WkfamMIi7Knba6Cwsz6vsiAxmA/exec',

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
            rackNo: document.getElementById('rack-no'),
            shelfNo: document.getElementById('shelf-no'),
            movement: document.getElementById('movement'),
            btnIn: document.getElementById('btn-in'),
            btnOut: document.getElementById('btn-out'),
            confBatch: document.getElementById('conf-batch'),
            confMfg: document.getElementById('conf-mfg'),
            confExpiry: document.getElementById('conf-expiry'),
            rawText: document.getElementById('raw-text'),
            saveBtn: document.getElementById('save-btn'),
            sheetsBtn: document.getElementById('sheets-btn'),
            clearBtn: document.getElementById('clear-btn'),
            continuous: document.getElementById('continuous'),
            downloadBtn: document.getElementById('download-btn'),
            emailBtn: document.getElementById('email-btn'),
            syncDbBtn: document.getElementById('sync-db-btn'),
            search: document.getElementById('search'),
            historyList: document.getElementById('history-list'),
            toast: document.getElementById('toast'),
            cropModal: document.getElementById('crop-modal'),
            cropImage: document.getElementById('crop-image'),
            cropBox: document.getElementById('crop-box'),
            cropSkip: document.getElementById('crop-skip'),
            cropConfirm: document.getElementById('crop-confirm'),
            // Email modal elements
            emailModal: document.getElementById('email-modal'),
            emailRecipient: document.getElementById('email-recipient'),
            emailSummary: document.getElementById('email-summary'),
            emailCancel: document.getElementById('email-cancel'),
            emailSend: document.getElementById('email-send'),
            // Batch upload elements
            batchFileInput: document.getElementById('batch-file-input'),
            batchProgress: document.getElementById('batch-progress'),
            batchStatus: document.getElementById('batch-status'),
            progressFill: document.getElementById('progress-fill'),
            cancelBatch: document.getElementById('cancel-batch')
        };

        // Init In/Out toggle
        this.initMovementToggle();

        // Init storage
        await Storage.init();
        console.log('Storage ready');

        // Bind events
        this.bindEvents();

        // Load history
        await this.loadHistory();

        // Load saved rack and shelf options
        this.loadLocationOptions();

        // Load saved email addresses
        this.loadSavedEmails();

        // Display logged in user
        this.displayUser();

        // Bind logout
        document.getElementById('logout-btn').addEventListener('click', () => this.logout());

        console.log('App ready!');
    },

    displayUser() {
        const userData = localStorage.getItem('user');
        if (userData) {
            const user = JSON.parse(userData);
            document.getElementById('user-name').textContent = `👤 ${user.name}`;

            // Show admin button and batch upload for admin users
            if (user.role === 'admin' || user.role === 'superadmin') {
                const adminBtn = document.getElementById('admin-btn');
                if (adminBtn) {
                    adminBtn.classList.remove('hidden');
                }
                // Show batch upload section for admins
                const batchSection = document.getElementById('batch-upload-section');
                if (batchSection) {
                    batchSection.classList.remove('hidden');
                }
            }
        }
    },

    logout() {
        localStorage.removeItem('user');
        window.location.href = '/';
    },

    // Batch processing state
    batchQueue: [],
    batchCancelled: false,

    bindEvents() {
        // File upload
        this.el.fileInput.addEventListener('change', e => this.handleFile(e));

        // Actions
        this.el.saveBtn.addEventListener('click', () => this.save());
        this.el.sheetsBtn.addEventListener('click', () => this.sendToSheets());
        this.el.clearBtn.addEventListener('click', () => this.clear());
        this.el.downloadBtn.addEventListener('click', () => this.downloadCSV());
        this.el.emailBtn.addEventListener('click', () => this.showEmailExportModal());
        this.el.syncDbBtn.addEventListener('click', () => this.syncToDatabase());
        this.el.search.addEventListener('input', e => this.search(e.target.value));

        // Batch upload (Admin only)
        if (this.el.batchFileInput) {
            this.el.batchFileInput.addEventListener('change', e => this.handleBatchFiles(e));
        }
        if (this.el.cancelBatch) {
            this.el.cancelBatch.addEventListener('click', () => this.cancelBatchProcessing());
        }

        // Crop modal
        this.el.cropSkip.addEventListener('click', () => this.skipCrop());
        this.el.cropConfirm.addEventListener('click', () => this.cropAndProcess());

        // Email modal
        this.el.emailCancel.addEventListener('click', () => this.hideEmailModal());
        this.el.emailSend.addEventListener('click', () => this.sendEmail());

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
                if (cropped === null) {
                    // User clicked Skip - cancel the entire operation
                    e.target.value = '';
                    return;
                }
                imageToProcess = new File([cropped], 'cropped.jpg', { type: 'image/jpeg' });
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

    // ===== Batch Processing (Admin Only) =====

    async handleBatchFiles(e) {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        this.batchQueue = files;
        this.batchCancelled = false;

        // Show progress
        this.el.batchProgress.classList.remove('hidden');
        this.updateBatchProgress(0, files.length);

        let processed = 0;
        let saved = 0;

        for (const file of files) {
            if (this.batchCancelled) {
                this.toast(`⏹️ Batch cancelled. Saved ${saved}/${processed} images.`);
                break;
            }

            try {
                processed++;
                this.updateBatchProgress(processed, files.length);

                const dataUrl = await this.fileToDataUrl(file);

                // Process with Quick Mode (skip cropping for batch)
                const text = await OCR.process(file, status => {
                    this.el.batchStatus.textContent = `Processing ${processed}/${files.length}: ${status}`;
                });

                // Parse
                const parsed = Parser.parse(text);

                // Create scan object
                const scan = {
                    timestamp: new Date().toLocaleString('en-IN'),
                    rawText: text,
                    ...parsed,
                    rackNo: '',
                    shelfNo: '',
                    movement: this.el.movement.value || 'IN'
                };

                // Auto-save
                await Storage.save(scan);
                saved++;

            } catch (err) {
                console.error('Batch item error:', err);
            }
        }

        // Hide progress and reset
        this.el.batchProgress.classList.add('hidden');
        e.target.value = '';

        // Reload history
        await this.loadHistory();

        if (!this.batchCancelled) {
            this.toast(`✅ Batch complete! Saved ${saved}/${files.length} images.`);
        }
    },

    updateBatchProgress(current, total) {
        const percent = total > 0 ? (current / total) * 100 : 0;
        this.el.batchStatus.textContent = `Processing ${current}/${total}`;
        this.el.progressFill.style.width = `${percent}%`;
    },

    cancelBatchProcessing() {
        this.batchCancelled = true;
        this.toast('⏹️ Cancelling batch...');
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
        this.currentScan.rackNo = this.el.rackNo.value || null;
        this.currentScan.shelfNo = this.el.shelfNo.value || null;
        this.currentScan.movement = this.el.movement.value || 'IN';

        // Check for mandatory fields
        if (!this.currentScan.rackNo || !this.currentScan.shelfNo) {
            this.toast('❌ Rack and Shelf are mandatory');
            return;
        }

        // Save new rack/shelf options to dropdown
        if (this.currentScan.rackNo) {
            this.saveLocationOption('rackLocations', this.currentScan.rackNo, 'rack-list');
        }
        if (this.currentScan.shelfNo) {
            this.saveLocationOption('shelfLocations', this.currentScan.shelfNo, 'shelf-list');
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
            rackNo: this.el.rackNo.value || '',
            shelfNo: this.el.shelfNo.value || ''
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
            '2. Add headers: Timestamp, Batch, Mfg, Expiry, Flavour, Rack No, Shelf No\n' +
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
        this.el.rackNo.value = '';
        this.el.shelfNo.value = '';
        // Reset movement to IN
        this.el.movement.value = 'IN';
        this.el.btnIn.classList.add('active');
        this.el.btnOut.classList.remove('active');
    },

    // ===== In/Out Movement Toggle =====

    initMovementToggle() {
        this.el.btnIn.addEventListener('click', () => {
            this.el.movement.value = 'IN';
            this.el.btnIn.classList.add('active');
            this.el.btnOut.classList.remove('active');
        });

        this.el.btnOut.addEventListener('click', () => {
            this.el.movement.value = 'OUT';
            this.el.btnOut.classList.add('active');
            this.el.btnIn.classList.remove('active');
        });
    },

    // ===== Rack and Shelf Location Management =====

    // Default locations that are always shown
    defaultRacks: ['Rack 1', 'Rack 2', 'Rack 3', 'Rack 4', 'Rack 5'],
    defaultShelves: ['Shelf A', 'Shelf B', 'Shelf C', 'Shelf D', 'Shelf E'],

    loadLocationOptions() {
        // Load rack options
        const savedRacks = localStorage.getItem('rackLocations');
        const customRacks = savedRacks ? JSON.parse(savedRacks) : [];
        const allRacks = [...new Set([...this.defaultRacks, ...customRacks])];
        const rackDatalist = document.getElementById('rack-list');
        rackDatalist.innerHTML = allRacks.map(loc => `<option value="${loc}">`).join('');

        // Load shelf options
        const savedShelves = localStorage.getItem('shelfLocations');
        const customShelves = savedShelves ? JSON.parse(savedShelves) : [];
        const allShelves = [...new Set([...this.defaultShelves, ...customShelves])];
        const shelfDatalist = document.getElementById('shelf-list');
        shelfDatalist.innerHTML = allShelves.map(loc => `<option value="${loc}">`).join('');

        console.log('Locations loaded - Racks:', allRacks.length, 'Shelves:', allShelves.length);
    },

    saveLocationOption(storageKey, location, datalistId) {
        const defaults = storageKey === 'rackLocations' ? this.defaultRacks : this.defaultShelves;
        if (!location || defaults.includes(location)) return;

        // Get existing custom locations
        const saved = localStorage.getItem(storageKey);
        const custom = saved ? JSON.parse(saved) : [];

        // Add if not already exists
        if (!custom.includes(location)) {
            custom.push(location);
            localStorage.setItem(storageKey, JSON.stringify(custom));
            this.loadLocationOptions(); // Refresh dropdowns
            console.log('New location saved:', location);
        }
    },

    // ===== Email History Management =====

    loadSavedEmails() {
        const saved = localStorage.getItem('savedEmails');
        const emails = saved ? JSON.parse(saved) : [];
        const datalist = document.getElementById('email-list');
        if (datalist) {
            datalist.innerHTML = emails.map(email => `<option value="${email}">`).join('');
        }
        console.log('Saved emails loaded:', emails.length);
    },

    saveEmail(email) {
        if (!email || !this.isValidEmail(email)) return;

        const saved = localStorage.getItem('savedEmails');
        const emails = saved ? JSON.parse(saved) : [];

        // Add if not already exists (max 10 emails)
        if (!emails.includes(email)) {
            emails.unshift(email); // Add to beginning
            if (emails.length > 10) emails.pop(); // Keep max 10
            localStorage.setItem('savedEmails', JSON.stringify(emails));
            this.loadSavedEmails();
            console.log('Email saved:', email);
        }
    },

    // ===== Sync to Database =====

    async syncToDatabase() {
        const scans = await Storage.getAll();

        if (scans.length === 0) {
            this.toast('No scans to sync');
            return;
        }

        // Get user info
        const userData = localStorage.getItem('user');
        const user = userData ? JSON.parse(userData) : { name: 'Unknown' };

        if (!confirm(`Sync ${scans.length} scans to database?\n\nThis will update the inventory dashboard.`)) {
            return;
        }

        this.toast('⏳ Syncing to database...');

        try {
            const response = await fetch('/api/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    scans: scans,
                    user: user.name,
                    branch_id: user.branch_id
                })
            });

            const result = await response.json();

            if (result.success) {
                this.toast(`✅ Synced ${result.synced} scans to database!`);

                // Optionally clear local storage after successful sync
                if (confirm('Scans synced! Clear local history?')) {
                    await Storage.clearAll();
                    await this.loadHistory();
                    this.toast('Local history cleared');
                }
            } else {
                this.toast('❌ Sync failed: ' + (result.error || 'Unknown error'));
            }
        } catch (err) {
            console.error('Sync error:', err);
            this.toast('❌ Sync failed: ' + err.message);
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
                    <div class="time">${s.timestamp} <span class="movement-badge ${(s.movement || 'IN').toLowerCase()}">${s.movement || 'IN'}</span></div>
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

    // ===== CSV Download Functions =====

    async downloadCSV() {
        const scans = await Storage.getAll();
        if (scans.length === 0) {
            this.toast('No data to download');
            return;
        }

        const csv = this.generateCSV(scans);
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `scans_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        this.toast(`📥 Downloaded ${scans.length} scans`);
    },

    generateCSV(scans) {
        return [
            'Timestamp,Movement,Batch,Mfg,Expiry,Flavour,Rack No,Shelf No',
            ...scans.map(s => `"${s.timestamp}","${s.movement || 'IN'}","${s.batchNo || ''}","${s.mfgDate || ''}","${s.expiryDate || ''}","${s.flavour || ''}","${s.rackNo || ''}","${s.shelfNo || ''}"`)
        ].join('\n');
    },

    // ===== Email Functions =====

    async showEmailExportModal() {
        const scans = await Storage.getAll();
        if (scans.length === 0) {
            this.toast('No data to email');
            return;
        }

        // Populate summary
        const now = new Date();
        const timestamps = scans.map(s => new Date(s.timestamp));
        const oldest = new Date(Math.min(...timestamps));
        const newest = new Date(Math.max(...timestamps));

        this.el.emailSummary.innerHTML = `
            <p><span class="label">📊 Total Scans:</span> ${scans.length}</p>
            <p><span class="label">📅 Date Range:</span> ${oldest.toLocaleDateString('en-IN')} - ${newest.toLocaleDateString('en-IN')}</p>
            <p><span class="label">🕐 Export Time:</span> ${now.toLocaleString('en-IN')}</p>
        `;

        // Store scans for sending
        this.pendingExportScans = scans;

        // Show modal
        this.el.emailModal.classList.remove('hidden');
        this.el.emailRecipient.focus();
    },

    hideEmailModal() {
        this.el.emailModal.classList.add('hidden');
        this.el.emailRecipient.value = '';
        this.pendingExportScans = null;
    },

    async sendEmail() {
        const email = this.el.emailRecipient.value.trim();

        // Validate email
        if (!email) {
            this.toast('❌ Please enter an email address');
            return;
        }

        if (!this.isValidEmail(email)) {
            this.toast('❌ Invalid email address');
            return;
        }

        // Check Gmail URL configuration
        if (!this.GMAIL_EMAIL_URL) {
            this.toast('⚠️ Email not configured');
            this.showEmailSetupGuide();
            return;
        }

        if (!this.pendingExportScans || this.pendingExportScans.length === 0) {
            this.toast('❌ No data to send');
            return;
        }

        try {
            this.toast('📤 Sending email...');

            const scans = this.pendingExportScans;
            const csv = this.generateCSV(scans);
            const now = new Date();

            // Create email content
            const timestamps = scans.map(s => new Date(s.timestamp));
            const oldest = new Date(Math.min(...timestamps));
            const newest = new Date(Math.max(...timestamps));

            const filename = `label_scans_${now.toISOString().split('T')[0]}.csv`;

            const messageBody = `Label Scanner Export Report
===========================

📊 Total Scans: ${scans.length}
📅 Date Range: ${oldest.toLocaleDateString('en-IN')} to ${newest.toLocaleDateString('en-IN')}
🕐 Exported At: ${now.toLocaleString('en-IN')}

Please find the CSV file attached to this email.`;

            // Send via Google Apps Script
            const response = await fetch(this.GMAIL_EMAIL_URL, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to_email: email,
                    subject: `Label Scanner Export - ${now.toLocaleDateString('en-IN')}`,
                    message: messageBody,
                    csv_data: csv,
                    filename: filename
                })
            });

            console.log('Email sent via Gmail');
            this.toast('✅ Email sent with CSV attachment!');

            // Save email for future use
            this.saveEmail(email);

            // Clear all saved scans after successful email
            await Storage.clearAll();
            await this.loadHistory();
            console.log('All scans cleared after email');

            this.hideEmailModal();

        } catch (err) {
            console.error('Email error:', err);
            this.toast('❌ Failed to send email: ' + err.message);
        }
    },

    isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    },

    showEmailSetupGuide() {
        alert(
            '📧 Gmail Email Setup Required:\n\n' +
            '1. Open email-setup.txt in the app folder\n' +
            '2. Copy the Apps Script code\n' +
            '3. Go to script.google.com → New Project\n' +
            '4. Paste the code and deploy as Web App\n' +
            '5. Copy the Web App URL to app.js:\n' +
            '   GMAIL_EMAIL_URL: "your-url-here"\n\n' +
            'This uses YOUR Gmail to send emails with CSV attachments!'
        );
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

    skipCrop() {
        this.el.cropModal.classList.add('hidden');
        if (this.cropResolve) {
            this.cropResolve(null);
            this.cropResolve = null;
        }
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
        const container = document.getElementById('crop-container');
        let mode = null; // 'drag' or 'resize-nw', 'resize-ne', etc.
        let startX, startY, startL, startT, startW, startH;

        const start = (e) => {
            const target = e.target;
            const t = e.touches ? e.touches[0] : e;
            startX = t.clientX;
            startY = t.clientY;
            startL = box.offsetLeft;
            startT = box.offsetTop;
            startW = box.offsetWidth;
            startH = box.offsetHeight;

            // Check if clicking on a resize handle
            if (target.classList.contains('resize-handle')) {
                mode = 'resize-' + target.dataset.resize;
            } else if (target === box) {
                mode = 'drag';
            } else {
                return;
            }
            e.preventDefault();
        };

        const move = (e) => {
            if (!mode) return;
            const t = e.touches ? e.touches[0] : e;
            const dx = t.clientX - startX;
            const dy = t.clientY - startY;
            const contRect = container.getBoundingClientRect();
            const minSize = 50;

            if (mode === 'drag') {
                // Move the box
                const maxX = container.clientWidth - box.offsetWidth;
                const maxY = container.clientHeight - box.offsetHeight;
                box.style.left = Math.max(0, Math.min(maxX, startL + dx)) + 'px';
                box.style.top = Math.max(0, Math.min(maxY, startT + dy)) + 'px';
            } else if (mode.startsWith('resize-')) {
                const corner = mode.split('-')[1];
                let newL = startL, newT = startT, newW = startW, newH = startH;

                // Calculate new dimensions based on corner
                if (corner.includes('e')) {
                    newW = Math.max(minSize, startW + dx);
                }
                if (corner.includes('w')) {
                    const maxDx = startW - minSize;
                    const actualDx = Math.min(dx, maxDx);
                    newL = startL + actualDx;
                    newW = startW - actualDx;
                }
                if (corner.includes('s')) {
                    newH = Math.max(minSize, startH + dy);
                }
                if (corner.includes('n')) {
                    const maxDy = startH - minSize;
                    const actualDy = Math.min(dy, maxDy);
                    newT = startT + actualDy;
                    newH = startH - actualDy;
                }

                // Constrain to container
                newL = Math.max(0, newL);
                newT = Math.max(0, newT);
                if (newL + newW > container.clientWidth) newW = container.clientWidth - newL;
                if (newT + newH > container.clientHeight) newH = container.clientHeight - newT;

                box.style.left = newL + 'px';
                box.style.top = newT + 'px';
                box.style.width = newW + 'px';
                box.style.height = newH + 'px';
            }
        };

        const end = () => { mode = null; };

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
