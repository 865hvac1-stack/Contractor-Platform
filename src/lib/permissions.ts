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
  | "jobs:field_status"
  | "schedule:manage"
  | "schedule:view"
  | "estimates:manage"
  | "estimates:view"
  | "invoices:manage"
  | "invoices:view"
  | "invoices:financial"
  | "invoices:field"
  | "estimates:discount"
  | "expenses:manage"
  | "expenses:view"
  | "reports:view"
  | "reports:financial"
  | "dashboard:view"
  | "equipment:manage"
  | "equipment:view"
  | "marketing:view"
  | "marketing:manage"
  | "leads:view"
  | "leads:manage"
  | "intelligence:view"
  | "intelligence:manage"
  | "playbooks:view"
  | "playbooks:manage"
  | "imports:manage"
  | "accounting:view"
  | "accounting:manage"
  | "receipts:view"
  | "receipts:manage"
  | "job_costs:view"
  | "job_costs:manage"
  | "pricebook:view"
  | "pricebook:manage"
  | "pricebook:cost"
  | "memberships:view"
  | "memberships:manage"
  | "compensation:view_own"
  | "compensation:view_all"
  | "compensation:manage"
  | "performance:view_own"
  | "performance:view_team"
  | "jobs:lock"
  | "routing:optimize"
  | "payments:manage"
  | "payments:refund"
  | "payments:view_payouts";

const ALL_COMPANY: Permission[] = [
  "company:manage",
  "company:settings",
  "team:manage",
  "team:view",
  "customers:manage",
  "customers:view",
  "jobs:manage",
  "jobs:view",
  "jobs:field_status",
  "schedule:manage",
  "schedule:view",
  "estimates:manage",
  "estimates:view",
  "invoices:manage",
  "invoices:view",
  "invoices:financial",
  "invoices:field",
  "estimates:discount",
  "expenses:manage",
  "expenses:view",
  "reports:view",
  "reports:financial",
  "dashboard:view",
  "equipment:manage",
  "equipment:view",
  "marketing:view",
  "marketing:manage",
  "leads:view",
  "leads:manage",
  "intelligence:view",
  "intelligence:manage",
  "playbooks:view",
  "playbooks:manage",
  "imports:manage",
  "accounting:view",
  "accounting:manage",
  "receipts:view",
  "receipts:manage",
  "job_costs:view",
  "job_costs:manage",
  "pricebook:view",
  "pricebook:manage",
  "pricebook:cost",
  "memberships:view",
  "memberships:manage",
  "compensation:view_own",
  "compensation:view_all",
  "compensation:manage",
  "performance:view_own",
  "performance:view_team",
  "jobs:lock",
  "routing:optimize",
  "payments:manage",
  "payments:refund",
  "payments:view_payouts",
];

export const ROLE_PERMISSIONS: Record<CompanyRole, Permission[]> = {
  COMPANY_OWNER: ALL_COMPANY,
  ADMIN: ALL_COMPANY.filter((p) => p !== "company:manage"),
  OFFICE: [
    "customers:manage",
    "customers:view",
    "jobs:manage",
    "jobs:view",
    "jobs:field_status",
    "schedule:manage",
    "schedule:view",
    "jobs:lock",
    "routing:optimize",
    "estimates:manage",
    "estimates:view",
    "invoices:manage",
    "invoices:view",
    "invoices:field",
    "payments:refund",
    "estimates:discount",
    "expenses:manage",
    "expenses:view",
    "reports:view",
    "dashboard:view",
    "equipment:manage",
    "equipment:view",
    "team:view",
    "company:settings",
    "marketing:view",
    "marketing:manage",
    "leads:view",
    "leads:manage",
    "intelligence:view",
    "playbooks:view",
    "imports:manage",
    "accounting:view",
    "receipts:view",
    "receipts:manage",
    "pricebook:view",
    "pricebook:manage",
    "memberships:view",
    "memberships:manage",
    "compensation:view_own",
    "performance:view_own",
    "performance:view_team",
  ],
  DISPATCHER: [
    "customers:view",
    "jobs:manage",
    "jobs:view",
    "jobs:field_status",
    "schedule:manage",
    "schedule:view",
    "jobs:lock",
    "routing:optimize",
    "estimates:view",
    "dashboard:view",
    "team:view",
    "equipment:view",
    "playbooks:view",
    "intelligence:view",
  ],
  SALES: [
    "customers:manage",
    "customers:view",
    "estimates:manage",
    "estimates:view",
    "jobs:view",
    "dashboard:view",
    "equipment:view",
    "marketing:view",
    "leads:view",
    "leads:manage",
    "intelligence:view",
    "playbooks:view",
    "pricebook:view",
    "memberships:view",
    "memberships:manage",
    "performance:view_own",
    "compensation:view_own",
  ],
  TECHNICIAN: [
    "jobs:view",
    "jobs:assigned_only",
    "jobs:field_status",
    "customers:view",
    "schedule:view",
    "estimates:view",
    "invoices:view",
    "invoices:field",
    "estimates:discount",
    "expenses:manage",
    "expenses:view",
    "equipment:view",
    "equipment:manage",
    "dashboard:view",
    "intelligence:view",
    "receipts:view",
    "receipts:manage",
    "pricebook:view",
    "estimates:manage",
    "memberships:view",
    "memberships:manage",
    "compensation:view_own",
    "performance:view_own",
  ],
  INSTALLER: [
    "jobs:view",
    "jobs:assigned_only",
    "jobs:field_status",
    "customers:view",
    "schedule:view",
    "equipment:view",
    "equipment:manage",
    "dashboard:view",
    "intelligence:view",
    "receipts:view",
    "receipts:manage",
  ],
  MANAGER: [
    "customers:view",
    "jobs:manage",
    "jobs:view",
    "jobs:field_status",
    "schedule:manage",
    "schedule:view",
    "jobs:lock",
    "routing:optimize",
    "estimates:view",
    "invoices:field",
    "estimates:discount",
    "invoices:view",
    "expenses:view",
    "reports:view",
    "reports:financial",
    "payments:view_payouts",
    "dashboard:view",
    "team:view",
    "equipment:view",
    "marketing:view",
    "leads:view",
    "intelligence:view",
    "playbooks:view",
    "imports:manage",
    "accounting:view",
    "receipts:view",
    "receipts:manage",
    "job_costs:view",
    "pricebook:view",
    "memberships:view",
    "compensation:view_own",
    "compensation:view_all",
    "performance:view_own",
    "performance:view_team",
  ],
};

export function can(role: CompanyRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function canAny(role: CompanyRole, permissions: Permission[]): boolean {
  return permissions.some((p) => can(role, p));
}

export function isFieldRole(role: CompanyRole) {
  return role === "TECHNICIAN" || role === "INSTALLER";
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
