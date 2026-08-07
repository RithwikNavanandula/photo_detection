"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Package, Plus, Send } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { ApiError, apiJson } from "@/lib/api";
import type { Branch, ProductionRoom, StockBatch, Truck } from "@/lib/transfer";

type DestinationType = "production_room" | "branch";

export default function TransferPage() {
  const { user, isSuperadmin } = useAuth();
  const queryClient = useQueryClient();

  const [flavor, setFlavor] = useState("");
  const [sourceBranchId, setSourceBranchId] = useState<string>("");
  const [quantity, setQuantity] = useState(1);
  const [truckId, setTruckId] = useState<string>("");
  const [destinationType, setDestinationType] =
    useState<DestinationType>("production_room");
  const [productionRoomId, setProductionRoomId] = useState("");
  const [destinationBranchId, setDestinationBranchId] = useState("");
  const [notes, setNotes] = useState("");
  const [showTruckForm, setShowTruckForm] = useState(false);
  const [newTruckNo, setNewTruckNo] = useState("");
  const [newTruckNote, setNewTruckNote] = useState("");

  const branchLocked = Boolean(user?.branch_id) && !isSuperadmin;

  useEffect(() => {
    if (user?.branch_id) {
      setSourceBranchId(String(user.branch_id));
    }
  }, [user?.branch_id]);

  const branchesQuery = useQuery({
    queryKey: ["branches"],
    queryFn: () => apiJson.get<{ branches: Branch[] }>("/api/branches"),
  });

  const trucksQuery = useQuery({
    queryKey: ["trucks"],
    queryFn: () =>
      apiJson.get<{ success: boolean; trucks: Truck[] }>("/api/trucks"),
  });

  const flavorsQuery = useQuery({
    queryKey: ["transfer-flavors", sourceBranchId],
    enabled: Boolean(sourceBranchId),
    queryFn: () => {
      const params = new URLSearchParams();
      if (sourceBranchId) params.set("branch_id", sourceBranchId);
      return apiJson.get<{ success: boolean; flavors: string[] }>(
        `/api/transfer/flavors?${params}`
      );
    },
  });

  const roomsQuery = useQuery({
    queryKey: ["production-rooms", sourceBranchId],
    enabled:
      destinationType === "production_room" && Boolean(sourceBranchId),
    queryFn: () =>
      apiJson.get<{ success: boolean; rooms: ProductionRoom[] }>(
        `/api/production-rooms?branch_id=${sourceBranchId}`
      ),
  });

  const batchesQuery = useQuery({
    queryKey: ["transfer-batches", flavor, sourceBranchId, quantity],
    enabled: Boolean(flavor && sourceBranchId && quantity >= 1),
    queryFn: () => {
      const params = new URLSearchParams({
        flavor,
        quantity: String(quantity),
        branch_id: sourceBranchId,
      });
      return apiJson.get<{
        success: boolean;
        items: StockBatch[];
        requested_quantity?: number;
        selected_count?: number;
        message?: string;
      }>(`/api/transfer/batches?${params}`);
    },
  });

  const stocks = batchesQuery.data?.items || [];
  const stockShortage = stocks.length > 0 && stocks.length < quantity;

  const destinationBranches = useMemo(() => {
    const list = branchesQuery.data?.branches || [];
    return list.filter((b) => String(b.id) !== sourceBranchId);
  }, [branchesQuery.data?.branches, sourceBranchId]);

  const addTruckMutation = useMutation({
    mutationFn: (body: { truck_no: string; note: string }) =>
      apiJson.post<{ success: boolean; truck: Truck; error?: string }>(
        "/api/trucks",
        body
      ),
    onSuccess: (data) => {
      toast.success(`Truck ${data.truck.truck_no} added`);
      setTruckId(String(data.truck.id));
      setShowTruckForm(false);
      setNewTruckNo("");
      setNewTruckNote("");
      queryClient.invalidateQueries({ queryKey: ["trucks"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Failed to add truck");
    },
  });

  const submitMutation = useMutation({
    mutationFn: () =>
      apiJson.post<{ success: boolean; message?: string; error?: string }>(
        "/api/transfer/request",
        {
          quantity,
          stock_ids: stocks.map((s) => s.stock_id),
          source_branch_id: Number(sourceBranchId),
          destination_type: destinationType,
          production_room_id:
            destinationType === "production_room"
              ? Number(productionRoomId)
              : null,
          destination_branch_id:
            destinationType === "branch"
              ? Number(destinationBranchId)
              : null,
          truck_id: truckId ? Number(truckId) : null,
          notes,
        }
      ),
    onSuccess: (data) => {
      toast.success(data.message || "Transfer request submitted");
      setFlavor("");
      setQuantity(1);
      setNotes("");
      setTruckId("");
      setProductionRoomId("");
      setDestinationBranchId("");
      queryClient.invalidateQueries({ queryKey: ["transfer-batches"] });
      queryClient.invalidateQueries({ queryKey: ["transfer-flavors"] });
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to submit transfer"
      );
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!sourceBranchId) {
      toast.error("Select a source branch first");
      return;
    }
    if (!flavor) {
      toast.error("Select a flavor");
      return;
    }
    if (!stocks.length || stockShortage) {
      toast.error("Not enough stock for the requested quantity");
      return;
    }
    if (destinationType === "production_room" && !productionRoomId) {
      toast.error("Select a production room");
      return;
    }
    if (destinationType === "branch" && !destinationBranchId) {
      toast.error("Select a destination branch");
      return;
    }
    submitMutation.mutate();
  }

  return (
    <AuthGuard permission="create_transfer">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="font-display text-2xl text-slate-900">
            Request Stock Transfer
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Select nearest-expiry batches and send them to a production room or
            another branch.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Transfer details</CardTitle>
            <CardDescription>
              Quantity must match the number of selected stock items.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label>Source branch</Label>
                <Select
                  value={sourceBranchId || undefined}
                  onValueChange={(v) => {
                    setSourceBranchId(v);
                    setFlavor("");
                    setProductionRoomId("");
                    setDestinationBranchId("");
                  }}
                  disabled={branchLocked}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select source branch" />
                  </SelectTrigger>
                  <SelectContent>
                    {(branchesQuery.data?.branches || []).map((b) => (
                      <SelectItem key={b.id} value={String(b.id)}>
                        {b.id} — {b.name} ({b.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Required. Used to load stock and validate the request.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Flavor</Label>
                <Select
                  value={flavor || undefined}
                  onValueChange={setFlavor}
                  disabled={!sourceBranchId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select flavor" />
                  </SelectTrigger>
                  <SelectContent>
                    {(flavorsQuery.data?.flavors || []).map((f) => (
                      <SelectItem key={f} value={f}>
                        {f}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="quantity">Quantity</Label>
                <Input
                  id="quantity"
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(e) =>
                    setQuantity(Math.max(1, Number(e.target.value) || 1))
                  }
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Label>Truck (optional)</Label>
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0 text-primary"
                    onClick={() => setShowTruckForm((v) => !v)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add truck
                  </Button>
                </div>
                <Select
                  value={truckId || "__none__"}
                  onValueChange={(v) =>
                    setTruckId(v === "__none__" ? "" : v)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="No truck selected" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No truck selected</SelectItem>
                    {(trucksQuery.data?.trucks || []).map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {t.id} — {t.truck_no}
                        {t.note ? ` (${t.note})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {showTruckForm && (
                  <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="truck_no">Truck no</Label>
                      <Input
                        id="truck_no"
                        value={newTruckNo}
                        onChange={(e) => setNewTruckNo(e.target.value)}
                        placeholder="e.g. T-1024"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="truck_note">Note (optional)</Label>
                      <Input
                        id="truck_note"
                        value={newTruckNote}
                        onChange={(e) => setNewTruckNote(e.target.value)}
                        placeholder="Driver, company, color…"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={addTruckMutation.isPending}
                        onClick={() => {
                          if (!newTruckNo.trim()) {
                            toast.error("Truck number is required");
                            return;
                          }
                          addTruckMutation.mutate({
                            truck_no: newTruckNo.trim(),
                            note: newTruckNote.trim(),
                          });
                        }}
                      >
                        Save truck
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setShowTruckForm(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-3 rounded-lg border border-border bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      Destination mode
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Production room stays on the same branch; branch sends to
                      another location.
                    </p>
                  </div>
                  <div className="flex rounded-lg border border-border bg-card p-0.5">
                    <button
                      type="button"
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                        destinationType === "production_room"
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      onClick={() => {
                        setDestinationType("production_room");
                        setDestinationBranchId("");
                      }}
                    >
                      Production room
                    </button>
                    <button
                      type="button"
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                        destinationType === "branch"
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      onClick={() => {
                        setDestinationType("branch");
                        setProductionRoomId("");
                      }}
                    >
                      Branch
                    </button>
                  </div>
                </div>

                {destinationType === "production_room" ? (
                  <div className="space-y-2">
                    <Label>Production room</Label>
                    <Select
                      value={productionRoomId || undefined}
                      onValueChange={setProductionRoomId}
                      disabled={!sourceBranchId}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select production room" />
                      </SelectTrigger>
                      <SelectContent>
                        {(roomsQuery.data?.rooms || []).map((r) => (
                          <SelectItem key={r.id} value={String(r.id)}>
                            Branch #{r.branch_id} — {r.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label>Destination branch</Label>
                    <Select
                      value={destinationBranchId || undefined}
                      onValueChange={setDestinationBranchId}
                      disabled={!sourceBranchId}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select destination branch" />
                      </SelectTrigger>
                      <SelectContent>
                        {destinationBranches.map((b) => (
                          <SelectItem key={b.id} value={String(b.id)}>
                            {b.id} — {b.name} ({b.code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {flavor && sourceBranchId && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold text-slate-900">
                      Nearest stocks selected
                    </h3>
                  </div>
                  {batchesQuery.isLoading ? (
                    <p className="text-sm text-muted-foreground">
                      Loading stock…
                    </p>
                  ) : stocks.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
                      No stock available for this flavor.
                    </p>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Showing {stocks.length} nearest stock item(s) for
                        quantity {quantity}.
                      </p>
                      {stockShortage && (
                        <p className="text-sm text-amber-700">
                          Only {stocks.length} stock item(s) available for
                          quantity {quantity}.
                        </p>
                      )}
                      <div className="grid gap-2">
                        {stocks.map((item, idx) => (
                          <div
                            key={item.stock_id}
                            className="rounded-lg border border-border bg-card px-4 py-3"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="font-medium text-primary">
                                #{idx + 1} {item.batch_no || "—"}
                              </p>
                              <Badge variant="outline">
                                #{item.stock_id}
                              </Badge>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Exp: {item.expiry_date || "—"} · Rack:{" "}
                              {item.rack_no || "—"} · Shelf:{" "}
                              {item.shelf_no || "—"}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              Branch: {item.branch_name || "Unknown"}
                            </p>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="notes">Notes (optional)</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Reason for transfer, priority, etc."
                />
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={
                  submitMutation.isPending ||
                  !stocks.length ||
                  stockShortage
                }
              >
                <Send className="h-4 w-4" />
                {submitMutation.isPending
                  ? "Submitting…"
                  : "Submit transfer request"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </AuthGuard>
  );
}
