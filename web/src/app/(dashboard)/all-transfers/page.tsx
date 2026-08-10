"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
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
import { ApiError, apiJson } from "@/lib/api";
import {
  TRANSFER_STATUSES,
  destinationLabel,
  formatDateTime,
  statusBadgeVariant,
  statusLabel,
  truckLabel,
  type TransferRequest,
} from "@/lib/transfer";

export default function TransferReportsPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("");

  const requestsQuery = useQuery({
    queryKey: ["transfer-requests", statusFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      const qs = params.toString();
      return apiJson.get<{ success: boolean; requests: TransferRequest[] }>(
        `/api/transfer/requests${qs ? `?${qs}` : ""}`
      );
    },
  });

  const updateMutation = useMutation({
    mutationFn: (payload: { id: number; status: string }) =>
      apiJson.post<{ success: boolean; error?: string }>(
        "/api/transfer/update-status",
        payload
      ),
    onSuccess: () => {
      toast.success("Status updated");
      queryClient.invalidateQueries({ queryKey: ["transfer-requests"] });
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to update status"
      );
    },
  });

  const requests = requestsQuery.data?.requests || [];

  return (
    <AuthGuard permission="manage_transfers">
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl text-slate-900">
              Transfer Requests Report
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Review transfer requests. Status becomes completed when all mapped
              stock is OUT-scanned.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={statusFilter || "__all__"}
              onValueChange={(v) =>
                setStatusFilter(v === "__all__" ? "" : v)
              }
            >
              <SelectTrigger className="w-[200px]">
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
              onClick={() => requestsQuery.refetch()}
              disabled={requestsQuery.isFetching}
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Requests</CardTitle>
            <CardDescription>
              {requests.length} request{requests.length === 1 ? "" : "s"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Info</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Truck</TableHead>
                    <TableHead>Requested by</TableHead>
                    <TableHead>Requested at</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requestsQuery.isLoading ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="text-center text-muted-foreground"
                      >
                        Loading…
                      </TableCell>
                    </TableRow>
                  ) : requests.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="text-center text-muted-foreground"
                      >
                        No transfer requests found
                      </TableCell>
                    </TableRow>
                  ) : (
                    requests.map((req) => (
                      <TableRow key={req.id}>
                        <TableCell className="font-medium">#{req.id}</TableCell>
                        <TableCell>
                          <div className="font-medium text-primary">
                            Qty {req.quantity || 1}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Stocks: {req.production_stock_count || 0}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>From: {req.source_branch_name || "—"}</div>
                          <div>To: {destinationLabel(req)}</div>
                          <div className="text-xs text-muted-foreground">
                            {req.destination_type === "branch"
                              ? "Destination branch"
                              : req.production_branch_name
                                ? `Branch: ${req.production_branch_name}`
                                : ""}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {truckLabel(req)}
                        </TableCell>
                        <TableCell>
                          <div>{req.requested_by_name || "—"}</div>
                          {req.notes ? (
                            <div className="text-xs italic text-muted-foreground">
                              &ldquo;{req.notes}&rdquo;
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDateTime(req.created_at)}
                        </TableCell>
                        <TableCell>
                          <div className="space-y-2">
                            <Badge variant={statusBadgeVariant(req.status)}>
                              {statusLabel(req.status)}
                            </Badge>
                            <Select
                              value={req.status || "submitted"}
                              onValueChange={(status) => {
                                if (status === req.status) return;
                                if (
                                  !confirm(
                                    `Mark request #${req.id} as ${status}?`
                                  )
                                )
                                  return;
                                updateMutation.mutate({ id: req.id, status });
                              }}
                            >
                              <SelectTrigger className="h-8 w-[150px] text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {TRANSFER_STATUSES.map((s) => (
                                  <SelectItem key={s} value={s}>
                                    {statusLabel(s)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AuthGuard>
  );
}
