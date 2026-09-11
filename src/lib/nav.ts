import {
  LayoutDashboard,
  Users,
  CalendarDays,
  Briefcase,
  Megaphone,
  Wallet,
  Ellipsis,
  Settings,
  Inbox,
  UserPlus,
  FileText,
  Receipt,
  Camera,
  Star,
  Zap,
  Plug,
  Share2,
  MessageSquare,
  BarChart3,
  BookOpen,
  UserCog,
  CircleHelp,
  ListChecks,
  Hourglass,
  type LucideIcon,
} from "lucide-react";
import type { CompanyRole } from "@prisma/client";
import { can, type Permission } from "@/lib/permissions";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  permission?: Permission;
};

export const PRIMARY_NAV: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard, exact: true, permission: "dashboard:view" },
  { href: "/dispatch", label: "Dispatch", icon: CalendarDays, permission: "schedule:view" },
  { href: "/customers", label: "Customers", icon: Users, permission: "customers:view" },
  { href: "/jobs", label: "Jobs", icon: Briefcase, permission: "jobs:view" },
  { href: "/money", label: "Money", icon: Wallet, permission: "invoices:view" },
  { href: "/marketing", label: "Marketing", icon: Megaphone, exact: true, permission: "marketing:view" },
];

export const MORE_NAV: NavItem[] = [
  { href: "/attention", label: "Action Center", icon: ListChecks, permission: "dashboard:view" },
  { href: "/actions", label: "AI Actions", icon: ListChecks, permission: "intelligence:view" },
  { href: "/intelligence", label: "Intelligence", icon: CircleHelp, permission: "intelligence:view" },
  { href: "/marketing/communications", label: "Inbox", icon: Inbox, permission: "marketing:view" },
  { href: "/office", label: "Customer Hub", icon: Users, permission: "customers:view" },
  { href: "/schedule", label: "Schedule", icon: CalendarDays, permission: "schedule:view" },
  { href: "/operations/waiting", label: "Waiting Board", icon: Hourglass, permission: "jobs:view" },
  { href: "/estimates", label: "Estimates", icon: FileText, permission: "estimates:view" },
  { href: "/billing-watchdog", label: "Billing Watchdog", icon: Wallet, permission: "invoices:view" },
  { href: "/invoices", label: "Invoices", icon: Receipt, permission: "invoices:view" },
  { href: "/memberships", label: "Memberships", icon: Star, permission: "memberships:view" },
  { href: "/maintenance", label: "Maintenance", icon: Star, permission: "memberships:view" },
  { href: "/pricebook", label: "Pricebook", icon: BookOpen, permission: "pricebook:view" },
  { href: "/settings/playbooks", label: "Playbooks", icon: BookOpen, permission: "playbooks:view" },
  { href: "/reports", label: "Reports", icon: BarChart3, permission: "reports:view" },
  { href: "/team", label: "Team", icon: UserCog, exact: true, permission: "team:view" },
  { href: "/team/compensation", label: "Compensation", icon: Wallet, permission: "compensation:view_all" },
  { href: "/team/performance", label: "Scorecards", icon: BarChart3, permission: "performance:view_team" },
  { href: "/me/performance", label: "My Performance", icon: Star, permission: "performance:view_own" },
  { href: "/marketing/leads", label: "Leads", icon: UserPlus, permission: "leads:view" },
  { href: "/marketing/campaigns", label: "Campaigns", icon: Share2, permission: "marketing:view" },
  { href: "/marketing/reviews", label: "Reviews", icon: Star, permission: "marketing:view" },
  { href: "/marketing/automations", label: "Automations", icon: Zap, permission: "marketing:view" },
  { href: "/marketing/channels", label: "Channels", icon: Plug, permission: "marketing:view" },
  { href: "/payments", label: "Payments", icon: Wallet, permission: "invoices:view" },
  { href: "/receipts", label: "Receipts", icon: Camera, permission: "receipts:view" },
  { href: "/expenses", label: "Expenses", icon: Wallet, permission: "expenses:view" },
];

export const MORE_ITEM: NavItem = { href: "/more", label: "More", icon: Ellipsis };
export const SETTINGS_ITEM: NavItem = { href: "/settings", label: "Settings", icon: Settings, permission: "company:settings" };

export const MOBILE_TAB_HREFS = ["/dashboard", "/jobs", "/customers", "/dispatch", "/more"] as const;

const JOBS_HUB_PREFIXES = ["/jobs", "/operations/waiting", "/estimates"];
const MONEY_HUB_PREFIXES = ["/money", "/invoices", "/payments", "/expenses", "/receipts"];
const MARKETING_HUB_PREFIXES = ["/marketing"];

export function isNavItemActive(pathname: string, item: NavItem): boolean {
  if (item.href === "/jobs") {
    return JOBS_HUB_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  }
  if (item.href === "/money") {
    return MONEY_HUB_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  }
  if (item.href === "/marketing") {
    return MARKETING_HUB_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  }
  if (item.href === "/more") {
    return pathname === "/more" || visibleMoreItemsForPath(pathname);
  }
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function visibleMoreItemsForPath(pathname: string) {
  if (isPrimaryHubPath(pathname) || isSettingsActive(pathname)) return false;
  return MORE_NAV.some((item) => {
    if (item.href === "/operations/waiting" || item.href === "/estimates") return false;
    if (MONEY_HUB_PREFIXES.some((prefix) => item.href === prefix || item.href.startsWith(`${prefix}/`))) return false;
    if (item.href.startsWith("/marketing")) return false;
    return isExactOrChild(pathname, item);
  });
}

function isExactOrChild(pathname: string, item: NavItem) {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function isPrimaryHubPath(pathname: string) {
  if (pathname === "/dashboard") return true;
  if (pathname === "/dispatch" || pathname.startsWith("/dispatch/")) return true;
  if (pathname === "/customers" || pathname.startsWith("/customers/")) return true;
  if (JOBS_HUB_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return true;
  if (MONEY_HUB_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return true;
  if (pathname.startsWith("/marketing")) return true;
  return false;
}

export function filterNavItems(items: NavItem[], role: CompanyRole): NavItem[] {
  return items.filter((item) => !item.permission || can(role, item.permission));
}

export function visiblePrimaryNav(role: CompanyRole): NavItem[] {
  return filterNavItems(PRIMARY_NAV, role);
}

export function visibleMoreNav(role: CompanyRole): NavItem[] {
  return filterNavItems(MORE_NAV, role);
}

export function visibleMobileTabs(role: CompanyRole): NavItem[] {
  const catalog = [...visiblePrimaryNav(role), MORE_ITEM];
  return MOBILE_TAB_HREFS.map((href) => catalog.find((item) => item.href === href)).filter(
    (item): item is NavItem => Boolean(item)
  );
}

export function isSettingsActive(pathname: string): boolean {
  return pathname === "/settings" || (pathname.startsWith("/settings/") && !pathname.startsWith("/settings/playbooks"));
}

export function moreGroups(role: CompanyRole) {
  const items = visibleMoreNav(role);
  const byHref = new Set(items.map((item) => item.href));
  const pick = (hrefs: string[]) => items.filter((item) => hrefs.includes(item.href));
  return [
    { label: "Daily tools", items: pick(["/attention", "/actions", "/intelligence", "/marketing/communications", "/office"]) },
    { label: "Operations", items: pick(["/schedule", "/operations/waiting", "/estimates", "/settings/playbooks", "/pricebook"]) },
    { label: "Money & growth", items: pick(["/billing-watchdog", "/invoices", "/payments", "/receipts", "/expenses", "/reports", "/memberships", "/maintenance", "/marketing/leads", "/marketing/campaigns", "/marketing/reviews", "/marketing/automations", "/marketing/channels"]) },
    { label: "Team", items: pick(["/team", "/team/compensation", "/team/performance", "/me/performance"]) },
  ].filter((group) => group.items.length > 0 && group.items.every((item) => byHref.has(item.href)));
}
