"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  LineChart,
  Table2,
  Truck,
  ClipboardList,
  Clock3,
  Users,
  Building2,
  Camera,
  LogOut,
  Shield,
  FileText,
  PanelLeftClose,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import Image from "next/image";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: string;
  superadminOnly?: boolean;
};

const NAV: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, permission: "view_admin_dashboard" },
  { href: "/pivot", label: "Ledger Entries", icon: Table2, permission: "view_pivot" },
  { href: "/analytics", label: "Analytics", icon: LineChart, permission: "view_analytics" },
  { href: "/transfer", label: "Transfer Request", icon: Truck, permission: "create_transfer" },
  { href: "/trucks", label: "Trucks", icon: Truck, permission: "create_transfer" },
  { href: "/transfer-reports", label: "Transfer Reports", icon: ClipboardList, permission: "manage_transfers" },
  { href: "/pending-requests", label: "Pending Requests", icon: Clock3, permission: "manage_transfers" },
  { href: "/transfer-receipts", label: "Receipts", icon: FileText, permission: "receive_transfer" },
  { href: "/users", label: "Users", icon: Users, superadminOnly: true },
  { href: "/authorizations", label: "Authorizations", icon: Shield, superadminOnly: true },
  { href: "/branches", label: "Branches", icon: Building2, superadminOnly: true },
];

type AppSidebarProps = {
  open: boolean;
  isDesktop: boolean;
  onClose: () => void;
  onToggle: () => void;
};

export function AppSidebar({ open, isDesktop, onClose, onToggle }: AppSidebarProps) {
  const pathname = usePathname();
  const { can, isSuperadmin, logout, user } = useAuth();

  const collapsed = isDesktop && !open;
  const drawerOpen = !isDesktop && open;

  const visible = NAV.filter((item) => {
    if (item.superadminOnly) return isSuperadmin;
    if (!item.permission) return true;
    return can(item.permission) || isSuperadmin;
  });

  function NavLink({
    href,
    label,
    icon: Icon,
  }: {
    href: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }) {
    const active = pathname === href || pathname.startsWith(href + "/");
    return (
      <Link
        href={href}
        onClick={() => {
          if (!isDesktop) onClose();
        }}
        title={label}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
          active
            ? "bg-sidebar-accent text-white"
            : "text-slate-300 hover:bg-sidebar-accent/70 hover:text-white",
          collapsed && "justify-center px-2"
        )}
      >
        <Icon className="h-4 w-4 shrink-0" />
        {!collapsed && <span>{label}</span>}
      </Link>
    );
  }

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-slate-900/50 transition-opacity lg:hidden",
          drawerOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={onClose}
        aria-hidden={!drawerOpen}
      />

      <aside
        className={cn(
          "z-50 flex h-dvh shrink-0 flex-col bg-sidebar text-sidebar-foreground transition-[width,transform] duration-200 ease-out",
          // Mobile drawer
          "fixed inset-y-0 left-0 lg:static",
          drawerOpen || isDesktop ? "translate-x-0" : "-translate-x-full",
          collapsed ? "w-[72px]" : "w-[min(260px,85vw)] lg:w-[260px]"
        )}
      >
        <div
          className={cn(
            "flex items-center gap-3 border-b border-sidebar-border px-4 py-4",
            collapsed && "justify-center px-2"
          )}
        >
          <Image
            src="/sbc_logo.png"
            alt="SBC"
            width={36}
            height={36}
            className="shrink-0 rounded-md bg-white p-0.5"
          />
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="font-display text-lg leading-none text-white">SBC Scanner</p>
              <p className="mt-1 truncate text-xs text-slate-400">
                {user?.name || "Admin"}
              </p>
            </div>
          )}
          {!isDesktop && (
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 text-slate-300 hover:bg-sidebar-accent hover:text-white"
              onClick={onClose}
              aria-label="Close sidebar"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
          {isDesktop && !collapsed && (
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 text-slate-300 hover:bg-sidebar-accent hover:text-white"
              onClick={onToggle}
              aria-label="Collapse sidebar"
            >
              <PanelLeftClose className="h-4 w-4" />
            </Button>
          )}
        </div>

        {!collapsed && (
          <div className="px-4 pt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Navigation
          </div>
        )}
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-3">
          {visible.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
            />
          ))}

          {(can("view_scanner") || isSuperadmin) && (
            <>
              <div className="my-3 h-px bg-sidebar-border" />
              {!collapsed && (
                <div className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Actions
                </div>
              )}
              <NavLink href="/app" label="Scanner" icon={Camera} />
              <NavLink href="/scanned" label="My Scans" icon={FileText} />
            </>
          )}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <Button
            variant="ghost"
            className={cn(
              "w-full text-slate-300 hover:bg-red-500/15 hover:text-red-300",
              collapsed ? "justify-center px-0" : "justify-start"
            )}
            onClick={() => logout()}
            title="Logout"
          >
            <LogOut className="h-4 w-4" />
            {!collapsed && <span>Logout</span>}
          </Button>
        </div>
      </aside>
    </>
  );
}
