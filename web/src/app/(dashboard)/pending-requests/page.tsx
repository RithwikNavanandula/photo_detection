"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Clock3, RefreshCw } from "lucide-react";
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

export default function PendingRequestsPage() {
  const queryClient = useQueryClient();

  const requestsQuery = useQuery({
    queryKey: ["transfer-requests", "pending"],
    queryFn: () =>
      apiJson.get<{ success: boolean; requests: TransferRequest[] }>(
        "/api/transfer/requests?status=pending"
      ),
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

  const rows = (requestsQuery.data?.requests || []).filter((req) =>
    ["submitted", "pending"].includes((req.status || "").toLowerCase())
  );

  return (
    <AuthGuard permission="manage_transfers">
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl text-slate-900">
              Pending Requests
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Open transfer permissions waiting for OUT scans to finish.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="warning" className="gap-1.5 px-3 py-1">
              <Clock3 className="h-3.5 w-3.5" />
              Open {rows.length}
            </Badge>
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
            <CardTitle>Open queue</CardTitle>
            <CardDescription>
              Submitted transfers auto-complete when all mapped stock is OUT-scanned.
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
                  ) : rows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="text-center text-muted-foreground"
                      >
                        No pending requests found
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((req) => (
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
                          {req.truck_note ? (
                            <div className="text-xs italic text-muted-foreground">
                              {req.truck_note}
                            </div>
                          ) : null}
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
