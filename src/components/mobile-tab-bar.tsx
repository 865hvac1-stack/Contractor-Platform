"use client";

import Link from "next/link";
import type { CompanyRole } from "@prisma/client";
import { cn } from "@/lib/utils";
import { isNavItemActive, visibleMobileTabs } from "@/lib/nav";

export function MobileTabBar({ pathname, role }: { pathname: string; role: CompanyRole }) {
  const tabs = visibleMobileTabs(role);
  if (tabs.length === 0) return null;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      aria-label="Primary"
    >
      <ul className="grid h-14 grid-cols-5">
        {tabs.map((item) => {
          const Icon = item.icon;
          const active = isNavItemActive(pathname, item);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  "flex h-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
                  active ? "text-[var(--cy-orange)]" : "text-[var(--muted-foreground)]"
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
