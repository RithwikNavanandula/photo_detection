"use client";

import { useEffect, useState } from "react";
import { Menu, PanelLeftOpen } from "lucide-react";
import { AuthGuard } from "@/components/layout/auth-guard";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "sbc-sidebar-open";

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const apply = () => setIsDesktop(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  return isDesktop;
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isDesktop = useIsDesktop();
  const [desktopOpen, setDesktopOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored != null) setDesktopOpen(stored === "1");
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORAGE_KEY, desktopOpen ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [desktopOpen, ready]);

  useEffect(() => {
    if (isDesktop) setMobileOpen(false);
  }, [isDesktop]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const open = isDesktop ? desktopOpen : mobileOpen;

  function toggle() {
    if (isDesktop) setDesktopOpen((v) => !v);
    else setMobileOpen((v) => !v);
  }

  function closeMobile() {
    setMobileOpen(false);
  }

  return (
    <AuthGuard>
      <div className="flex min-h-dvh bg-background">
        <AppSidebar
          open={open}
          isDesktop={isDesktop}
          onClose={closeMobile}
          onToggle={toggle}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-card/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-card/80 sm:px-4">
            <Button
              variant="outline"
              size="icon"
              onClick={toggle}
              aria-label={open ? "Close sidebar" : "Open sidebar"}
              aria-expanded={open}
            >
              {isDesktop && !desktopOpen ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <Menu className="h-4 w-4" />
              )}
            </Button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">
                SBC Label Scanner
              </p>
              <p className="truncate text-xs text-muted-foreground sm:hidden">
                Tap menu to navigate
              </p>
            </div>
          </header>

          <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
            <div
              className={`mx-auto w-full max-w-[1400px] p-3 sm:p-6 md:p-8 ${
                ready ? "" : "opacity-0"
              }`}
            >
              {children}
            </div>
          </main>
        </div>
      </div>
    </AuthGuard>
  );
}
