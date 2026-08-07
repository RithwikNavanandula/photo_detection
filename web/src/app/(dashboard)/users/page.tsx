"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, KeyRound, Plus, RefreshCw, X } from "lucide-react";
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
import { apiJson } from "@/lib/api";

type UserRow = {
  id: number;
  username: string;
  name: string;
  role: string;
  active: number;
  branch_id: number | null;
  branch_name?: string | null;
};

type Branch = { id: number; name: string; code: string };

export default function UsersPage() {
  const queryClient = useQueryClient();
  const [passwordUserId, setPasswordUserId] = useState<number | null>(null);
  const [password, setPassword] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [create, setCreate] = useState({
    name: "",
    username: "",
    email: "",
    password: "",
    branch_id: "",
  });

  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: () => apiJson.get<{ users: UserRow[] }>("/api/users"),
  });

  const pendingQuery = useQuery({
    queryKey: ["pending-users"],
    queryFn: () =>
      apiJson.get<{ users: UserRow[] }>("/api/admin/users/pending"),
  });

  const branchesQuery = useQuery({
    queryKey: ["branches"],
    queryFn: () => apiJson.get<{ branches: Branch[] }>("/api/branches"),
    enabled: createOpen,
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) =>
      apiJson.post<{ success: boolean }>("/api/admin/users/approve", { id }),
    onSuccess: () => {
      toast.success("User approved");
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["pending-users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: number) =>
      apiJson.post<{ success: boolean }>("/api/admin/users/reject", { id }),
    onSuccess: () => {
      toast.success("User rejected");
      queryClient.invalidateQueries({ queryKey: ["pending-users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const passwordMutation = useMutation({
    mutationFn: ({ id, password }: { id: number; password: string }) =>
      apiJson.post<{ success: boolean }>("/api/admin/users/change-password", {
        id,
        password,
      }),
    onSuccess: () => {
      toast.success("Password updated");
      setPasswordUserId(null);
      setPassword("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        username: create.username.trim(),
        name: create.name.trim(),
        email: create.email.trim(),
        password: create.password,
        role: "user",
        branch_id: Number(create.branch_id),
      };
      const reg = await apiJson.post<{ success: boolean; error?: string }>(
        "/api/register",
        payload
      );
      if (!reg.success) throw new Error(reg.error || "Failed to create user");

      const pending = await apiJson.get<{ users: UserRow[] }>(
        "/api/admin/users/pending"
      );
      const newUser = (pending.users || []).find(
        (u) => u.username === payload.username
      );
      if (newUser) {
        await apiJson.post("/api/admin/users/approve", { id: newUser.id });
      }
    },
    onSuccess: () => {
      toast.success("User created and activated");
      setCreateOpen(false);
      setCreate({ name: "", username: "", email: "", password: "", branch_id: "" });
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["pending-users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pending = pendingQuery.data?.users ?? [];
  const users = usersQuery.data?.users ?? [];

  return (
    <AuthGuard superadminOnly>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl text-foreground">Users</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Approve registrations and manage accounts
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> Create user
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                usersQuery.refetch();
                pendingQuery.refetch();
              }}
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Pending approval ({pending.length})</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground">
                      No pending users
                    </TableCell>
                  </TableRow>
                ) : (
                  pending.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>{u.username}</TableCell>
                      <TableCell>{u.name}</TableCell>
                      <TableCell>{u.role}</TableCell>
                      <TableCell className="space-x-2 text-right">
                        <Button
                          size="sm"
                          onClick={() => approveMutation.mutate(u.id)}
                          disabled={approveMutation.isPending}
                        >
                          <Check className="h-4 w-4" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => rejectMutation.mutate(u.id)}
                          disabled={rejectMutation.isPending}
                        >
                          <X className="h-4 w-4" />
                          Reject
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
            <CardTitle>All users</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Password</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>{u.username}</TableCell>
                    <TableCell>{u.name}</TableCell>
                    <TableCell>{u.role}</TableCell>
                    <TableCell>{u.branch_name || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={u.active ? "success" : "warning"}>
                        {u.active ? "Active" : "Pending"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setPasswordUserId(u.id);
                          setPassword("");
                        }}
                      >
                        <KeyRound className="h-4 w-4" />
                        Change
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {passwordUserId != null && (
          <Card>
            <CardHeader>
              <CardTitle>Set new password</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-3">
              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min 4 characters"
                />
              </div>
              <Button
                onClick={() => {
                  if (password.length < 4) {
                    toast.error("Password must be at least 4 characters");
                    return;
                  }
                  passwordMutation.mutate({ id: passwordUserId, password });
                }}
                disabled={passwordMutation.isPending}
              >
                Save password
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setPasswordUserId(null);
                  setPassword("");
                }}
              >
                Cancel
              </Button>
            </CardContent>
          </Card>
        )}

        {createOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <Card className="w-full max-w-md">
              <CardHeader>
                <CardTitle>Create user</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(
                  [
                    ["name", "Full name", "text"],
                    ["username", "Username", "text"],
                    ["email", "Email", "email"],
                    ["password", "Password", "password"],
                  ] as const
                ).map(([key, label, type]) => (
                  <div key={key} className="space-y-1">
                    <Label>{label}</Label>
                    <Input
                      type={type}
                      value={create[key]}
                      onChange={(e) =>
                        setCreate({ ...create, [key]: e.target.value })
                      }
                    />
                  </div>
                ))}
                <div className="space-y-1">
                  <Label>Branch</Label>
                  <Select
                    value={create.branch_id}
                    onValueChange={(v) => setCreate({ ...create, branch_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select branch" />
                    </SelectTrigger>
                    <SelectContent>
                      {(branchesQuery.data?.branches ?? []).map((b) => (
                        <SelectItem key={b.id} value={String(b.id)}>
                          {b.name} ({b.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="ghost" onClick={() => setCreateOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    disabled={createMutation.isPending}
                    onClick={() => {
                      if (
                        !create.name ||
                        !create.username ||
                        !create.email ||
                        !create.password ||
                        !create.branch_id
                      ) {
                        toast.error("All fields are required");
                        return;
                      }
                      createMutation.mutate();
                    }}
                  >
                    {createMutation.isPending ? "Creating…" : "Create & activate"}
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
