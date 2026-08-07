"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw, Save } from "lucide-react";
import { AuthGuard } from "@/components/layout/auth-guard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { apiJson } from "@/lib/api";

type Permission = {
  id: number;
  code: string;
  label: string;
  description?: string | null;
  permission_group: string;
};

type AuthUser = {
  id: number;
  username: string;
  name: string;
  role: string;
  active: number;
  branch_id: number | null;
  branch_name?: string | null;
  branch_code?: string | null;
  permissions: string[];
};

const MANDATORY = new Set(["view_scanner", "sync_scans"]);

export default function AuthorizationsPage() {
  const queryClient = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const authQuery = useQuery({
    queryKey: ["authorizations"],
    queryFn: () =>
      apiJson.get<{
        success: boolean;
        users: AuthUser[];
        permissions: Permission[];
      }>("/api/admin/authorizations"),
  });

  const permissionsQuery = useQuery({
    queryKey: ["permissions"],
    queryFn: () =>
      apiJson.get<{ success: boolean; permissions: Permission[] }>(
        "/api/admin/permissions"
      ),
  });

  const users = authQuery.data?.users ?? [];

  const editableUsers = users.filter((u) => u.role !== "superadmin");

  useEffect(() => {
    if (!selectedUserId && editableUsers.length) {
      setSelectedUserId(String(editableUsers[0].id));
    }
  }, [editableUsers, selectedUserId]);

  const currentUser = users.find((u) => String(u.id) === selectedUserId);

  useEffect(() => {
    if (!currentUser) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set([...currentUser.permissions, ...MANDATORY]));
  }, [currentUser]);

  const grouped = useMemo(() => {
    const permissions =
      authQuery.data?.permissions ?? permissionsQuery.data?.permissions ?? [];
    const map = new Map<string, Permission[]>();
    for (const p of permissions) {
      const key = p.permission_group || "general";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return [...map.entries()];
  }, [authQuery.data?.permissions, permissionsQuery.data?.permissions]);

  const saveMutation = useMutation({
    mutationFn: (payload: { userId: number; permissions: string[] }) =>
      apiJson.put<{ success: boolean; permissions: string[] }>(
        `/api/admin/users/${payload.userId}/permissions`,
        { permissions: payload.permissions }
      ),
    onSuccess: () => {
      toast.success("Permissions saved");
      queryClient.invalidateQueries({ queryKey: ["authorizations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function toggle(code: string) {
    if (MANDATORY.has(code)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  return (
    <AuthGuard superadminOnly>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl text-foreground">
              Authorizations
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Assign feature permissions per user
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              authQuery.refetch();
              permissionsQuery.refetch();
            }}
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>

        <Card>
          <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-2">
              <Label>User</Label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger className="w-[280px]">
                  <SelectValue placeholder="Select user" />
                </SelectTrigger>
                <SelectContent>
                  {editableUsers.map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>
                      {u.name || u.username}
                      {u.branch_name ? ` · ${u.branch_name}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {currentUser && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="secondary">{currentUser.role}</Badge>
                <Badge variant={currentUser.active ? "success" : "warning"}>
                  {currentUser.active ? "Active" : "Pending"}
                </Badge>
                {currentUser.branch_name ? (
                  <span className="text-muted-foreground">
                    {currentUser.branch_name}
                  </span>
                ) : null}
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-6">
            {!currentUser ? (
              <p className="text-sm text-muted-foreground">
                Select a non-superadmin user to edit permissions
              </p>
            ) : (
              grouped.map(([group, perms]) => (
                <div key={group}>
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.replace(/_/g, " ")}
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {perms.map((p) => {
                      const locked = MANDATORY.has(p.code);
                      const checked = selected.has(p.code);
                      return (
                        <label
                          key={p.code}
                          className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 bg-muted/20 p-3"
                        >
                          <Checkbox
                            checked={checked}
                            disabled={locked}
                            onCheckedChange={() => toggle(p.code)}
                          />
                          <span>
                            <span className="block text-sm font-medium">
                              {p.label}
                              {locked ? (
                                <Badge className="ml-2" variant="outline">
                                  Required
                                </Badge>
                              ) : null}
                            </span>
                            {p.description ? (
                              <span className="mt-0.5 block text-xs text-muted-foreground">
                                {p.description}
                              </span>
                            ) : (
                              <span className="mt-0.5 block text-xs text-muted-foreground">
                                {p.code}
                              </span>
                            )}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <Separator className="mt-5" />
                </div>
              ))
            )}

            {currentUser && (
              <Button
                onClick={() =>
                  saveMutation.mutate({
                    userId: currentUser.id,
                    permissions: [...selected],
                  })
                }
                disabled={saveMutation.isPending}
              >
                <Save className="h-4 w-4" />
                Save permissions
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </AuthGuard>
  );
}
