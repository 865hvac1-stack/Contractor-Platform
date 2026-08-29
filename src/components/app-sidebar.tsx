"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Briefcase,
  CalendarDays,
  FileText,
  Receipt,
  Wallet,
  BarChart3,
  UserCog,
  Settings,
  Menu,
  X,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { brand } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/server/actions/auth";

const nav = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/jobs", label: "Jobs", icon: Briefcase },
  { href: "/schedule", label: "Schedule", icon: CalendarDays },
  { href: "/estimates", label: "Estimates", icon: FileText },
  { href: "/invoices", label: "Invoices", icon: Receipt },
  { href: "/expenses", label: "Expenses", icon: Wallet },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/team", label: "Team", icon: UserCog },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppSidebar({
  companyName,
  userName,
}: {
  companyName: string;
  userName: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const NavLinks = (
    <nav className="flex flex-1 flex-col gap-0.5 px-3 py-4">
      {nav.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              active
                ? "bg-[var(--accent)] text-white"
                : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-[var(--border)] bg-[var(--card)]/95 px-4 backdrop-blur md:hidden">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </Button>
          <span className="font-display text-lg tracking-tight">{brand.name}</span>
        </div>
        <span className="truncate text-xs text-[var(--muted-foreground)]">{companyName}</span>
      </header>

      {open ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            className="absolute inset-0 bg-black/40"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute left-0 top-0 flex h-full w-72 flex-col bg-[var(--card)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-4">
              <div>
                <p className="font-display text-xl">{brand.name}</p>
                <p className="text-xs text-[var(--muted-foreground)]">{companyName}</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            {NavLinks}
            <div className="border-t border-[var(--border)] p-4">
              <p className="text-sm font-medium">{userName}</p>
              <form action={logoutAction}>
                <button type="submit" className="mt-2 text-sm text-[var(--muted-foreground)] underline">
                  Sign out
                </button>
              </form>
            </div>
          </aside>
        </div>
      ) : null}

      <aside className="hidden w-64 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--card)] md:flex">
        <div className="border-b border-[var(--border)] px-5 py-5">
          <p className="font-display text-2xl tracking-tight text-[var(--foreground)]">
            {brand.name}
          </p>
          <p className="mt-1 truncate text-sm text-[var(--muted-foreground)]">{companyName}</p>
        </div>
        {NavLinks}
        <div className="border-t border-[var(--border)] p-4">
          <p className="truncate text-sm font-medium">{userName}</p>
          <form action={logoutAction}>
            <button
              type="submit"
              className="mt-2 text-sm text-[var(--muted-foreground)] transition hover:text-[var(--foreground)]"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
