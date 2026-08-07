export type ParsedLabel = {
  batchNo: string | null;
  mfgDate: string | null;
  expiryDate: string | null;
  flavour: string | null;
  confidence: Record<string, string>;
};

type DateHit = { raw: string; normalized: string; index: number };

export const Parser = {
  parse(text: string): ParsedLabel {
    const upper = text.toUpperCase();
    const dates = this.findAllDates(text);
    const result: ParsedLabel = {
      batchNo: this.findBatch(upper, text),
      mfgDate: null,
      expiryDate: null,
      flavour: this.findFlavour(upper),
      confidence: {},
    };
    const dateInfo = this.parseDatesFromContext(text, dates);
    result.mfgDate = dateInfo.mfg;
    result.expiryDate = dateInfo.expiry;
    return this.validate(result);
  },

  findAllDates(text: string): DateHit[] {
    const dates: DateHit[] = [];
    const regex = /(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      dates.push({
        raw: match[0],
        normalized: this.normalizeDate(match[0]),
        index: match.index,
      });
    }
    return dates;
  },

  parseDatesFromContext(text: string, dates: DateHit[]) {
    const upper = text.toUpperCase();
    const result = { mfg: null as string | null, expiry: null as string | null };
    if (dates.length === 0) return result;

    const mfgKeywords = ["MANUFACTURE DATE", "MFG DATE", "MFG DT", "MFD", "PACKED", "PKD"];
    const expKeywords = ["EXPIRY DATE", "EXP DATE", "EXP DT", "BEST BEFORE", "USE BY", "BB"];

    let mfgPos = -1;
    let expPos = -1;
    for (const kw of mfgKeywords) {
      const pos = upper.indexOf(kw);
      if (pos !== -1 && (mfgPos === -1 || pos < mfgPos)) mfgPos = pos;
    }
    for (const kw of expKeywords) {
      const pos = upper.indexOf(kw);
      if (pos !== -1 && (expPos === -1 || pos < expPos)) expPos = pos;
    }

    if (mfgPos !== -1 && dates.length >= 2) {
      const after = dates.filter((d) => d.index > mfgPos);
      if (after.length >= 2) {
        result.mfg = after[0].normalized;
        result.expiry = after[1].normalized;
        return result;
      }
    }

    if (dates.length >= 2) {
      result.mfg = dates[0].normalized;
      result.expiry = dates[1].normalized;
    } else if (dates.length === 1) {
      if (expPos !== -1 && (mfgPos === -1 || expPos < mfgPos)) {
        result.expiry = dates[0].normalized;
      } else {
        result.mfg = dates[0].normalized;
      }
    }
    return result;
  },

  findBatch(upper: string, originalText: string) {
    const patterns = [
      /(\d{2}-\d{4}-\d{4})/,
      /BATCH\s*NO\.?\s*[:\s]*([\w\d-]{6,})/i,
      /B\.?\s*NO\.?\s*[:\s]*([\w\d-]{6,})/i,
      /LOT\s*(?:NO\.?)?\s*[:\s]*([\w\d-]{5,})/i,
    ];
    for (const p of patterns) {
      const m = originalText.match(p) || upper.match(p);
      if (m?.[1] && !this.isDate(m[1])) return m[1].trim();
    }
    return null;
  },

  findFlavour(text: string) {
    const flavours = [
      "PEPSI", "COLA", "SPRITE", "FANTA", "7UP", "7 UP", "MIRINDA",
      "MOUNTAIN DEW", "DEW", "SLICE", "MAAZA", "FROOTI", "APPY",
      "LIMCA", "THUMS UP", "THUMBS UP", "MANGO", "ORANGE", "LEMON",
      "STING", "GATORADE", "TROPICANA", "AQUAFINA", "KINLEY",
    ];
    for (const f of flavours) {
      if (text.includes(f)) {
        return f
          .split(" ")
          .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
          .join(" ");
      }
    }
    const flavorMatch = text.match(/(?:FLAVOR|FLAVOUR)\s+(\w+)/i);
    if (flavorMatch) {
      return flavorMatch[1].charAt(0) + flavorMatch[1].slice(1).toLowerCase();
    }
    return null;
  },

  validate(result: ParsedLabel) {
    if (result.batchNo && this.isDate(result.batchNo)) {
      result.confidence.batchNo = "low";
      result.batchNo = null;
    }
    if (result.mfgDate && result.expiryDate) {
      const mfg = this.toTimestamp(result.mfgDate);
      const exp = this.toTimestamp(result.expiryDate);
      if (mfg && exp && exp < mfg) {
        [result.mfgDate, result.expiryDate] = [result.expiryDate, result.mfgDate];
        result.confidence.mfgDate = "swapped";
        result.confidence.expiryDate = "swapped";
      }
    }
    result.confidence.batchNo = result.batchNo ? result.confidence.batchNo || "high" : "";
    result.confidence.mfgDate = result.mfgDate ? result.confidence.mfgDate || "high" : "";
    result.confidence.expiryDate = result.expiryDate
      ? result.confidence.expiryDate || "high"
      : "";
    return result;
  },

  isDate(str: string) {
    return /^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}$/.test(str.trim());
  },

  normalizeDate(str: string) {
    const m = str.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
    if (!m) return str;
    const d = m[1];
    const mo = m[2];
    let y = m[3];
    if (y.length === 2) y = "20" + y;
    return `${d.padStart(2, "0")}/${mo.padStart(2, "0")}/${y}`;
  },

  toTimestamp(dateStr: string) {
    const m = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!m) return null;
    return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime();
  },
};
