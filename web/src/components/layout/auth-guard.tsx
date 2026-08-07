"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";

export function AuthGuard({
  children,
  permission,
  superadminOnly,
}: {
  children: React.ReactNode;
  permission?: string;
  superadminOnly?: boolean;
}) {
  const { loading, isAuthenticated, can, isSuperadmin } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) {
      router.replace("/");
      return;
    }
    if (superadminOnly && !isSuperadmin) {
      router.replace("/app");
      return;
    }
    if (permission && !can(permission) && !isSuperadmin) {
      router.replace("/app");
    }
  }, [loading, isAuthenticated, permission, superadminOnly, can, isSuperadmin, router]);

  if (loading || !isAuthenticated) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
        Checking session…
      </div>
    );
  }

  if (superadminOnly && !isSuperadmin) return null;
  if (permission && !can(permission) && !isSuperadmin) return null;

  return <>{children}</>;
}
