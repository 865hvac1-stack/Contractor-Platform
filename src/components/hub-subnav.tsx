"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

export function HubSubnav({
  items,
}: {
  items: Array<{ href: string; label: string; match?: (pathname: string, search: string) => boolean }>;
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const query = search.toString();

  return (
    <nav className="-mx-4 mb-4 flex gap-1 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0" aria-label="Section">
      {items.map((item) => {
        const active = item.match
          ? item.match(pathname, query)
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href + item.label}
            href={item.href}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-sm font-medium",
              active ? "bg-[var(--cy-navy)] text-white" : "text-[var(--cy-text-secondary)] hover:bg-white"
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function JobsSubnav({ canDispatch = true }: { canDispatch?: boolean } = {}) {
  return (
    <Suspense fallback={null}>
      <HubSubnav
        items={[
          {
            href: "/jobs?view=dispatch",
            label: "Dispatch Board",
            match: (pathname: string, search: string) => pathname === "/jobs" && (!search.includes("view=") || search.includes("view=dispatch")),
          },
          {
            href: "/jobs?view=all",
            label: "All Jobs",
            match: (pathname: string, search: string) => pathname === "/jobs" && search.includes("view=all"),
          },
          {
            href: "/jobs?view=waiting",
            label: "Waiting",
            match: (pathname: string, search: string) => pathname.startsWith("/operations/waiting") || (pathname === "/jobs" && search.includes("view=waiting")),
          },
          {
            href: "/jobs?view=estimates",
            label: "Estimates",
            match: (pathname: string, search: string) => pathname.startsWith("/estimates") || (pathname === "/jobs" && search.includes("view=estimates")),
          },
          {
            href: "/jobs?view=completed",
            label: "Completed",
            match: (pathname: string, search: string) => pathname === "/jobs" && search.includes("view=completed"),
          },
          {
            href: "/jobs?view=attention",
            label: "Needs Attention",
            match: (pathname: string, search: string) => pathname === "/jobs" && search.includes("view=attention"),
          },
        ].filter((item) => canDispatch || item.href !== "/jobs?view=dispatch")}
      />
    </Suspense>
  );
}

export function MoneySubnav() {
  return (
    <Suspense fallback={null}>
      <HubSubnav
        items={[
          { href: "/money", label: "Overview", match: (pathname) => pathname === "/money" },
          { href: "/billing-watchdog", label: "Watchdog" },
          { href: "/invoices", label: "Invoices" },
          { href: "/payments", label: "Payments" },
          { href: "/expenses", label: "Expenses" },
          { href: "/receipts", label: "Receipts" },
        ]}
      />
    </Suspense>
  );
}
