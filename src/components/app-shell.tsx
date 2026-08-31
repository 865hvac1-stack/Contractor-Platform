"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
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
  Settings,
  Menu,
  X,
  Search,
  Bell,
  CircleHelp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { logoutAction } from "@/server/actions/auth";

type NavItem = {
  href?: string;
  label: string;
  icon: typeof LayoutDashboard;
  comingSoon?: boolean;
  exact?: boolean;
};

type NavGroup = {
  title: string;
  items: NavItem[];
};

const groups: NavGroup[] = [
  {
    title: "Command Center",
    items: [
      { href: "/dashboard", label: "Home", icon: LayoutDashboard },
      { href: "/intelligence", label: "Intelligence", icon: CircleHelp },
      { label: "Inbox", icon: Inbox, comingSoon: true },
    ],
  },
  {
    title: "Operations",
    items: [
      { href: "/customers", label: "Customers", icon: Users },
      { href: "/schedule", label: "Schedule", icon: CalendarDays },
      { href: "/jobs", label: "Jobs", icon: Briefcase },
      { href: "/settings/playbooks", label: "Playbooks", icon: BookOpen },
      { href: "/estimates", label: "Estimates", icon: FileText },
      { href: "/invoices", label: "Invoices", icon: Receipt },
      { href: "/pricebook", label: "Pricebook", icon: BookOpen },
      { href: "/memberships", label: "Memberships", icon: Star },
    ],
  },
  {
    title: "Marketing Hub",
    items: [
      { href: "/marketing", label: "Marketing Hub", icon: Megaphone, exact: true },
      { href: "/marketing/leads", label: "Leads", icon: UserPlus },
      { href: "/marketing/communications", label: "Communications", icon: MessageSquare },
      { href: "/marketing/campaigns", label: "Campaigns", icon: Share2 },
      { href: "/marketing/reviews", label: "Reviews", icon: Star },
      { href: "/marketing/automations", label: "Automations", icon: Zap },
      { href: "/marketing/channels", label: "Channels", icon: Plug },
    ],
  },
  {
    title: "Money",
    items: [
      { href: "/receipts", label: "Receipts", icon: Camera },
      { href: "/expenses", label: "Expenses", icon: Wallet },
      { href: "/reports", label: "Reports", icon: BarChart3 },
    ],
  },
  {
    title: "Team",
    items: [
      { href: "/team", label: "Team", icon: UserCog, exact: true },
      { href: "/team/compensation", label: "Compensation", icon: Wallet },
      { href: "/team/performance", label: "Team scorecards", icon: BarChart3 },
      { href: "/me/performance", label: "My Performance", icon: Star },
    ],
  },
];

function NavList({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {groups.map((group) => (
        <div key={group.title}>
          <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">
            {group.title}
          </p>
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = Boolean(
                item.href &&
                  (item.exact
                    ? pathname === item.href
                    : pathname === item.href || pathname.startsWith(item.href + "/"))
              );

              if (item.comingSoon || !item.href) {
                return (
                  <div
                    key={item.label}
                    className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-white/35"
                    title="Coming soon"
                  >
                    <span className="flex items-center gap-3">
                      <Icon className="h-4 w-4 shrink-0" />
                      {item.label}
                    </span>
                    <span className="rounded bg-white/8 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/40">
                      Soon
                    </span>
                  </div>
                );
              }

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-white/8 text-white shadow-[inset_2px_0_0_0_var(--cy-orange)]"
                      : "text-white/65 hover:bg-white/6 hover:text-white"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function AppShell({
  companyName,
  userName,
  userEmail,
  children,
}: {
  companyName: string;
  userName: string;
  userEmail: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-[var(--background)]">
      <aside className="hidden w-[260px] shrink-0 flex-col bg-[var(--cy-navy)] md:flex">
        <div className="border-b border-white/8 px-4 py-5">
          <BrandMark variant="full" tone="light" />
          <p className="mt-3 truncate text-sm font-medium text-white/70">{companyName}</p>
        </div>
        <NavList pathname={pathname} />
        <div className="border-t border-white/8 p-3">
          <Link
            href="/settings"
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium",
              pathname.startsWith("/settings")
                ? "bg-white/8 text-white"
                : "text-white/65 hover:bg-white/6 hover:text-white"
            )}
          >
            <Settings className="h-4 w-4" />
            Settings
          </Link>
        </div>
      </aside>

      {open ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            className="absolute inset-0 bg-black/50"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute left-0 top-0 flex h-full w-72 flex-col bg-[var(--cy-navy)] shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/8 px-4 py-4">
              <BrandMark variant="full" tone="light" />
              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/10"
                onClick={() => setOpen(false)}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <p className="truncate px-5 pt-3 text-sm text-white/60">{companyName}</p>
            <NavList pathname={pathname} onNavigate={() => setOpen(false)} />
            <div className="border-t border-white/8 p-3">
              <Link
                href="/settings"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-white/70"
              >
                <Settings className="h-4 w-4" />
                Settings
              </Link>
            </div>
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-[var(--border)] bg-white/95 px-3 backdrop-blur md:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </Button>

          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--cy-text-muted)]" />
            <Input
              disabled
              placeholder="Search customers, jobs, invoices…"
              aria-label="Universal search coming soon"
              className="h-9 border-transparent bg-[var(--cy-gray)] pl-9 text-sm"
            />
            <span className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded bg-white px-1.5 py-0.5 text-[10px] font-medium text-[var(--cy-text-muted)] sm:inline">
              Coming soon
            </span>
          </div>

          <button
            type="button"
            disabled
            title="Notifications coming soon"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--cy-text-muted)]"
          >
            <Bell className="h-4 w-4" />
            <span className="sr-only">Notifications coming soon</span>
          </button>
          <button
            type="button"
            disabled
            title="Help coming soon"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--cy-text-muted)]"
          >
            <CircleHelp className="h-4 w-4" />
            <span className="sr-only">Help coming soon</span>
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-[var(--cy-gray)]">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--cy-navy)] text-xs font-semibold text-white">
                {userName
                  .split(" ")
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((p) => p[0]?.toUpperCase())
                  .join("")}
              </span>
              <span className="hidden text-left sm:block">
                <span className="block max-w-[140px] truncate text-sm font-medium leading-tight">
                  {userName}
                </span>
                <span className="block max-w-[140px] truncate text-[11px] text-[var(--muted-foreground)]">
                  {userEmail}
                </span>
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem>
                <Link href="/settings" className="w-full">
                  Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <form action={logoutAction} className="w-full">
                  <button type="submit" className="w-full text-left">
                    Sign out
                  </button>
                </form>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="flex-1 overflow-x-hidden">
          <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8 md:py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
