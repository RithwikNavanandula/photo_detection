"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, Truck } from "lucide-react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/use-auth";
import { ApiError, apiJson } from "@/lib/api";
import { formatDateTime, type Truck as TruckType } from "@/lib/transfer";

function TrucksContent() {
  const { can, isSuperadmin } = useAuth();
  const queryClient = useQueryClient();
  const allowed =
    isSuperadmin || can("create_transfer") || can("manage_transfers");

  const [truckNo, setTruckNo] = useState("");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);

  const trucksQuery = useQuery({
    queryKey: ["trucks"],
    enabled: allowed,
    queryFn: () =>
      apiJson.get<{ success: boolean; trucks: TruckType[] }>("/api/trucks"),
  });

  const filtered = useMemo(() => {
    const trucks = trucksQuery.data?.trucks || [];
    const q = search.toLowerCase().trim();
    if (!q) return trucks;
    return trucks.filter((t) =>
      `${t.id} ${t.truck_no} ${t.note || ""}`.toLowerCase().includes(q)
    );
  }, [trucksQuery.data?.trucks, search]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = { truck_no: truckNo.trim(), note: note.trim() };
      if (editingId) {
        return apiJson.put<{
          success: boolean;
          truck: TruckType;
          error?: string;
        }>(`/api/trucks/${editingId}`, body);
      }
      return apiJson.post<{
        success: boolean;
        truck: TruckType;
        error?: string;
      }>("/api/trucks", body);
    },
    onSuccess: (data) => {
      toast.success(
        editingId
          ? `Truck ${data.truck.truck_no} updated`
          : `Truck ${data.truck.truck_no} added`
      );
      setTruckNo("");
      setNote("");
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: ["trucks"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Failed to save truck");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiJson.delete<{ success: boolean; error?: string }>(`/api/trucks/${id}`),
    onSuccess: () => {
      toast.success("Truck deleted");
      queryClient.invalidateQueries({ queryKey: ["trucks"] });
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to delete truck"
      );
    },
  });

  if (!allowed) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        You do not have permission to manage trucks.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-slate-900">Trucks</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Browse and manage truck numbers used in transfer requests.
          </p>
        </div>
        <Badge variant="secondary">{trucksQuery.data?.trucks?.length ?? 0} trucks</Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              {editingId ? "Edit truck" : "Add truck"}
            </CardTitle>
            <CardDescription>
              Truck numbers must be unique.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="truck_no">Truck no</Label>
              <Input
                id="truck_no"
                value={truckNo}
                onChange={(e) => setTruckNo(e.target.value)}
                placeholder="e.g. T-1024"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="note">Note (optional)</Label>
              <Input
                id="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Driver, company, color…"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={saveMutation.isPending}
                onClick={() => {
                  if (!truckNo.trim()) {
                    toast.error("Truck number is required");
                    return;
                  }
                  saveMutation.mutate();
                }}
              >
                {editingId ? "Update truck" : "Save truck"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setTruckNo("");
                  setNote("");
                  setEditingId(null);
                }}
              >
                Clear
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Truck className="h-4 w-4" />
              Truck list
            </CardTitle>
            <CardDescription>Search, edit, or remove entries.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search trucks…"
            />
            <div className="overflow-hidden rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Truck no</TableHead>
                    <TableHead>Note</TableHead>
                    <TableHead>Added</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trucksQuery.isLoading ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">
                        Loading…
                      </TableCell>
                    </TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">
                        No trucks found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell>#{t.id}</TableCell>
                        <TableCell className="font-medium text-primary">
                          {t.truck_no}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {t.note || "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDateTime(t.created_at)}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditingId(t.id);
                                setTruckNo(t.truck_no);
                                setNote(t.note || "");
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={deleteMutation.isPending}
                              onClick={() => {
                                if (
                                  !confirm(`Delete truck ${t.truck_no}?`)
                                )
                                  return;
                                deleteMutation.mutate(t.id);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Delete
                            </Button>
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
    </div>
  );
}

export default function TrucksPage() {
  return (
    <AuthGuard>
      <TrucksContent />
    </AuthGuard>
  );
}
