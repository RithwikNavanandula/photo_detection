"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CloudUpload, RefreshCw, Search, Trash2 } from "lucide-react";
import { AuthGuard } from "@/components/layout/auth-guard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/use-auth";
import { apiJson } from "@/lib/api";
import { Storage, type LocalScan } from "@/lib/storage";

export default function ScannedHistoryPage() {
  const { user, can, isSuperadmin } = useAuth();
  const [scans, setScans] = useState<LocalScan[]>([]);
  const [search, setSearch] = useState("");
  const [syncFilter, setSyncFilter] = useState("all");
  const [movementFilter, setMovementFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncingId, setSyncingId] = useState<number | null>(null);

  async function reload() {
    setLoading(true);
    try {
      setScans(await Storage.getAll());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  const stats = useMemo(() => {
    const synced = scans.filter((s) => s.synced).length;
    const today = new Date().toLocaleDateString("en-IN");
    const todayCount = scans.filter((s) =>
      (s.timestamp || "").includes(today.split(",")[0] || today)
    ).length;
    return {
      total: scans.length,
      synced,
      unsynced: scans.length - synced,
      today: todayCount,
    };
  }, [scans]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scans.filter((s) => {
      if (syncFilter === "synced" && !s.synced) return false;
      if (syncFilter === "unsynced" && s.synced) return false;
      if (movementFilter !== "all" && (s.movement || "IN") !== movementFilter)
        return false;
      if (!q) return true;
      return [s.batchNo, s.flavour, s.rackNo, s.shelfNo, s.expiryDate, s.movement]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [scans, search, syncFilter, movementFilter]);

  async function syncPayload(items: LocalScan[]) {
    return apiJson.post<{ success: boolean; synced?: number; error?: string }>(
      "/api/sync",
      {
        scans: items.map((s) => ({
          timestamp: s.timestamp,
          batchNo: s.batchNo || "",
          mfgDate: s.mfgDate || "",
          expiryDate: s.expiryDate || "",
          flavour: s.flavour || "",
          rackNo: s.rackNo || "",
          shelfNo: s.shelfNo || "",
          movement: s.movement || "IN",
          imageData: s.imageData || undefined,
        })),
        user: user?.name || user?.username || "Unknown",
        branch_id: user?.branch_id,
      }
    );
  }

  async function handleDelete(id?: number) {
    if (id == null) return;
    await Storage.delete(id);
    toast.success("Scan removed");
    await reload();
  }

  async function handleClearAll() {
    if (!scans.length) return;
    if (!window.confirm("Clear all local scan history on this device?")) return;
    await Storage.clearAll();
    toast.success("Local history cleared");
    await reload();
  }

  async function handleSyncOne(scan: LocalScan) {
    if (scan.id == null) return;
    if (!can("sync_scans") && !isSuperadmin) {
      toast.error("You do not have sync permission");
      return;
    }
    setSyncingId(scan.id);
    try {
      const result = await syncPayload([scan]);
      if (!result.success) {
        toast.error(result.error || "Sync failed");
        return;
      }
      await Storage.markSynced(scan.id);
      toast.success("Scan synced");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncingId(null);
    }
  }

  async function handleSyncPending() {
    if (!can("sync_scans") && !isSuperadmin) {
      toast.error("You do not have sync permission");
      return;
    }
    const pending = scans.filter((s) => !s.synced);
    if (!pending.length) {
      toast.message("All scans already synced");
      return;
    }
    setSyncing(true);
    let done = 0;
    let failed = 0;
    try {
      for (const scan of pending) {
        try {
          const result = await syncPayload([scan]);
          if (result.success && scan.id != null) {
            await Storage.markSynced(scan.id);
            done++;
          } else {
            failed++;
          }
        } catch {
          failed++;
        }
      }
      toast.success(
        failed
          ? `${done} synced, ${failed} failed`
          : `Synced ${done} scans`
      );
      if (done > 0 && failed === 0 && window.confirm("Clear local history after sync?")) {
        await Storage.clearAll();
      }
      await reload();
    } finally {
      setSyncing(false);
    }
  }

  return (
    <AuthGuard permission="view_scanner">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              { label: "Total", value: stats.total, variant: "default" as const },
              { label: "Synced", value: stats.synced, variant: "success" as const },
              { label: "Not synced", value: stats.unsynced, variant: "warning" as const },
              { label: "Today", value: stats.today, variant: "secondary" as const },
            ] as const
          ).map((item) => (
            <Card key={item.label}>
              <CardContent className="p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {item.label}
                </p>
                <p className="font-display text-2xl">{item.value}</p>
                <Badge variant={item.variant} className="mt-1">
                  {item.label}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="font-display text-xl">My scans</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Local IndexedDB history on this device
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                Reload
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSyncPending}
                disabled={syncing || (!can("sync_scans") && !isSuperadmin)}
              >
                <CloudUpload className="h-4 w-4" />
                {syncing ? "Syncing…" : "Sync all pending"}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleClearAll}
                disabled={!scans.length}
              >
                <Trash2 className="h-4 w-4" />
                Clear all
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search local scans…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={syncFilter} onValueChange={setSyncFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sync states</SelectItem>
                <SelectItem value="unsynced">Not synced</SelectItem>
                <SelectItem value="synced">Synced</SelectItem>
              </SelectContent>
            </Select>
            <Select value={movementFilter} onValueChange={setMovementFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All movements</SelectItem>
                <SelectItem value="IN">IN</SelectItem>
                <SelectItem value="OUT">OUT</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="px-0 pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Photo</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead>Flavour</TableHead>
                  <TableHead>MFG</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Movement</TableHead>
                  <TableHead>Sync</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-muted-foreground">
                      No local scans yet
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((scan) => (
                    <TableRow key={scan.id ?? `${scan.timestamp}-${scan.batchNo}`}>
                      <TableCell>
                        {scan.imageData ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={scan.imageData}
                            alt=""
                            className="h-10 w-10 rounded object-cover"
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {scan.timestamp}
                      </TableCell>
                      <TableCell>{scan.batchNo || "—"}</TableCell>
                      <TableCell>{scan.flavour || "—"}</TableCell>
                      <TableCell>{scan.mfgDate || "—"}</TableCell>
                      <TableCell>{scan.expiryDate || "—"}</TableCell>
                      <TableCell>
                        {[scan.rackNo, scan.shelfNo].filter(Boolean).join(" / ") || "—"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={scan.movement === "OUT" ? "warning" : "success"}
                        >
                          {scan.movement || "IN"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={scan.synced ? "success" : "destructive"}>
                          {scan.synced ? "Synced" : "Pending"}
                        </Badge>
                      </TableCell>
                      <TableCell className="space-x-1 text-right">
                        {!scan.synced && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={
                              syncingId === scan.id ||
                              (!can("sync_scans") && !isSuperadmin)
                            }
                            onClick={() => handleSyncOne(scan)}
                          >
                            <CloudUpload className="h-4 w-4" />
                            {syncingId === scan.id ? "…" : "Sync"}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(scan.id)}
                          disabled={scan.id == null}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AuthGuard>
  );
}
