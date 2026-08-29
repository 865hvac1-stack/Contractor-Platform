import { CompanyRole } from "@prisma/client";

/**
 * Centralized permission catalog.
 * Components and pages must call requirePermission / can() — never scatter ad-hoc checks.
 */
export type Permission =
  | "company:manage"
  | "company:settings"
  | "team:manage"
  | "team:view"
  | "customers:manage"
  | "customers:view"
  | "jobs:manage"
  | "jobs:view"
  | "jobs:assigned_only"
  | "schedule:manage"
  | "schedule:view"
  | "estimates:manage"
  | "estimates:view"
  | "invoices:manage"
  | "invoices:view"
  | "invoices:financial"
  | "expenses:manage"
  | "expenses:view"
  | "reports:view"
  | "reports:financial"
  | "dashboard:view"
  | "equipment:manage"
  | "equipment:view";

const ALL_COMPANY: Permission[] = [
  "company:manage",
  "company:settings",
  "team:manage",
  "team:view",
  "customers:manage",
  "customers:view",
  "jobs:manage",
  "jobs:view",
  "schedule:manage",
  "schedule:view",
  "estimates:manage",
  "estimates:view",
  "invoices:manage",
  "invoices:view",
  "invoices:financial",
  "expenses:manage",
  "expenses:view",
  "reports:view",
  "reports:financial",
  "dashboard:view",
  "equipment:manage",
  "equipment:view",
];

export const ROLE_PERMISSIONS: Record<CompanyRole, Permission[]> = {
  COMPANY_OWNER: ALL_COMPANY,
  ADMIN: ALL_COMPANY.filter((p) => p !== "company:manage"),
  OFFICE: [
    "customers:manage",
    "customers:view",
    "jobs:manage",
    "jobs:view",
    "schedule:manage",
    "schedule:view",
    "estimates:manage",
    "estimates:view",
    "invoices:manage",
    "invoices:view",
    "expenses:manage",
    "expenses:view",
    "reports:view",
    "dashboard:view",
    "equipment:manage",
    "equipment:view",
    "team:view",
    "company:settings",
  ],
  DISPATCHER: [
    "customers:view",
    "jobs:manage",
    "jobs:view",
    "schedule:manage",
    "schedule:view",
    "estimates:view",
    "dashboard:view",
    "team:view",
    "equipment:view",
  ],
  SALES: [
    "customers:manage",
    "customers:view",
    "estimates:manage",
    "estimates:view",
    "jobs:view",
    "dashboard:view",
    "equipment:view",
  ],
  TECHNICIAN: [
    "jobs:view",
    "jobs:assigned_only",
    "customers:view",
    "schedule:view",
    "estimates:view",
    "invoices:view",
    "expenses:manage",
    "expenses:view",
    "equipment:view",
    "equipment:manage",
    "dashboard:view",
  ],
  INSTALLER: [
    "jobs:view",
    "jobs:assigned_only",
    "customers:view",
    "schedule:view",
    "equipment:view",
    "equipment:manage",
    "dashboard:view",
  ],
  MANAGER: [
    "customers:view",
    "jobs:manage",
    "jobs:view",
    "schedule:view",
    "estimates:view",
    "invoices:view",
    "expenses:view",
    "reports:view",
    "reports:financial",
    "dashboard:view",
    "team:view",
    "equipment:view",
  ],
};

export function can(role: CompanyRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function canAny(role: CompanyRole, permissions: Permission[]): boolean {
  return permissions.some((p) => can(role, p));
}

export const ROLE_LABELS: Record<CompanyRole, string> = {
  COMPANY_OWNER: "Owner",
  ADMIN: "Admin",
  OFFICE: "Office",
  DISPATCHER: "Dispatcher",
  SALES: "Sales",
  TECHNICIAN: "Technician",
  INSTALLER: "Installer",
  MANAGER: "Manager",
};
