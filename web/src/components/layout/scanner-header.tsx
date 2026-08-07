"use client";

import Link from "next/link";
import { Camera, Images, LogOut, LayoutDashboard } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";

export function ScannerHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const { user, logout, can, isSuperadmin } = useAuth();

  return (
    <header className="mb-4 flex flex-col gap-4 sm:mb-6 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          SBC Tanzania
        </p>
        <h1 className="font-display text-2xl text-foreground sm:text-3xl">{title}</h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="max-w-[140px] truncate rounded-full bg-card px-3 py-1.5 text-sm shadow-sm sm:max-w-none">
          {user?.name}
        </span>
        <Button asChild variant="outline" size="sm">
          <Link href="/app">
            <Camera className="h-4 w-4" />
            <span className="hidden sm:inline">Scanner</span>
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/scanned">
            <Images className="h-4 w-4" />
            <span className="hidden sm:inline">My Scans</span>
          </Link>
        </Button>
        {(isSuperadmin || can("view_admin_dashboard")) && (
          <Button asChild variant="outline" size="sm">
            <Link href="/admin">
              <LayoutDashboard className="h-4 w-4" />
              <span className="hidden sm:inline">Dashboard</span>
            </Link>
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => logout()}>
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">Logout</span>
        </Button>
      </div>
    </header>
  );
}
