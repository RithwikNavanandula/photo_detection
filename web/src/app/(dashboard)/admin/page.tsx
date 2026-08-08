"use client";

import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { toast } from "sonner";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  Download,
  FileUp,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { AuthGuard } from "@/components/layout/auth-guard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { downloadInventoryExport, parseInventoryCsv } from "@/lib/export";

type DashboardStats = {
  total: number;
  in: number;
  out: number;
  current: number;
};

type RackSummary = {
  name: string;
  count: number;
  in_count: number;
  out_count: number;
};

type ActivityRow = {
  id: number;
  timestamp: string;
  batch: string | null;
  rack: string | null;
  shelf: string | null;
  movement: string;
  expiry_date: string | null;
  flavour: string | null;
  has_photo?: boolean;
};

type DashboardResponse = {
  stats: DashboardStats;
  racks: RackSummary[];
  activity?: ActivityRow[];
};

type Branch = { id: number; name: string; code: string };

type ExpiryForecast = {
  success: boolean;
  expiry_stats: {
    this_week: number;
    two_weeks: number;
    thirty_days: number;
  };
};

type EditForm = {
  id?: number;
  batch_no: string;
  mfg_date: string;
  expiry_date: string;
  flavour: string;
  rack_no: string;
  shelf_no: string;
  movement: string;
};

const EMPTY_FORM: EditForm = {
  batch_no: "",
  mfg_date: "",
  expiry_date: "",
  flavour: "",
  rack_no: "",
  shelf_no: "",
  movement: "IN",
};

function KpiCard({
  title,
  value,
  icon: Icon,
  accent,
}: {
  title: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <Card>
        <CardContent className="flex items-center gap-4 p-5">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-lg"
            style={{ backgroundColor: accent }}
          >
            <Icon className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {title}
            </p>
            <p className="font-display text-2xl text-foreground">{value}</p>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default function AdminDashboardPage() {
  const { isSuperadmin, can, user } = useAuth();
  const queryClient = useQueryClient();
  const [branchId, setBranchId] = useState<string>("all");
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<EditForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const csvRef = useRef<HTMLInputElement>(null);

  const branchesQuery = useQuery({
    queryKey: ["branches"],
    queryFn: () => apiJson.get<{ branches: Branch[] }>("/api/branches"),
    enabled: isSuperadmin,
  });

  const dashboardPath = useMemo(() => {
    if (branchId !== "all") return `/api/admin/dashboard?branch_id=${branchId}`;
    return "/api/admin/dashboard";
  }, [branchId]);

  const forecastPath = useMemo(() => {
    if (branchId !== "all")
      return `/api/admin/expiry-forecast?branch_id=${branchId}`;
    return "/api/admin/expiry-forecast";
  }, [branchId]);

  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["admin-dashboard", branchId],
    queryFn: () => apiJson.get<DashboardResponse>(dashboardPath),
    refetchInterval: 30_000,
  });

  const forecastQuery = useQuery({
    queryKey: ["admin-expiry-forecast", branchId],
    queryFn: () => apiJson.get<ExpiryForecast>(forecastPath),
    enabled: can("view_analytics") || isSuperadmin,
    retry: false,
  });

  const stats = data?.stats;
  const racks = data?.racks ?? [];
  const activity = data?.activity ?? [];
  const expiry = forecastQuery.data?.expiry_stats;
  const canManage = can("manage_scans") || isSuperadmin;
  const canExport = can("export_data") || isSuperadmin;

  function openAdd(rack = "", shelf = "") {
    setForm({ ...EMPTY_FORM, rack_no: rack, shelf_no: shelf });
    setEditOpen(true);
  }

  function openEdit(row: ActivityRow) {
    setForm({
      id: row.id,
      batch_no: row.batch || "",
      mfg_date: "",
      expiry_date: row.expiry_date || "",
      flavour: "",
      rack_no: row.rack || "",
      shelf_no: row.shelf || "",
      movement: row.movement || "IN",
    });
    setEditOpen(true);
  }

  async function saveItem() {
    setSaving(true);
    try {
      if (form.id) {
        await apiJson.post("/api/admin/scan/update", {
          id: form.id,
          batch_no: form.batch_no,
          mfg_date: form.mfg_date,
          expiry_date: form.expiry_date,
          flavour: form.flavour,
          rack_no: form.rack_no,
          shelf_no: form.shelf_no,
          movement: form.movement,
        });
        toast.success("Scan updated");
      } else {
        await apiJson.post("/api/admin/scan/add", {
          batch_no: form.batch_no,
          mfg_date: form.mfg_date,
          expiry_date: form.expiry_date,
          flavour: form.flavour,
          rack_no: form.rack_no,
          shelf_no: form.shelf_no,
          movement: form.movement,
          branch_id: branchId !== "all" ? Number(branchId) : user?.branch_id,
          synced_by: user?.name || "Admin",
        });
        toast.success("Item added");
      }
      setEditOpen(false);
      queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function deleteScan(id: number) {
    if (!window.confirm("Delete this scan?")) return;
    try {
      await apiJson.post("/api/admin/scan/delete", { id });
      toast.success("Deleted");
      queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function handleCsv(file: File | null) {
    if (!file) return;
    try {
      const text = await file.text();
      const scans = parseInventoryCsv(text);
      if (!scans.length) {
        toast.error("CSV has no usable rows");
        return;
      }
      if (!window.confirm(`Import ${scans.length} items from CSV?`)) return;
      const result = await apiJson.post<{ success: boolean; imported?: number }>(
        "/api/admin/csv/import",
        {
          scans,
          branch_id: branchId !== "all" ? Number(branchId) : user?.branch_id,
          synced_by: user?.name || "CSV Import",
        }
      );
      toast.success(`Imported ${result.imported ?? scans.length} items`);
      queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      if (csvRef.current) csvRef.current.value = "";
    }
  }

  return (
    <AuthGuard permission="view_admin_dashboard">
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl text-foreground">Dashboard</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Scan volume, stock position, and inventory actions
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isSuperadmin && (
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="All branches" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All branches</SelectItem>
                  {(branchesQuery.data?.branches ?? []).map((b) => (
                    <SelectItem key={b.id} value={String(b.id)}>
                      {b.name} ({b.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {canManage && (
              <>
                <Button size="sm" onClick={() => openAdd()}>
                  <Plus className="h-4 w-4" /> Add item
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => csvRef.current?.click()}
                >
                  <FileUp className="h-4 w-4" /> Import CSV
                </Button>
                <input
                  ref={csvRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => handleCsv(e.target.files?.[0] || null)}
                />
              </>
            )}
            {canExport && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => downloadInventoryExport(branchId)}
              >
                <Download className="h-4 w-4" /> Export
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        {error ? (
          <Card>
            <CardContent className="p-5 text-sm text-destructive">
              {error instanceof Error ? error.message : "Failed to load dashboard"}
            </CardContent>
          </Card>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard title="Total scans" value={stats?.total ?? 0} icon={Package} accent="#0a67ae" />
          <KpiCard title="IN" value={stats?.in ?? 0} icon={ArrowDownToLine} accent="#0d9488" />
          <KpiCard title="OUT" value={stats?.out ?? 0} icon={ArrowUpFromLine} accent="#b45309" />
          <KpiCard title="Current stock" value={stats?.current ?? 0} icon={Boxes} accent="#1e3a5f" />
        </div>

        {(can("view_analytics") || isSuperadmin) && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs uppercase text-muted-foreground">Expiring this week</p>
                <p className="font-display text-2xl text-red-600">{expiry?.this_week ?? 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs uppercase text-muted-foreground">Next 2 weeks</p>
                <p className="font-display text-2xl text-amber-600">{expiry?.two_weeks ?? 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs uppercase text-muted-foreground">Next 30 days</p>
                <p className="font-display text-2xl">{expiry?.thirty_days ?? 0}</p>
              </CardContent>
            </Card>
          </div>
        )}

        <div>
          <h2 className="mb-3 font-display text-xl text-foreground">Racks</h2>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading racks…</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {racks.map((rack) => (
                <Card key={rack.name}>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center justify-between text-sm">
                      <span>{rack.name}</span>
                      {canManage && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2"
                          onClick={() => openAdd(rack.name, "Shelf A")}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="font-display text-2xl">{rack.count}</p>
                    <div className="flex gap-2 text-xs text-muted-foreground">
                      <span>IN {rack.in_count}</span>
                      <span>·</span>
                      <span>OUT {rack.out_count}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Photo</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Flavor</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead>Rack</TableHead>
                  <TableHead>Shelf</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead>Movement</TableHead>
                  {canManage && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {activity.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={canManage ? 9 : 8}
                      className="text-muted-foreground"
                    >
                      No recent activity
                    </TableCell>
                  </TableRow>
                ) : (
                  activity.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        {row.has_photo ? (
                          <a
                            href={`/api/scans/${row.id}/photo`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-block"
                            title="Open scan photo"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={`/api/scans/${row.id}/photo`}
                              alt=""
                              className="h-10 w-10 rounded object-cover"
                            />
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {row.timestamp || "—"}
                      </TableCell>
                      <TableCell>{row.flavour || "—"}</TableCell>
                      <TableCell>{row.batch || "—"}</TableCell>
                      <TableCell>{row.rack || "—"}</TableCell>
                      <TableCell>{row.shelf || "—"}</TableCell>
                      <TableCell>{row.expiry_date || "—"}</TableCell>
                      <TableCell>
                        <Badge variant={row.movement === "OUT" ? "warning" : "success"}>
                          {row.movement || "IN"}
                        </Badge>
                      </TableCell>
                      {canManage && (
                        <TableCell className="space-x-1 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openEdit(row)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => deleteScan(row.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {editOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <Card className="w-full max-w-lg">
              <CardHeader>
                <CardTitle>{form.id ? "Edit scan" : "Add item"}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                {(
                  [
                    ["batch_no", "Batch"],
                    ["mfg_date", "MFG date"],
                    ["expiry_date", "Expiry"],
                    ["flavour", "Flavour"],
                    ["rack_no", "Rack"],
                    ["shelf_no", "Shelf"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className="space-y-1">
                    <Label>{label}</Label>
                    <Input
                      value={form[key]}
                      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    />
                  </div>
                ))}
                <div className="space-y-1">
                  <Label>Movement</Label>
                  <Select
                    value={form.movement}
                    onValueChange={(v) => setForm({ ...form, movement: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="IN">IN</SelectItem>
                      <SelectItem value="OUT">OUT</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-full flex justify-end gap-2 pt-2">
                  <Button variant="ghost" onClick={() => setEditOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={saveItem} disabled={saving}>
                    {saving ? "Saving…" : "Save"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </AuthGuard>
  );
}
