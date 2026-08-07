/** Download inventory CSV via the Flask export endpoint (session cookie). */
export function downloadInventoryExport(branchId?: string | number | null) {
  const qs =
    branchId != null && branchId !== "" && branchId !== "all"
      ? `?branch_id=${branchId}`
      : "";
  window.location.href = `/api/admin/export${qs}`;
}

export function parseInventoryCsv(text: string) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const scans: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = splitCsvLine(lines[i]);
    const scan: Record<string, string> = {};
    headers.forEach((header, index) => {
      const value = (values[index] || "").trim();
      if (header.includes("batch")) scan.batch_no = value;
      else if (header.includes("mfg") || header.includes("manufacture"))
        scan.mfg_date = value;
      else if (header.includes("exp")) scan.expiry_date = value;
      else if (header.includes("rack")) scan.rack_no = value;
      else if (header.includes("shelf")) scan.shelf_no = value;
      else if (header.includes("move") || header.includes("type"))
        scan.movement = value || "IN";
      else if (header.includes("flav")) scan.flavour = value;
    });
    if (Object.keys(scan).length) scans.push(scan);
  }
  return scans;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}
