"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AuthGuard } from "@/components/layout/auth-guard";
import { ScannerHeader } from "@/components/layout/scanner-header";
import { useAuth } from "@/hooks/use-auth";

export default function AppShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { loading, isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !isAuthenticated) router.replace("/");
  }, [loading, isAuthenticated, router]);

  return (
    <AuthGuard permission="view_scanner">
      <div className="min-h-dvh bg-[radial-gradient(circle_at_top_left,_#dbeafe_0%,_#f3f4f6_45%,_#eef2ff_100%)] px-3 py-4 sm:px-4 sm:py-6 md:px-8">
        <div className="mx-auto w-full max-w-5xl">
          <ScannerHeader
            title="Label Scanner"
            subtitle="Capture batch, MFG, and expiry in one scan"
          />
          {children}
        </div>
      </div>
    </AuthGuard>
  );
}
