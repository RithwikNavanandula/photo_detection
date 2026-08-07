"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiJson } from "@/lib/api";
import { authCheckSchema, type AuthUser } from "@/lib/schemas";

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  isAuthenticated: boolean;
  isSuperadmin: boolean;
  permissions: Set<string>;
  can: (code: string) => boolean;
  refresh: () => Promise<void>;
  setUserLocal: (user: AuthUser | null) => void;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function readStoredUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("user");
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [localUser, setLocalUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    setLocalUser(readStoredUser());
  }, []);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["auth"],
    queryFn: async () => {
      const res = await apiJson.get("/api/check-auth", authCheckSchema);
      if (!res.authenticated) {
        localStorage.removeItem("user");
        setLocalUser(null);
        return null;
      }
      const stored = readStoredUser();
      const merged: AuthUser = {
        id: res.user_id!,
        username: res.username || stored?.username || "",
        name: stored?.name || res.username || "",
        role: res.role || stored?.role || "user",
        branch_id: res.branch_id ?? stored?.branch_id ?? null,
        branch_name: stored?.branch_name,
        branch_code: stored?.branch_code,
        permissions: res.permissions || [],
      };
      localStorage.setItem("user", JSON.stringify(merged));
      setLocalUser(merged);
      return merged;
    },
    staleTime: 30_000,
    retry: false,
  });

  const user = data ?? localUser;

  const value = useMemo<AuthContextValue>(() => {
    const permissions = new Set(user?.permissions || []);
    const isSuperadmin = user?.role === "superadmin";
    return {
      user,
      loading: isLoading && !user,
      isAuthenticated: Boolean(user),
      isSuperadmin,
      permissions,
      can: (code: string) => isSuperadmin || permissions.has(code),
      refresh: async () => {
        await refetch();
      },
      setUserLocal: (next) => {
        setLocalUser(next);
        if (next) localStorage.setItem("user", JSON.stringify(next));
        else localStorage.removeItem("user");
        queryClient.setQueryData(["auth"], next);
      },
      logout: async () => {
        try {
          await apiJson.post("/api/logout");
        } catch {
          /* ignore */
        }
        localStorage.removeItem("user");
        setLocalUser(null);
        queryClient.setQueryData(["auth"], null);
        window.location.href = "/";
      },
    };
  }, [user, isLoading, refetch, queryClient]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
