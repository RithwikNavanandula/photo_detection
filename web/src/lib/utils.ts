import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function postRedirectTarget(user: {
  role?: string;
  permissions?: string[];
}) {
  const perms = new Set(user.permissions || []);
  if (user.role === "superadmin" || perms.has("view_admin_dashboard")) {
    return "/admin";
  }
  if (perms.has("receive_transfer")) return "/receive-confirmations";
  if (perms.has("create_transfer")) return "/transfer";
  if (perms.has("manage_transfers")) return "/all-transfers";
  return "/app";
}
