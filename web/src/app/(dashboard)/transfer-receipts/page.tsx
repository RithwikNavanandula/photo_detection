"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckCircle2,
  ExternalLink,
  Printer,
  RefreshCw,
  X,
} from "lucide-react";
import { AuthGuard } from "@/components/layout/auth-guard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { ApiError, apiJson } from "@/lib/api";
import {
  TRANSFER_STATUSES,
  formatDateTime,
  statusBadgeVariant,
  statusLabel,
  truckLabel,
  type Branch,
  type TransferRequest,
} from "@/lib/transfer";

export default function TransferReceiptsPage() {
  const { user, isSuperadmin } = useAuth();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const branchesQuery = useQuery({
    queryKey: ["branches"],
    enabled: isSuperadmin,
    queryFn: () => apiJson.get<{ branches: Branch[] }>("/api/branches"),
  });

  const receiptsQuery = useQuery({
    queryKey: ["transfer-receipts", statusFilter, branchFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (branchFilter) params.set("branch_id", branchFilter);
      const qs = params.toString();
      return apiJson.get<{ success: boolean; receipts: TransferRequest[] }>(
        `/api/transfer/receipts${qs ? `?${qs}` : ""}`
      );
    },
  });

  const detailQuery = useQuery({
    queryKey: ["transfer-receipt", selectedId],
    enabled: selectedId != null,
    queryFn: () =>
      apiJson.get<{ success: boolean; receipt: TransferRequest }>(
        `/api/transfer/receipts/${selectedId}`
      ),
  });

  const markReceivedMutation = useMutation({
    mutationFn: (id: number) =>
      apiJson.post<{ success: boolean; error?: string }>(
        `/api/transfer/receipts/${id}/mark-received`
      ),
    onSuccess: () => {
      toast.success("Receipt marked as received");
      queryClient.invalidateQueries({ queryKey: ["transfer-receipts"] });
      queryClient.invalidateQueries({ queryKey: ["transfer-receipt"] });
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to mark as received"
      );
    },
  });

  const receipts = receiptsQuery.data?.receipts || [];
  const receipt = detailQuery.data?.receipt;
  const receiptStatus = (receipt?.receipt_status || "pending").toLowerCase();
  const canMarkReceived =
    receipt &&
    receiptStatus !== "received" &&
    (isSuperadmin ||
      (user?.branch_id != null &&
        String(user.branch_id) === String(receipt.destination_branch_id)));

  return (
    <AuthGuard permission="receive_transfer">
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl text-slate-900">
              Transfer Receipts
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Browse incoming branch transfers and mark them as received.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isSuperadmin && (
              <Select
                value={branchFilter || "__all__"}
                onValueChange={(v) =>
                  setBranchFilter(v === "__all__" ? "" : v)
                }
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="All branches" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All branches</SelectItem>
                  {(branchesQuery.data?.branches || []).map((b) => (
                    <SelectItem key={b.id} value={String(b.id)}>
                      {b.name} ({b.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select
              value={statusFilter || "__all__"}
              onValueChange={(v) =>
                setStatusFilter(v === "__all__" ? "" : v)
              }
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All statuses</SelectItem>
                {TRANSFER_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {statusLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={() => receiptsQuery.refetch()}
              disabled={receiptsQuery.isFetching}
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm">
            Incoming receipts{" "}
            <strong className="text-primary">{receipts.length}</strong>
          </div>
          <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm">
            Selected branch{" "}
            <strong className="text-slate-900">
              {branchFilter
                ? branchesQuery.data?.branches?.find(
                    (b) => String(b.id) === branchFilter
                  )?.name || branchFilter
                : user?.branch_id
                  ? "Current branch"
                  : "All"}
            </strong>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Receipts</CardTitle>
            <CardDescription>
              Click a row to inspect stock items and mark received.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Truck</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {receiptsQuery.isLoading ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="text-center text-muted-foreground"
                      >
                        Loading…
                      </TableCell>
                    </TableRow>
                  ) : receipts.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="text-center text-muted-foreground"
                      >
                        No incoming transfer receipts found
                      </TableCell>
                    </TableRow>
                  ) : (
                    receipts.map((r) => (
                      <TableRow
                        key={r.id}
                        className="cursor-pointer"
                        onClick={() => setSelectedId(r.id)}
                      >
                        <TableCell className="font-medium">#{r.id}</TableCell>
                        <TableCell>
                          <div className="font-medium text-primary">
                            {r.source_branch_name || "—"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {r.source_branch_code || ""}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>{r.destination_branch_name || "—"}</div>
                          <div className="text-xs text-muted-foreground">
                            Destination branch
                          </div>
                        </TableCell>
                        <TableCell>{r.quantity || 1}</TableCell>
                        <TableCell className="text-sm">
                          {truckLabel(r)}
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <Badge variant={statusBadgeVariant(r.status)}>
                              {statusLabel(r.status)}
                            </Badge>
                            <Badge
                              variant={statusBadgeVariant(r.receipt_status)}
                            >
                              {statusLabel(r.receipt_status || "pending")}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDateTime(r.created_at)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {selectedId != null && (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 md:p-8"
            onClick={() => setSelectedId(null)}
          >
            <div
              className="my-4 w-full max-w-4xl rounded-xl border border-border bg-card shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">
                    Transfer receipt #{selectedId}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Incoming branch transfer detail
                  </p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setSelectedId(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="space-y-5 p-5">
                {detailQuery.isLoading || !receipt ? (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                ) : (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {[
                        ["Status", statusLabel(receipt.status)],
                        [
                          "Receipt status",
                          statusLabel(receipt.receipt_status || "pending"),
                        ],
                        [
                          "From",
                          `${receipt.source_branch_name || "—"}${
                            receipt.source_branch_code
                              ? ` (${receipt.source_branch_code})`
                              : ""
                          }`,
                        ],
                        [
                          "To",
                          `${receipt.destination_branch_name || "—"}${
                            receipt.destination_branch_code
                              ? ` (${receipt.destination_branch_code})`
                              : ""
                          }`,
                        ],
                        ["Truck", truckLabel(receipt)],
                        ["Quantity", String(receipt.quantity || 1)],
                        ["Requested by", receipt.requested_by_name || "—"],
                        ["Created", formatDateTime(receipt.created_at)],
                        ["Updated", formatDateTime(receipt.updated_at)],
                        ["Received at", formatDateTime(receipt.received_at)],
                        ["Received by", receipt.received_by_name || "—"],
                        ["Notes", receipt.notes || "—"],
                      ].map(([label, value]) => (
                        <div
                          key={label}
                          className="rounded-lg border border-border bg-slate-50 px-3 py-2"
                        >
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                            {label}
                          </p>
                          <p className="mt-1 text-sm text-slate-900">{value}</p>
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        onClick={() =>
                          window.open(
                            `/transfer-receipts/${selectedId}/print`,
                            "_blank",
                            "noopener,noreferrer"
                          )
                        }
                      >
                        <Printer className="h-4 w-4" />
                        Print / Save PDF
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                      {canMarkReceived && (
                        <Button
                          disabled={markReceivedMutation.isPending}
                          onClick={() => {
                            if (!confirm("Mark this receipt as received?"))
                              return;
                            markReceivedMutation.mutate(selectedId);
                          }}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          Mark as received
                        </Button>
                      )}
                    </div>

                    {receiptStatus === "received" ? (
                      <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                        This receipt has already been marked as received.
                      </p>
                    ) : (
                      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                        Use &ldquo;Mark as received&rdquo; after the transfer
                        physically arrives at your branch.
                      </p>
                    )}

                    <div>
                      <h3 className="mb-3 text-sm font-semibold text-slate-900">
                        Transferred items
                      </h3>
                      <div className="overflow-hidden rounded-xl border border-border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Stock ID</TableHead>
                              <TableHead>Batch</TableHead>
                              <TableHead>Expiry</TableHead>
                              <TableHead>Flavour</TableHead>
                              <TableHead>Rack</TableHead>
                              <TableHead>Shelf</TableHead>
                              <TableHead>Source branch</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {(receipt.stock_items || []).length === 0 ? (
                              <TableRow>
                                <TableCell
                                  colSpan={7}
                                  className="text-center text-muted-foreground"
                                >
                                  No linked stock items found
                                </TableCell>
                              </TableRow>
                            ) : (
                              (receipt.stock_items || []).map((item) => (
                                <TableRow
                                  key={
                                    item.stock_id +
                                    "-" +
                                    (item.batch_no || "")
                                  }
                                >
                                  <TableCell>#{item.stock_id}</TableCell>
                                  <TableCell>{item.batch_no || "—"}</TableCell>
                                  <TableCell>
                                    {item.expiry_date || "—"}
                                  </TableCell>
                                  <TableCell>{item.flavour || "—"}</TableCell>
                                  <TableCell>{item.rack_no || "—"}</TableCell>
                                  <TableCell>{item.shelf_no || "—"}</TableCell>
                                  <TableCell>
                                    {item.branch_name || "—"}
                                    {item.branch_code
                                      ? ` (${item.branch_code})`
                                      : ""}
                                  </TableCell>
                                </TableRow>
                              ))
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </AuthGuard>
  );
}
