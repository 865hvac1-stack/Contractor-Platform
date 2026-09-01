"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Briefcase, BarChart3, Inbox, Menu } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { DemoModeBadge } from "@/components/demo-mode-badge";
import { TECH_CONTENT_BOTTOM_PADDING, TECH_NAV_SAFE_AREA } from "@/lib/tech/nav";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/tech", label: "Home", icon: Home, exact: true },
  { href: "/tech/jobs", label: "Jobs", icon: Briefcase },
  { href: "/tech/performance", label: "Performance", icon: BarChart3 },
  { href: "/tech/inbox", label: "Inbox", icon: Inbox },
  { href: "/tech/more", label: "More", icon: Menu },
];

export function TechShell({
  companyName,
  userName,
  isDemo,
  children,
}: {
  companyName: string;
  userName: string;
  isDemo?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const hideNav = pathname.includes("/present");

  return (
    <div
      className={cn("min-h-dvh bg-[var(--background)]", hideNav ? "pb-4" : TECH_CONTENT_BOTTOM_PADDING)}
    >
      <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--cy-navy)] px-4 py-3 text-white">
        <div className="flex items-center justify-between gap-3">
          <BrandMark variant="icon" tone="light" />
          <div className="min-w-0 text-right">
            <p className="truncate text-sm font-medium">{userName}</p>
            <p className="truncate text-[11px] text-white/55">{companyName}</p>
            {isDemo ? <div className="mt-1 flex justify-end"><DemoModeBadge compact /></div> : null}
          </div>
        </div>
      </header>
      <main data-testid="tech-main" className="mx-auto w-full max-w-lg px-4 py-4">
        {children}
      </main>
      {hideNav ? null : (
        <nav
          data-testid="tech-bottom-nav"
          className={cn(
            "fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border)] bg-white/95 backdrop-blur",
            TECH_NAV_SAFE_AREA
          )}
        >
          <ul className="mx-auto grid max-w-lg grid-cols-5">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active = tab.exact
                ? pathname === tab.href
                : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
              return (
                <li key={tab.href}>
                  <Link
                    href={tab.href}
                    className={cn(
                      "flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium",
                      active ? "text-[var(--cy-orange)]" : "text-[var(--muted-foreground)]"
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    {tab.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </div>
  );
}
