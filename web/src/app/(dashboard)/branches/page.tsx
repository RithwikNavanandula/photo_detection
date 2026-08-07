"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { AuthGuard } from "@/components/layout/auth-guard";
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
import { apiJson } from "@/lib/api";

type Branch = {
  id: number;
  name: string;
  code: string;
  user_count?: number;
  scan_count?: number;
  production_house_count?: number;
};

type ProductionHouse = {
  id: number;
  name: string;
  branch_id: number;
  branch_name?: string | null;
  branch_code?: string | null;
  transfer_count?: number;
  production_stock_count?: number;
};

export default function BranchesPage() {
  const queryClient = useQueryClient();
  const [branchName, setBranchName] = useState("");
  const [branchCode, setBranchCode] = useState("");
  const [houseName, setHouseName] = useState("");
  const [houseBranchId, setHouseBranchId] = useState("");

  const branchesQuery = useQuery({
    queryKey: ["admin-branches"],
    queryFn: () =>
      apiJson.get<{ branches: Branch[] }>("/api/admin/branches"),
  });

  const housesQuery = useQuery({
    queryKey: ["admin-production-houses"],
    queryFn: () =>
      apiJson.get<{ production_houses: ProductionHouse[] }>(
        "/api/admin/production-houses"
      ),
  });

  const createBranch = useMutation({
    mutationFn: () =>
      apiJson.post<{ success: boolean; id?: number; error?: string }>(
        "/api/admin/branches",
        { name: branchName.trim(), code: branchCode.trim().toUpperCase() }
      ),
    onSuccess: (res) => {
      if (!res.success) {
        toast.error(res.error || "Could not create branch");
        return;
      }
      toast.success("Branch created");
      setBranchName("");
      setBranchCode("");
      queryClient.invalidateQueries({ queryKey: ["admin-branches"] });
      queryClient.invalidateQueries({ queryKey: ["admin-production-houses"] });
      queryClient.invalidateQueries({ queryKey: ["branches"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteBranch = useMutation({
    mutationFn: (id: number) =>
      apiJson.delete<{ success: boolean; error?: string }>(
        `/api/admin/branches/${id}`
      ),
    onSuccess: (res) => {
      if (!res.success) {
        toast.error(res.error || "Could not delete branch");
        return;
      }
      toast.success("Branch deleted");
      queryClient.invalidateQueries({ queryKey: ["admin-branches"] });
      queryClient.invalidateQueries({ queryKey: ["branches"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createHouse = useMutation({
    mutationFn: () =>
      apiJson.post<{ success: boolean; id?: number; error?: string }>(
        "/api/admin/production-houses",
        { name: houseName.trim(), branch_id: Number(houseBranchId) }
      ),
    onSuccess: (res) => {
      if (!res.success) {
        toast.error(res.error || "Could not create production house");
        return;
      }
      toast.success("Production house created");
      setHouseName("");
      queryClient.invalidateQueries({ queryKey: ["admin-production-houses"] });
      queryClient.invalidateQueries({ queryKey: ["admin-branches"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteHouse = useMutation({
    mutationFn: (id: number) =>
      apiJson.delete<{ success: boolean; error?: string }>(
        `/api/admin/production-houses/${id}`
      ),
    onSuccess: (res) => {
      if (!res.success) {
        toast.error(res.error || "Could not delete production house");
        return;
      }
      toast.success("Production house deleted");
      queryClient.invalidateQueries({ queryKey: ["admin-production-houses"] });
      queryClient.invalidateQueries({ queryKey: ["admin-branches"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const branches = branchesQuery.data?.branches ?? [];
  const houses = housesQuery.data?.production_houses ?? [];

  return (
    <AuthGuard superadminOnly>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl text-foreground">Branches</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage branches and production houses
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              branchesQuery.refetch();
              housesQuery.refetch();
            }}
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Add branch</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="branch-name">Name</Label>
                <Input
                  id="branch-name"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  placeholder="Dar es Salaam"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="branch-code">Code</Label>
                <Input
                  id="branch-code"
                  value={branchCode}
                  onChange={(e) => setBranchCode(e.target.value)}
                  placeholder="DSM"
                />
              </div>
              <Button
                onClick={() => {
                  if (!branchName.trim() || !branchCode.trim()) {
                    toast.error("Name and code required");
                    return;
                  }
                  createBranch.mutate();
                }}
                disabled={createBranch.isPending}
              >
                <Plus className="h-4 w-4" />
                Create branch
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Add production house</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="house-name">Name</Label>
                <Input
                  id="house-name"
                  value={houseName}
                  onChange={(e) => setHouseName(e.target.value)}
                  placeholder="Production Room A"
                />
              </div>
              <div className="space-y-2">
                <Label>Branch</Label>
                <Select value={houseBranchId} onValueChange={setHouseBranchId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select branch" />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={String(b.id)}>
                        {b.name} ({b.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={() => {
                  if (!houseName.trim() || !houseBranchId) {
                    toast.error("Name and branch required");
                    return;
                  }
                  createHouse.mutate();
                }}
                disabled={createHouse.isPending}
              >
                <Plus className="h-4 w-4" />
                Create production house
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Branches</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Users</TableHead>
                  <TableHead>Scans</TableHead>
                  <TableHead>Houses</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {branches.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground">
                      No branches
                    </TableCell>
                  </TableRow>
                ) : (
                  branches.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell>{b.name}</TableCell>
                      <TableCell>{b.code}</TableCell>
                      <TableCell>{b.user_count ?? 0}</TableCell>
                      <TableCell>{b.scan_count ?? 0}</TableCell>
                      <TableCell>{b.production_house_count ?? 0}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => {
                            if (
                              !window.confirm(
                                `Delete branch ${b.name}? This fails if linked records exist.`
                              )
                            ) {
                              return;
                            }
                            deleteBranch.mutate(b.id);
                          }}
                          disabled={deleteBranch.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Production houses</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Transfers</TableHead>
                  <TableHead>Stock rows</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {houses.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground">
                      No production houses
                    </TableCell>
                  </TableRow>
                ) : (
                  houses.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell>{h.name}</TableCell>
                      <TableCell>
                        {h.branch_name || "—"}
                        {h.branch_code ? ` (${h.branch_code})` : ""}
                      </TableCell>
                      <TableCell>{h.transfer_count ?? 0}</TableCell>
                      <TableCell>{h.production_stock_count ?? 0}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => {
                            if (
                              !window.confirm(
                                `Delete production house ${h.name}?`
                              )
                            ) {
                              return;
                            }
                            deleteHouse.mutate(h.id);
                          }}
                          disabled={deleteHouse.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete
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
