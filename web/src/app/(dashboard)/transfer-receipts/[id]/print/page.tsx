"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Printer, X } from "lucide-react";
import { AuthGuard } from "@/components/layout/auth-guard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError, apiJson } from "@/lib/api";
import {
  formatDateTime,
  statusBadgeVariant,
  statusLabel,
  truckLabel,
  type TransferRequest,
} from "@/lib/transfer";

export default function TransferReceiptPrintPage() {
  const params = useParams<{ id: string }>();
  const receiptId = params.id;

  const detailQuery = useQuery({
    queryKey: ["transfer-receipt", receiptId],
    enabled: Boolean(receiptId),
    queryFn: () =>
      apiJson.get<{ success: boolean; receipt: TransferRequest }>(
        `/api/transfer/receipts/${receiptId}`
      ),
  });

  useEffect(() => {
    if (!detailQuery.data?.receipt) return;
    const timer = setTimeout(() => window.print(), 500);
    return () => clearTimeout(timer);
  }, [detailQuery.data?.receipt]);

  const receipt = detailQuery.data?.receipt;
  const items = receipt?.stock_items || [];
  const loadError =
    detailQuery.error instanceof ApiError
      ? detailQuery.error.message
      : detailQuery.isError
        ? "Receipt not found"
        : null;

  return (
    <AuthGuard permission="receive_transfer">
      <style>{`
        @media print {
          aside, nav, .no-print { display: none !important; }
          main { padding: 0 !important; max-width: none !important; }
          body { background: white !important; }
        }
      `}</style>

      <div className="mx-auto max-w-[980px] space-y-4">
        <div className="no-print flex items-center justify-between gap-3">
          <Button onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            Print / Save PDF
          </Button>
          <Button variant="outline" onClick={() => window.close()}>
            <X className="h-4 w-4" />
            Close
          </Button>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-sm print:border-0 print:shadow-none">
          {detailQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : loadError || !receipt ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {loadError || "Receipt not found"}
            </div>
          ) : (
            <>
              <div className="mb-5 flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
                <div>
                  <h1 className="font-display text-2xl text-slate-900">
                    Transfer Receipt #{receipt.id}
                  </h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Incoming transfer receipt generated from the scanner system.
                  </p>
                </div>
                <div className="text-sm text-muted-foreground text-right">
                  <div className="flex items-center justify-end gap-2">
                    <span>Status:</span>
                    <Badge variant={statusBadgeVariant(receipt.receipt_status)}>
                      {statusLabel(receipt.receipt_status || "pending")}
                    </Badge>
                  </div>
                  <div className="mt-1.5">
                    <strong>Created:</strong> {formatDateTime(receipt.created_at)}
                  </div>
                  <div className="mt-1">
                    <strong>Updated:</strong> {formatDateTime(receipt.updated_at)}
                  </div>
                </div>
              </div>

              <div className="mb-6 grid gap-3 sm:grid-cols-2">
                {[
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
                  ["Requested by", receipt.requested_by_name || "—"],
                  ["Truck", truckLabel(receipt)],
                  ["Quantity", String(receipt.quantity || 1)],
                  [
                    "Received by",
                    `${receipt.received_by_name || "—"}${
                      receipt.received_at
                        ? ` on ${formatDateTime(receipt.received_at)}`
                        : ""
                    }`,
                  ],
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
                <div className="rounded-lg border border-border bg-slate-50 px-3 py-2 sm:col-span-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Notes
                  </p>
                  <p className="mt-1 text-sm text-slate-900">
                    {receipt.notes || "—"}
                  </p>
                </div>
              </div>

              <h2 className="mb-3 text-base font-semibold text-slate-900">
                Transferred items
              </h2>
              <div className="overflow-hidden rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2.5">Stock ID</th>
                      <th className="px-3 py-2.5">Batch</th>
                      <th className="px-3 py-2.5">Expiry</th>
                      <th className="px-3 py-2.5">Flavour</th>
                      <th className="px-3 py-2.5">Rack</th>
                      <th className="px-3 py-2.5">Shelf</th>
                      <th className="px-3 py-2.5">Source branch</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.length === 0 ? (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-3 py-6 text-center text-muted-foreground"
                        >
                          No linked stock items
                        </td>
                      </tr>
                    ) : (
                      items.map((item) => (
                        <tr
                          key={`${item.stock_id}-${item.batch_no}`}
                          className="border-t border-border"
                        >
                          <td className="px-3 py-2.5">#{item.stock_id}</td>
                          <td className="px-3 py-2.5">{item.batch_no || "—"}</td>
                          <td className="px-3 py-2.5">
                            {item.expiry_date || "—"}
                          </td>
                          <td className="px-3 py-2.5">{item.flavour || "—"}</td>
                          <td className="px-3 py-2.5">{item.rack_no || "—"}</td>
                          <td className="px-3 py-2.5">{item.shelf_no || "—"}</td>
                          <td className="px-3 py-2.5">
                            {item.branch_name || "—"}
                            {item.branch_code ? ` (${item.branch_code})` : ""}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </AuthGuard>
  );
}
