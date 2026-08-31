import type { CompanyRole } from "@prisma/client";
import { can, isFieldRole } from "@/lib/permissions";

export type WorkspaceId = "command" | "dispatch" | "office" | "field";

export const WORKSPACES: {
  id: WorkspaceId;
  href: string;
  label: string;
  blurb: string;
}[] = [
  { id: "command", href: "/dashboard", label: "Command Center", blurb: "The whole business" },
  { id: "dispatch", href: "/dispatch", label: "Dispatch Center", blurb: "Today's board" },
  { id: "office", href: "/office", label: "Customer Hub", blurb: "Find and help customers" },
  { id: "field", href: "/tech", label: "Field", blurb: "Your next job" },
];

export function canAccessWorkspace(role: CompanyRole, workspace: WorkspaceId): boolean {
  if (workspace === "field") return isFieldRole(role);
  if (isFieldRole(role)) return false;
  if (workspace === "command") {
    return can(role, "reports:financial") || can(role, "company:manage") || role === "MANAGER" || role === "ADMIN";
  }
  if (workspace === "dispatch") {
    return can(role, "schedule:manage") || (can(role, "schedule:view") && can(role, "jobs:manage"));
  }
  if (workspace === "office") {
    return can(role, "customers:manage") || (can(role, "customers:view") && !isFieldRole(role));
  }
  return false;
}

export function accessibleWorkspaces(role: CompanyRole): WorkspaceId[] {
  return (["command", "dispatch", "office", "field"] as WorkspaceId[]).filter((id) =>
    canAccessWorkspace(role, id)
  );
}

export function landingPath(role: CompanyRole): string {
  if (isFieldRole(role)) return "/tech";
  if (canAccessWorkspace(role, "command") && (role === "COMPANY_OWNER" || role === "ADMIN" || role === "MANAGER")) {
    return "/dashboard";
  }
  if (role === "DISPATCHER" && canAccessWorkspace(role, "dispatch")) return "/dispatch";
  if (canAccessWorkspace(role, "office")) return "/office";
  if (canAccessWorkspace(role, "dispatch")) return "/dispatch";
  if (canAccessWorkspace(role, "command")) return "/dashboard";
  return "/dashboard";
}

export function assertWorkspaceAccess(role: CompanyRole, workspace: WorkspaceId): string | null {
  return canAccessWorkspace(role, workspace) ? null : landingPath(role);
}

export function workspaceFromPath(pathname: string): WorkspaceId | null {
  if (pathname.startsWith("/tech")) return "field";
  if (pathname.startsWith("/dispatch")) return "dispatch";
  if (pathname.startsWith("/office")) return "office";
  if (pathname.startsWith("/dashboard") || pathname.startsWith("/intelligence") || pathname.startsWith("/reports")) {
    return "command";
  }
  return null;
}
