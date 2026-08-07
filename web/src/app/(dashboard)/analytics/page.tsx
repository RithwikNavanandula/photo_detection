"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CalendarClock, RefreshCw } from "lucide-react";
import { AuthGuard } from "@/components/layout/auth-guard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

type Branch = { id: number; name: string; code: string };

type AnalyticsResponse = {
  stats: {
    total: number;
    in: number;
    out: number;
    current: number;
    active_racks: number;
  };
  racks: { name: string; count: number }[];
  daily: { date: string; in_count: number; out_count: number }[];
};

type ExpiryForecast = {
  success: boolean;
  labels: string[];
  datasets: { label: string; data: number[]; backgroundColor: string }[];
  expiry_stats: {
    this_week: number;
    two_weeks: number;
    thirty_days: number;
  };
};

type ExpiryItem = {
  batch_no: string;
  mfg_date: string;
  expiry_date: string;
  flavour: string;
  rack_no: string;
  shelf_no: string;
};

const PIE_COLORS = ["#0a67ae", "#0d9488", "#1e3a5f", "#b45309", "#64748b", "#0891b2"];

export default function AnalyticsPage() {
  const { isSuperadmin } = useAuth();
  const [branchId, setBranchId] = useState("all");
  const [week, setWeek] = useState("1");

  const branchQs = branchId !== "all" ? `&branch_id=${branchId}` : "";
  const branchParam = branchId !== "all" ? `?branch_id=${branchId}` : "";

  const branchesQuery = useQuery({
    queryKey: ["branches"],
    queryFn: () => apiJson.get<{ branches: Branch[] }>("/api/branches"),
    enabled: isSuperadmin,
  });

  const analyticsQuery = useQuery({
    queryKey: ["analytics", branchId],
    queryFn: () =>
      apiJson.get<AnalyticsResponse>(`/api/admin/analytics${branchParam}`),
  });

  const forecastQuery = useQuery({
    queryKey: ["expiry-forecast", branchId],
    queryFn: () =>
      apiJson.get<ExpiryForecast>(`/api/admin/expiry-forecast${branchParam}`),
  });

  const itemsQuery = useQuery({
    queryKey: ["expiry-items", branchId, week],
    queryFn: () =>
      apiJson.get<{ success: boolean; items: ExpiryItem[] }>(
        `/api/admin/expiry-items?week=${week}${branchQs}`
      ),
  });

  const pieData = useMemo(
    () =>
      (analyticsQuery.data?.racks ?? [])
        .filter((r) => r.count > 0)
        .map((r) => ({ name: r.name, value: r.count })),
    [analyticsQuery.data]
  );

  const forecastBars = useMemo(() => {
    const forecast = forecastQuery.data;
    if (!forecast?.labels?.length) return [];
    return forecast.labels.map((label, i) => {
      const row: Record<string, string | number> = { week: label };
      for (const ds of forecast.datasets) {
        row[ds.label] = ds.data[i] ?? 0;
      }
      return row;
    });
  }, [forecastQuery.data]);

  const flavorKeys = forecastQuery.data?.datasets.map((d) => d.label) ?? [];
  const stats = analyticsQuery.data?.stats;
  const expiryStats = forecastQuery.data?.expiry_stats;

  return (
    <AuthGuard permission="view_analytics">
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl text-foreground">Analytics</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Movement trends, rack mix, and expiry forecast
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                analyticsQuery.refetch();
                forecastQuery.refetch();
                itemsQuery.refetch();
              }}
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {[
            { label: "Total scans", value: stats?.total ?? 0 },
            { label: "IN", value: stats?.in ?? 0 },
            { label: "OUT", value: stats?.out ?? 0 },
            { label: "Current stock", value: stats?.current ?? 0 },
            { label: "Active racks", value: stats?.active_racks ?? 0 },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardContent className="p-5">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {kpi.label}
                </p>
                <p className="mt-1 font-display text-2xl">{kpi.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Daily activity (7 days)</CardTitle>
            </CardHeader>
            <CardContent className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={analyticsQuery.data?.daily ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="in_count"
                    name="IN"
                    stroke="#0a67ae"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="out_count"
                    name="OUT"
                    stroke="#0d9488"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Stock by rack</CardTitle>
            </CardHeader>
            <CardContent className="h-[280px]">
              {pieData.length === 0 ? (
                <p className="text-sm text-muted-foreground">No rack stock yet</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      label
                    >
                      {pieData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { label: "Expiring this week", value: expiryStats?.this_week ?? 0 },
            { label: "Next 2 weeks", value: expiryStats?.two_weeks ?? 0 },
            { label: "Next 30 days", value: expiryStats?.thirty_days ?? 0 },
          ].map((item) => (
            <Card key={item.label}>
              <CardContent className="flex items-center gap-3 p-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-600/10 text-teal-700">
                  <CalendarClock className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                  <p className="font-display text-xl">{item.value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Expiry forecast by flavour</CardTitle>
          </CardHeader>
          <CardContent className="h-[320px]">
            {forecastBars.length === 0 || flavorKeys.length === 0 ? (
              <p className="text-sm text-muted-foreground">No upcoming expiries</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={forecastBars.slice(0, 12)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  {forecastQuery.data?.datasets.map((ds) => (
                    <Bar
                      key={ds.label}
                      dataKey={ds.label}
                      stackId="a"
                      fill={ds.backgroundColor || "#0a67ae"}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle>Items expiring by week</CardTitle>
            <Select value={week} onValueChange={setWeek}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 20 }, (_, i) => String(i + 1)).map((w) => (
                  <SelectItem key={w} value={w}>
                    Week {w}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch</TableHead>
                  <TableHead>Flavour</TableHead>
                  <TableHead>MFG</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead>Rack</TableHead>
                  <TableHead>Shelf</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(itemsQuery.data?.items ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground">
                      No items in this week
                    </TableCell>
                  </TableRow>
                ) : (
                  (itemsQuery.data?.items ?? []).map((item, idx) => (
                    <TableRow key={`${item.batch_no}-${idx}`}>
                      <TableCell>{item.batch_no}</TableCell>
                      <TableCell>{item.flavour}</TableCell>
                      <TableCell>{item.mfg_date}</TableCell>
                      <TableCell>{item.expiry_date}</TableCell>
                      <TableCell>{item.rack_no}</TableCell>
                      <TableCell>{item.shelf_no}</TableCell>
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
