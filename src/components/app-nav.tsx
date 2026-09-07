"use client";

import Link from "next/link";
import type { CompanyRole } from "@prisma/client";
import { cn } from "@/lib/utils";
import {
  MORE_ITEM,
  isNavItemActive,
  visiblePrimaryNav,
  type NavItem,
} from "@/lib/nav";

function NavLink({
  item,
  pathname,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const active = isNavItemActive(pathname, item);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        "flex min-h-10 items-center gap-2.5 rounded-lg px-3 text-sm font-medium transition-colors",
        active
          ? "bg-white/8 text-white shadow-[inset_2px_0_0_0_var(--cy-orange)]"
          : "text-white/65 hover:bg-white/6 hover:text-white"
      )}
    >
      <Icon className="size-4 shrink-0 opacity-80" />
      {item.label}
    </Link>
  );
}

export function AppNav({
  pathname,
  role,
  onNavigate,
}: {
  pathname: string;
  role: CompanyRole;
  onNavigate?: () => void;
}) {
  const primary = visiblePrimaryNav(role);

  return (
    <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="ContractorYou">
      {primary.map((item) => (
        <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
      ))}
      <div className="pt-4">
        <NavLink item={MORE_ITEM} pathname={pathname} onNavigate={onNavigate} />
      </div>
    </nav>
  );
}
