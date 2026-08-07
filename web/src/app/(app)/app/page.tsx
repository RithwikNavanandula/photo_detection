"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { Upload, Save, Trash2, RefreshCw, Download, WifiOff } from "lucide-react";
import { AuthGuard } from "@/components/layout/auth-guard";
import { ImageCropModal } from "@/components/image-crop-modal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/hooks/use-auth";
import { OCR } from "@/lib/ocr";
import { Parser } from "@/lib/label-parser";
import { Storage, type LocalScan } from "@/lib/storage";
import { apiJson } from "@/lib/api";

const DEFAULT_RACKS = ["Rack 1", "Rack 2", "Rack 3", "Rack 4", "Rack 5"];
const DEFAULT_SHELVES = ["Shelf A", "Shelf B", "Shelf C", "Shelf D", "Shelf E"];

export default function ScannerPage() {
  const { user, can } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [quickMode, setQuickMode] = useState(true);
  const [continuous, setContinuous] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [preview, setPreview] = useState("");
  const [history, setHistory] = useState<LocalScan[]>([]);
  const [search, setSearch] = useState("");
  const [movement, setMovement] = useState<"IN" | "OUT">("IN");
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const cropWaiter = useRef<{
    resolve: (file: File | null) => void;
  } | null>(null);
  const [form, setForm] = useState({
    batchNo: "",
    mfgDate: "",
    expiryDate: "",
    flavour: "",
    rackNo: "",
    shelfNo: "",
    rawText: "",
  });
  const [confidence, setConfidence] = useState<Record<string, string>>({});
  const [hasScan, setHasScan] = useState(false);
  const [timestamp, setTimestamp] = useState("");

  const [locTick, setLocTick] = useState(0);
  const racks = (() => {
    void locTick;
    if (typeof window === "undefined") return DEFAULT_RACKS;
    const saved = localStorage.getItem("rackLocations");
    const custom = saved ? (JSON.parse(saved) as string[]) : [];
    return [...new Set([...DEFAULT_RACKS, ...custom])];
  })();

  const shelves = (() => {
    void locTick;
    if (typeof window === "undefined") return DEFAULT_SHELVES;
    const saved = localStorage.getItem("shelfLocations");
    const custom = saved ? (JSON.parse(saved) as string[]) : [];
    return [...new Set([...DEFAULT_SHELVES, ...custom])];
  })();

  async function reloadHistory() {
    setHistory(await Storage.getAll());
  }

  useEffect(() => {
    reloadHistory();
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  function fileToDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function askCrop(dataUrl: string) {
    return new Promise<File | null>((resolve) => {
      cropWaiter.current = { resolve };
      setCropSrc(dataUrl);
    });
  }

  async function processImage(file: File) {
    setLoading(true);
    setStatus("Preparing image...");
    try {
      const dataUrl = await fileToDataUrl(file);
      setPreview(dataUrl);

      const text = await OCR.process(file, setStatus);
      const parsed = Parser.parse(text);
      const nextForm = {
        batchNo: parsed.batchNo || "",
        mfgDate: parsed.mfgDate || "",
        expiryDate: parsed.expiryDate || "",
        flavour: parsed.flavour || "",
        rackNo: "",
        shelfNo: "",
        rawText: text,
      };
      setForm(nextForm);
      setConfidence(parsed.confidence || {});
      setTimestamp(new Date().toLocaleString("en-IN"));
      setHasScan(true);
      setMovement("IN");

      if (continuous) {
        await saveScan(nextForm, true);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setLoading(false);
      setStatus("");
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleFile(file: File | null) {
    if (!file) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      if (!quickMode) {
        const cropped = await askCrop(dataUrl);
        if (cropped === null) {
          if (fileRef.current) fileRef.current.value = "";
          return;
        }
        await processImage(cropped);
        return;
      }
      await processImage(file);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Scan failed");
    }
  }

  function rememberLocation(
    key: "rackLocations" | "shelfLocations",
    value: string,
    defaults: string[]
  ) {
    if (!value || defaults.includes(value)) return;
    const saved = localStorage.getItem(key);
    const custom = saved ? (JSON.parse(saved) as string[]) : [];
    if (!custom.includes(value)) {
      custom.push(value);
      localStorage.setItem(key, JSON.stringify(custom));
      setLocTick((t) => t + 1);
    }
  }

  async function saveScan(override?: typeof form, skipValidation = false) {
    const data = override || form;
    if (!hasScan && !override) {
      toast.error("Nothing to save");
      return;
    }
    if (!skipValidation && (!data.rackNo || !data.shelfNo)) {
      toast.error("Rack and Shelf are mandatory");
      return;
    }

    rememberLocation("rackLocations", data.rackNo, DEFAULT_RACKS);
    rememberLocation("shelfLocations", data.shelfNo, DEFAULT_SHELVES);

    const scanData = {
      timestamp: timestamp || new Date().toLocaleString("en-IN"),
      batchNo: data.batchNo,
      mfgDate: data.mfgDate,
      expiryDate: data.expiryDate,
      flavour: data.flavour,
      rackNo: data.rackNo,
      shelfNo: data.shelfNo,
      movement,
    };

    const local: LocalScan = {
      ...scanData,
      rawText: data.rawText,
      confidence,
      synced: false,
    };

    try {
      const result = await apiJson.post<{ success: boolean; error?: string }>("/api/sync", {
        scans: [scanData],
        user: user?.name || "Unknown",
        branch_id: user?.branch_id,
      });
      if (result.success) {
        await Storage.save({ ...local, synced: true });
        toast.success("Saved to database");
        clearForm();
      } else if (result.error?.includes("Stock Error")) {
        toast.error(result.error);
        return;
      } else {
        await Storage.save(local);
        toast.warning("Saved locally (DB sync failed)");
        clearForm();
      }
    } catch {
      await Storage.save(local);
      toast.message("Saved locally (offline)");
      clearForm();
    }
    await reloadHistory();
  }

  function clearForm() {
    setHasScan(false);
    setPreview("");
    setForm({
      batchNo: "",
      mfgDate: "",
      expiryDate: "",
      flavour: "",
      rackNo: "",
      shelfNo: "",
      rawText: "",
    });
    setConfidence({});
    setMovement("IN");
  }

  async function syncAllLocal() {
    const scans = await Storage.getAll();
    const pending = scans.filter((s) => !s.synced);
    if (!pending.length) {
      toast.message("All local scans already synced");
      return;
    }
    try {
      const result = await apiJson.post<{
        success: boolean;
        synced?: number;
        error?: string;
      }>("/api/sync", {
        scans: pending.map((s) => ({
          timestamp: s.timestamp,
          batchNo: s.batchNo || "",
          mfgDate: s.mfgDate || "",
          expiryDate: s.expiryDate || "",
          flavour: s.flavour || "",
          rackNo: s.rackNo || "",
          shelfNo: s.shelfNo || "",
          movement: s.movement || "IN",
        })),
        user: user?.name || "Unknown",
        branch_id: user?.branch_id,
      });
      if (!result.success) {
        toast.error(result.error || "Sync failed");
        return;
      }
      for (const s of pending) {
        if (s.id != null) await Storage.markSynced(s.id);
      }
      toast.success(`Synced ${result.synced ?? pending.length} scans`);
      if (window.confirm("Clear local history after successful sync?")) {
        await Storage.clearAll();
      }
      await reloadHistory();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    }
  }

  function downloadCsv() {
    const rows = [
      ["Timestamp", "Batch", "MFG", "Expiry", "Flavour", "Rack", "Shelf", "Movement", "Synced"],
      ...history.map((s) => [
        s.timestamp,
        s.batchNo || "",
        s.mfgDate || "",
        s.expiryDate || "",
        s.flavour || "",
        s.rackNo || "",
        s.shelfNo || "",
        s.movement || "IN",
        s.synced ? "yes" : "no",
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `scans-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const filtered = history.filter((s) => {
    const q = search.toLowerCase();
    if (!q) return true;
    return [s.batchNo, s.flavour, s.rackNo, s.shelfNo, s.expiryDate]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });

  function confBadge(level?: string) {
    if (level === "high") return <Badge variant="success">High</Badge>;
    if (level === "low") return <Badge variant="warning">Low</Badge>;
    if (level === "swapped") return <Badge variant="secondary">Swapped</Badge>;
    return null;
  }

  return (
    <AuthGuard permission="view_scanner">
      <div className="space-y-6">
        {!online && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <WifiOff className="h-4 w-4" />
            Offline — scans save locally and OCR falls back to Tesseract.
          </div>
        )}

        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="flex items-center gap-3">
              <Checkbox
                checked={quickMode}
                onCheckedChange={(v) => setQuickMode(Boolean(v))}
                id="quick"
              />
              <Label htmlFor="quick">Quick mode (skip crop)</Label>
            </div>
            <div className="flex items-center gap-3">
              <Checkbox
                checked={continuous}
                onCheckedChange={(v) => setContinuous(Boolean(v))}
                id="cont"
              />
              <Label htmlFor="cont">Continuous save</Label>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0] || null)}
            />
            <Button onClick={() => fileRef.current?.click()} disabled={loading || !can("view_scanner")}>
              <Upload className="h-4 w-4" />
              {loading ? status || "Processing…" : "Choose image"}
            </Button>
          </CardContent>
        </Card>

        {loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="rounded-xl border bg-card p-8 text-center shadow-sm"
          >
            <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">{status || "Processing…"}</p>
          </motion.div>
        )}

        {hasScan && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle>Scan result</CardTitle>
                  <p className="text-sm text-muted-foreground">{timestamp}</p>
                </div>
                {preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview} alt="Preview" className="h-24 w-24 rounded-lg object-cover" />
                ) : null}
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Button
                    variant={movement === "IN" ? "default" : "outline"}
                    onClick={() => setMovement("IN")}
                  >
                    IN
                  </Button>
                  <Button
                    variant={movement === "OUT" ? "destructive" : "outline"}
                    onClick={() => setMovement("OUT")}
                  >
                    OUT
                  </Button>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {(
                    [
                      ["batchNo", "Batch No", confidence.batchNo],
                      ["mfgDate", "MFG Date", confidence.mfgDate],
                      ["expiryDate", "Expiry Date", confidence.expiryDate],
                      ["flavour", "Flavour", ""],
                      ["rackNo", "Rack No", ""],
                      ["shelfNo", "Shelf No", ""],
                    ] as const
                  ).map(([key, label, conf]) => (
                    <div key={key} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>{label}</Label>
                        {confBadge(conf)}
                      </div>
                      <Input
                        list={key === "rackNo" ? "racks" : key === "shelfNo" ? "shelves" : undefined}
                        value={form[key]}
                        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                      />
                    </div>
                  ))}
                </div>
                <datalist id="racks">
                  {racks.map((r) => (
                    <option key={r} value={r} />
                  ))}
                </datalist>
                <datalist id="shelves">
                  {shelves.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
                <pre className="max-h-40 overflow-auto rounded-lg bg-muted p-3 text-xs text-muted-foreground">
                  {form.rawText || "No OCR text"}
                </pre>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => saveScan()} disabled={!can("sync_scans") && !can("view_scanner")}>
                    <Save className="h-4 w-4" /> Save
                  </Button>
                  <Button variant="outline" onClick={clearForm}>
                    <Trash2 className="h-4 w-4" /> Clear
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
            <CardTitle>Local history</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Input
                className="w-48"
                placeholder="Search…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Button variant="outline" size="sm" onClick={syncAllLocal}>
                <RefreshCw className="h-4 w-4" /> Sync DB
              </Button>
              <Button variant="outline" size="sm" onClick={downloadCsv}>
                <Download className="h-4 w-4" /> CSV
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground">No scans yet.</p>
            ) : (
              filtered.slice(0, 50).map((s) => (
                <div
                  key={s.id ?? `${s.timestamp}-${s.batchNo}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm"
                >
                  <div>
                    <p className="font-medium">
                      {s.batchNo || "No batch"} · {s.flavour || "Unknown"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {s.mfgDate || "—"} → {s.expiryDate || "—"} · {s.rackNo}/{s.shelfNo} ·{" "}
                      {s.movement || "IN"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={s.synced ? "success" : "warning"}>
                      {s.synced ? "Synced" : "Local"}
                    </Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        if (s.id != null) {
                          await Storage.delete(s.id);
                          await reloadHistory();
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <ImageCropModal
          open={Boolean(cropSrc)}
          imageUrl={cropSrc || ""}
          onCancel={() => {
            cropWaiter.current?.resolve(null);
            cropWaiter.current = null;
            setCropSrc(null);
          }}
          onSkip={async () => {
            if (!cropSrc) return;
            const res = await fetch(cropSrc);
            const blob = await res.blob();
            cropWaiter.current?.resolve(new File([blob], "image.jpg", { type: "image/jpeg" }));
            cropWaiter.current = null;
            setCropSrc(null);
          }}
          onConfirm={(blob) => {
            cropWaiter.current?.resolve(
              new File([blob], "cropped.jpg", { type: "image/jpeg" })
            );
            cropWaiter.current = null;
            setCropSrc(null);
          }}
        />
      </div>
    </AuthGuard>
  );
}
