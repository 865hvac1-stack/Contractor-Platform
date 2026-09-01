import {
  LayoutDashboard,
  Inbox,
  Users,
  UserPlus,
  CalendarDays,
  Briefcase,
  FileText,
  Receipt,
  Camera,
  Megaphone,
  Star,
  Zap,
  Wallet,
  Plug,
  Share2,
  MessageSquare,
  BarChart3,
  BookOpen,
  UserCog,
  CircleHelp,
  ListChecks,
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

export type AccordionSectionId = "operations" | "marketing" | "money" | "team";

export type AccordionSection = {
  id: AccordionSectionId;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
};

export const NAV_STORAGE_KEY = "cy.nav.openSection";

export const ACCORDION_SECTION_IDS: AccordionSectionId[] = [
  "operations",
  "marketing",
  "money",
  "team",
];

export const PRIMARY_NAV: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard, permission: "dashboard:view" },
  { href: "/dispatch", label: "Dispatch", icon: CalendarDays, permission: "schedule:view" },
  { href: "/office", label: "Customer Hub", icon: Users, permission: "customers:view" },
  { href: "/intelligence", label: "Intelligence", icon: CircleHelp, permission: "intelligence:view" },
  { href: "/actions", label: "Action Center", icon: ListChecks, permission: "intelligence:view" },
  { href: "/marketing/communications", label: "Inbox", icon: Inbox, permission: "marketing:view" },
];

export const ACCORDION_SECTIONS: AccordionSection[] = [
  {
    id: "operations",
    label: "Operations",
    icon: Briefcase,
    items: [
      { href: "/customers", label: "Customers", icon: Users, permission: "customers:view" },
      { href: "/schedule", label: "Schedule", icon: CalendarDays, permission: "schedule:view" },
      { href: "/jobs", label: "Jobs", icon: Briefcase, permission: "jobs:view" },
      { href: "/settings/playbooks", label: "Playbooks", icon: BookOpen, permission: "playbooks:view" },
      { href: "/estimates", label: "Estimates", icon: FileText, permission: "estimates:view" },
      { href: "/invoices", label: "Invoices", icon: Receipt, permission: "invoices:view" },
      { href: "/pricebook", label: "Pricebook", icon: BookOpen, permission: "pricebook:view" },
      { href: "/memberships", label: "Memberships", icon: Star, permission: "memberships:view" },
    ],
  },
  {
    id: "marketing",
    label: "Marketing",
    icon: Megaphone,
    items: [
      { href: "/marketing", label: "Marketing Hub", icon: Megaphone, exact: true, permission: "marketing:view" },
      { href: "/marketing/leads", label: "Leads", icon: UserPlus, permission: "leads:view" },
      { href: "/marketing/communications", label: "Communications", icon: MessageSquare, permission: "marketing:view" },
      { href: "/marketing/campaigns", label: "Campaigns", icon: Share2, permission: "marketing:view" },
      { href: "/marketing/reviews", label: "Reviews", icon: Star, permission: "marketing:view" },
      { href: "/marketing/automations", label: "Automations", icon: Zap, permission: "marketing:view" },
      { href: "/marketing/channels", label: "Channels", icon: Plug, permission: "marketing:view" },
    ],
  },
  {
    id: "money",
    label: "Money",
    icon: Wallet,
    items: [
      { href: "/payments", label: "Payments", icon: Wallet, permission: "invoices:view" },
      { href: "/receipts", label: "Receipts", icon: Camera, permission: "receipts:view" },
      { href: "/expenses", label: "Expenses", icon: Wallet, permission: "expenses:view" },
      { href: "/reports", label: "Reports", icon: BarChart3, permission: "reports:view" },
    ],
  },
  {
    id: "team",
    label: "Team",
    icon: UserCog,
    items: [
      { href: "/team", label: "Team", icon: UserCog, exact: true, permission: "team:view" },
      { href: "/team/compensation", label: "Compensation", icon: Wallet, permission: "compensation:view_all" },
      { href: "/team/performance", label: "Scorecards", icon: BarChart3, permission: "performance:view_team" },
      { href: "/me/performance", label: "My Performance", icon: Star, permission: "performance:view_own" },
    ],
  },
];

export function isNavItemActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function filterNavItems(items: NavItem[], role: CompanyRole): NavItem[] {
  return items.filter((item) => !item.permission || can(role, item.permission));
}

export function visiblePrimaryNav(role: CompanyRole): NavItem[] {
  return filterNavItems(PRIMARY_NAV, role);
}

export function visibleAccordionSections(role: CompanyRole): AccordionSection[] {
  return ACCORDION_SECTIONS.map((section) => ({
    ...section,
    items: filterNavItems(section.items, role),
  })).filter((section) => section.items.length > 0);
}

export function primaryOwnsPath(pathname: string): boolean {
  return PRIMARY_NAV.some((item) => isNavItemActive(pathname, item));
}

export function accordionSectionForPath(pathname: string): AccordionSectionId | null {
  for (const section of ACCORDION_SECTIONS) {
    if (!section.items.some((item) => isNavItemActive(pathname, item))) continue;
    if (section.id === "marketing" && primaryOwnsPath(pathname)) return null;
    return section.id;
  }
  return null;
}

export function sectionContainsPath(section: AccordionSection, pathname: string): boolean {
  return section.items.some((item) => isNavItemActive(pathname, item));
}

export function parseRememberedSection(value: string | null | undefined): AccordionSectionId | null {
  if (!value) return null;
  return ACCORDION_SECTION_IDS.includes(value as AccordionSectionId)
    ? (value as AccordionSectionId)
    : null;
}

export function resolveOpenSection({
  pathname,
  remembered,
  available,
}: {
  pathname: string;
  remembered: AccordionSectionId | null;
  available: AccordionSectionId[];
}): AccordionSectionId | null {
  const fromRoute = accordionSectionForPath(pathname);
  if (fromRoute && available.includes(fromRoute)) return fromRoute;
  if (remembered && available.includes(remembered)) return remembered;
  return null;
}

export function isSettingsActive(pathname: string): boolean {
  return pathname === "/settings" || (pathname.startsWith("/settings/") && !pathname.startsWith("/settings/playbooks"));
}
