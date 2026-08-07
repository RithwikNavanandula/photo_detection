"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, RefreshCw, Search } from "lucide-react";
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
import { downloadInventoryExport } from "@/lib/export";

type Branch = { id: number; name: string; code: string };

type PivotScan = {
  id: number;
  timestamp: string | null;
  batch_no: string | null;
  mfg_date: string | null;
  expiry_date: string | null;
  flavour: string | null;
  rack_no: string | null;
  shelf_no: string | null;
  movement: string | null;
  branch_id: number | null;
  synced_by: string | null;
  branch_name: string | null;
  requested_by_name: string | null;
  source_branch_name: string | null;
  production_room_name: string | null;
};

function parseLooseDate(value?: string | null) {
  if (!value) return null;
  for (const fmt of [
    /^(\d{2})\/(\d{2})\/(\d{4})$/,
    /^(\d{2})-(\d{2})-(\d{4})$/,
    /^(\d{4})-(\d{2})-(\d{2})$/,
  ]) {
    const m = value.match(fmt);
    if (!m) continue;
    if (fmt.source.startsWith("^(\\d{4})")) {
      return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
    }
    return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime();
  }
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

export default function PivotPage() {
  const { isSuperadmin, can } = useAuth();
  const [branchId, setBranchId] = useState("all");
  const [search, setSearch] = useState("");
  const [movement, setMovement] = useState("all");
  const [sort, setSort] = useState("newest");

  const branchesQuery = useQuery({
    queryKey: ["branches"],
    queryFn: () => apiJson.get<{ branches: Branch[] }>("/api/branches"),
    enabled: isSuperadmin,
  });

  const path =
    branchId !== "all"
      ? `/api/admin/pivot?branch_id=${branchId}`
      : "/api/admin/pivot";

  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["pivot", branchId],
    queryFn: () =>
      apiJson.get<{ success: boolean; scans: PivotScan[] }>(path),
  });

  const filtered = useMemo(() => {
    let rows = data?.scans ?? [];
    const q = search.trim().toLowerCase();
    if (movement !== "all") {
      rows = rows.filter((r) => (r.movement || "IN") === movement);
    }
    if (q) {
      rows = rows.filter((row) =>
        [
          row.batch_no,
          row.flavour,
          row.rack_no,
          row.shelf_no,
          row.branch_name,
          row.synced_by,
          row.movement,
          row.production_room_name,
          row.requested_by_name,
        ]
          .join(" ")
          .toLowerCase()
          .includes(q)
      );
    }
    const sorted = [...rows];
    sorted.sort((a, b) => {
      if (sort === "oldest") return (a.id || 0) - (b.id || 0);
      if (sort === "expiry-asc" || sort === "expiry-desc") {
        const da = parseLooseDate(a.expiry_date) ?? Number.POSITIVE_INFINITY;
        const db = parseLooseDate(b.expiry_date) ?? Number.POSITIVE_INFINITY;
        return sort === "expiry-asc" ? da - db : db - da;
      }
      return (b.id || 0) - (a.id || 0);
    });
    return sorted;
  }, [data, search, movement, sort]);

  return (
    <AuthGuard permission="view_pivot">
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl text-foreground">
              Ledger entries
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Flat scan ledger for filtering and audit
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
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {(can("export_data") || isSuperadmin) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => downloadInventoryExport(branchId)}
              >
                <Download className="h-4 w-4" /> Export CSV
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

        <Card>
          <CardHeader className="flex flex-col gap-3 space-y-0 lg:flex-row lg:items-center lg:justify-between">
            <CardTitle>
              {isLoading ? "Loading…" : `${filtered.length} rows`}
            </CardTitle>
            <div className="flex flex-wrap gap-2">
              <div className="relative w-full max-w-xs">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search batch, flavour, rack…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={movement} onValueChange={setMovement}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All movements</SelectItem>
                  <SelectItem value="IN">IN</SelectItem>
                  <SelectItem value="OUT">OUT</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">Newest first</SelectItem>
                  <SelectItem value="oldest">Oldest first</SelectItem>
                  <SelectItem value="expiry-asc">Expiry ascending</SelectItem>
                  <SelectItem value="expiry-desc">Expiry descending</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {error ? (
              <p className="px-5 pb-5 text-sm text-destructive">
                {error instanceof Error ? error.message : "Failed to load"}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Batch</TableHead>
                    <TableHead>Flavour</TableHead>
                    <TableHead>MFG</TableHead>
                    <TableHead>Expiry</TableHead>
                    <TableHead>Rack</TableHead>
                    <TableHead>Shelf</TableHead>
                    <TableHead>Movement</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Synced by</TableHead>
                    <TableHead>Requested by</TableHead>
                    <TableHead>Production</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={12} className="text-muted-foreground">
                        No ledger rows
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {row.timestamp || "—"}
                        </TableCell>
                        <TableCell>{row.batch_no || "—"}</TableCell>
                        <TableCell>{row.flavour || "—"}</TableCell>
                        <TableCell>{row.mfg_date || "—"}</TableCell>
                        <TableCell>{row.expiry_date || "—"}</TableCell>
                        <TableCell>{row.rack_no || "—"}</TableCell>
                        <TableCell>{row.shelf_no || "—"}</TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              row.movement === "OUT" ? "warning" : "success"
                            }
                          >
                            {row.movement || "IN"}
                          </Badge>
                        </TableCell>
                        <TableCell>{row.branch_name || "—"}</TableCell>
                        <TableCell>{row.synced_by || "—"}</TableCell>
                        <TableCell>{row.requested_by_name || "—"}</TableCell>
                        <TableCell>
                          {row.production_room_name || "—"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AuthGuard>
  );
}
