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

export function JobsSubnav() {
  return (
    <Suspense fallback={null}>
      <HubSubnav
        items={[
          {
            href: "/jobs?view=active",
            label: "Active",
            match: (pathname, search) =>
              pathname.startsWith("/jobs") &&
              !pathname.startsWith("/jobs/new") &&
              !search.includes("status=COMPLETED") &&
              pathname !== "/estimates" &&
              !pathname.startsWith("/operations/waiting"),
          },
          {
            href: "/operations/waiting",
            label: "Waiting",
            match: (pathname) => pathname.startsWith("/operations/waiting"),
          },
          {
            href: "/estimates",
            label: "Estimates",
            match: (pathname) => pathname.startsWith("/estimates"),
          },
          {
            href: "/jobs?status=COMPLETED",
            label: "Completed",
            match: (pathname, search) => pathname.startsWith("/jobs") && search.includes("status=COMPLETED"),
          },
        ]}
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
