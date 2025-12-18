/**
 * Parser Module - Optimized for PepsiCo/Beverage Labels
 * Based on actual OCR analysis of user's label photos
 */
const Parser = {
    parse(text) {
        console.log('=== PARSING TEXT ===');
        console.log(text);

        const upper = text.toUpperCase();
        const lines = upper.split('\n').map(l => l.trim()).filter(l => l);

        // Find all dates in text
        const dates = this.findAllDates(text);
        console.log('All dates found:', dates);

        // Extract fields based on actual label format
        let result = {
            batchNo: this.findBatch(upper, text),
            mfgDate: null,
            expiryDate: null,
            flavour: this.findFlavour(upper),
            confidence: {}
        };

        // Parse dates based on position relative to keywords
        const dateInfo = this.parseDatesFromContext(text, dates);
        result.mfgDate = dateInfo.mfg;
        result.expiryDate = dateInfo.expiry;

        console.log('Extracted:', result);

        // Validate and fix
        result = this.validate(result);

        console.log('Final result:', result);
        return result;
    },

    /**
     * Find all dates in various formats
     */
    findAllDates(text) {
        const dates = [];

        // DD/MM/YY or DD/MM/YYYY
        const regex = /(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
            const normalized = this.normalizeDate(match[0]);
            dates.push({
                raw: match[0],
                normalized,
                index: match.index
            });
        }

        return dates;
    },

    /**
     * Parse dates based on context (MFG/EXP keywords position)
     * Handles format like:
     *   MANUFACTURE DATE
     *   EXPIRY DATE  
     *   ...
     *   14/07/25 (DD/MM/YY)
     *   ...
     *   12/04/26 (DD/MM/YY) 25-8902-0014
     */
    parseDatesFromContext(text, dates) {
        const upper = text.toUpperCase();
        const result = { mfg: null, expiry: null };

        if (dates.length === 0) return result;

        // Find keyword positions
        const mfgKeywords = ['MANUFACTURE DATE', 'MFG DATE', 'MFG DT', 'MFD', 'PACKED', 'PKD'];
        const expKeywords = ['EXPIRY DATE', 'EXP DATE', 'EXP DT', 'BEST BEFORE', 'USE BY', 'BB'];

        let mfgPos = -1, expPos = -1;

        for (const kw of mfgKeywords) {
            const pos = upper.indexOf(kw);
            if (pos !== -1 && (mfgPos === -1 || pos < mfgPos)) {
                mfgPos = pos;
            }
        }

        for (const kw of expKeywords) {
            const pos = upper.indexOf(kw);
            if (pos !== -1 && (expPos === -1 || pos < expPos)) {
                expPos = pos;
            }
        }

        console.log('Keyword positions - MFG:', mfgPos, 'EXP:', expPos);

        // If both keywords found and MFG comes before EXP
        // First date after keywords = MFG, Second date = EXP
        if (mfgPos !== -1 && dates.length >= 2) {
            // Find first and second dates after keywords
            const datesAfterKeywords = dates.filter(d => d.index > mfgPos);

            if (datesAfterKeywords.length >= 2) {
                // First date is MFG, second is EXP
                result.mfg = datesAfterKeywords[0].normalized;
                result.expiry = datesAfterKeywords[1].normalized;
                console.log('Dates from position analysis');
                return result;
            }
        }

        // Fallback: use date order (assuming first = MFG, second = EXP)
        if (dates.length >= 2) {
            result.mfg = dates[0].normalized;
            result.expiry = dates[1].normalized;
            console.log('Using first two dates as MFG/EXP');
        } else if (dates.length === 1) {
            // Only one date found - try to determine which it is
            if (expPos !== -1 && (mfgPos === -1 || expPos < mfgPos)) {
                result.expiry = dates[0].normalized;
            } else {
                result.mfg = dates[0].normalized;
            }
        }

        return result;
    },

    /**
     * Find batch number - optimized for XX-XXXX-XXXX format
     */
    findBatch(upper, originalText) {
        // Your labels use format: 25-8902-0014
        const patterns = [
            // XX-XXXX-XXXX (your exact format)
            /(\d{2}-\d{4}-\d{4})/,

            // After BATCH NO.
            /BATCH\s*NO\.?\s*[:\s]*([\w\d-]{6,})/i,

            // General alphanumeric batch
            /B\.?\s*NO\.?\s*[:\s]*([\w\d-]{6,})/i,

            // LOT number
            /LOT\s*(?:NO\.?)?\s*[:\s]*([\w\d-]{5,})/i,
        ];

        for (const p of patterns) {
            const m = originalText.match(p);
            if (m && m[1] && !this.isDate(m[1])) {
                console.log('Batch matched:', m[1]);
                return m[1].trim();
            }
        }

        // Search in upper text too
        for (const p of patterns) {
            const m = upper.match(p);
            if (m && m[1] && !this.isDate(m[1])) {
                console.log('Batch matched (upper):', m[1]);
                return m[1].trim();
            }
        }

        return null;
    },

    /**
     * Find product flavour
     */
    findFlavour(text) {
        const flavours = [
            'PEPSI', 'COLA', 'SPRITE', 'FANTA', '7UP', '7 UP', 'MIRINDA',
            'MOUNTAIN DEW', 'DEW', 'SLICE', 'MAAZA', 'FROOTI', 'APPY',
            'LIMCA', 'THUMS UP', 'THUMBS UP', 'MANGO', 'ORANGE', 'LEMON',
            'STING', 'GATORADE', 'TROPICANA', 'AQUAFINA', 'KINLEY'
        ];

        for (const f of flavours) {
            if (text.includes(f)) {
                return f.split(' ').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
            }
        }

        // Try to find "FLAVOR" or "FLAVOUR" followed by product name
        const flavorMatch = text.match(/(?:FLAVOR|FLAVOUR)\s+(\w+)/i);
        if (flavorMatch) {
            return flavorMatch[1].charAt(0) + flavorMatch[1].slice(1).toLowerCase();
        }

        return null;
    },

    /**
     * Validate and fix extracted data
     */
    validate(result) {
        // Check if batch looks like date
        if (result.batchNo && this.isDate(result.batchNo)) {
            console.log('Batch looks like date, clearing');
            result.confidence.batchNo = 'low';
            result.batchNo = null;
        }

        // Swap dates if expiry < mfg
        if (result.mfgDate && result.expiryDate) {
            const mfg = this.toTimestamp(result.mfgDate);
            const exp = this.toTimestamp(result.expiryDate);
            if (mfg && exp && exp < mfg) {
                console.log('Swapping dates - expiry was before mfg');
                [result.mfgDate, result.expiryDate] = [result.expiryDate, result.mfgDate];
                result.confidence.mfgDate = 'swapped';
                result.confidence.expiryDate = 'swapped';
            }
        }

        // Set confidence levels
        result.confidence.batchNo = result.batchNo ? (result.confidence.batchNo || 'high') : '';
        result.confidence.mfgDate = result.mfgDate ? (result.confidence.mfgDate || 'high') : '';
        result.confidence.expiryDate = result.expiryDate ? (result.confidence.expiryDate || 'high') : '';

        return result;
    },

    isDate(str) {
        return /^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}$/.test(str.trim());
    },

    normalizeDate(str) {
        const m = str.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
        if (!m) return str;
        let [_, d, mo, y] = m;
        if (y.length === 2) y = '20' + y;
        return `${d.padStart(2, '0')}/${mo.padStart(2, '0')}/${y}`;
    },

    toTimestamp(dateStr) {
        const m = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (!m) return null;
        return new Date(m[3], m[2] - 1, m[1]).getTime();
    }
};
