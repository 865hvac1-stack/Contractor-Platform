"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const items = [
  { href: "/marketing", label: "Hub", exact: true },
  { href: "/marketing/leads", label: "Leads" },
  { href: "/marketing/channels", label: "Channels" },
  { href: "/marketing/onboarding", label: "Setup" },
  { href: "/marketing/forms", label: "Website" },
  { href: "/marketing/social", label: "Social" },
  { href: "/marketing/campaigns", label: "Campaigns" },
  { href: "/marketing/reviews", label: "Reviews" },
  { href: "/marketing/automations", label: "Automations" },
  { href: "/marketing/communications", label: "Comms" },
];

export function MarketingSubnav() {
  const pathname = usePathname();
  return (
    <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
      {items.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-sm font-medium",
              active
                ? "bg-[var(--cy-navy)] text-white"
                : "text-[var(--cy-text-secondary)] hover:bg-white"
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
