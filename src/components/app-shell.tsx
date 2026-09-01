"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Bell, CircleHelp, Menu, Settings, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { logoutAction } from "@/server/actions/auth";
import type { CompanyRole } from "@prisma/client";
import { GlobalSearch } from "@/components/global-search";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { DemoModeBadge } from "@/components/demo-mode-badge";
import { AppNav } from "@/components/app-nav";
import { isSettingsActive } from "@/lib/nav";
import { accessibleWorkspaces, type WorkspaceId } from "@/lib/workspaces";

function SettingsLink({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  const active = isSettingsActive(pathname);
  return (
    <Link
      href="/settings"
      onClick={onNavigate}
      className={cn(
        "flex min-h-10 items-center gap-2.5 rounded-lg px-3 text-sm font-medium",
        active ? "bg-white/8 text-white" : "text-white/65 hover:bg-white/6 hover:text-white"
      )}
    >
      <Settings className="size-4" />
      Settings
    </Link>
  );
}

export function AppShell({
  companyName,
  companyLogoUrl,
  userName,
  userEmail,
  role,
  isDemo,
  children,
}: {
  companyName: string;
  companyLogoUrl?: string | null;
  userName: string;
  userEmail: string;
  role: CompanyRole;
  isDemo?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const workspaces = accessibleWorkspaces(role);
  const current: WorkspaceId =
    pathname.startsWith("/dispatch") ? "dispatch" : pathname.startsWith("/office") ? "office" : "command";

  return (
    <div className="flex min-h-screen bg-[var(--background)]">
      <aside className="hidden w-[260px] shrink-0 flex-col bg-[var(--cy-navy)] md:flex">
        <div className="border-b border-white/8 px-4 py-5">
          <BrandMark variant="full" tone="light" />
          <div className="mt-3 flex items-center gap-2">
            {companyLogoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={companyLogoUrl} alt="" className="h-7 w-7 rounded-md bg-white object-contain p-0.5" />
            ) : null}
            <p className="truncate text-sm font-medium text-white/70">{companyName}</p>
          </div>
          {isDemo ? (
            <div className="mt-2">
              <DemoModeBadge tone="on-dark" />
            </div>
          ) : null}
        </div>
        <AppNav pathname={pathname} role={role} />
        <div className="border-t border-white/8 p-3">
          <SettingsLink pathname={pathname} />
        </div>
      </aside>

      {open ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            className="absolute inset-0 bg-black/50"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute left-0 top-0 flex h-full w-[260px] flex-col bg-[var(--cy-navy)] shadow-2xl">
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
            <div className="px-5 pt-3">
              <p className="truncate text-sm text-white/60">{companyName}</p>
              {isDemo ? (
                <div className="mt-2">
                  <DemoModeBadge tone="on-dark" />
                </div>
              ) : null}
            </div>
            <AppNav pathname={pathname} role={role} onNavigate={() => setOpen(false)} />
            <div className="border-t border-white/8 p-3">
              <SettingsLink pathname={pathname} onNavigate={() => setOpen(false)} />
            </div>
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 overflow-hidden border-b border-[var(--border)] bg-white/95 px-3 backdrop-blur md:gap-3 md:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 md:hidden"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </Button>

          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--cy-navy)] md:hidden">
            {companyName}
          </p>
          <WorkspaceSwitcher current={current} allowed={workspaces} />
          {isDemo ? <span className="hidden md:inline-flex"><DemoModeBadge /></span> : null}
          <GlobalSearch />

          <button
            type="button"
            disabled
            title="Notifications coming soon"
            className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--cy-text-muted)] md:inline-flex"
          >
            <Bell className="h-4 w-4" />
            <span className="sr-only">Notifications coming soon</span>
          </button>
          <button
            type="button"
            disabled
            title="Help coming soon"
            className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--cy-text-muted)] md:inline-flex"
          >
            <CircleHelp className="h-4 w-4" />
            <span className="sr-only">Help coming soon</span>
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex shrink-0 items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-[var(--cy-gray)]">
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
                <span className="block max-w-[140px] truncate text-[var(--muted-foreground)] text-[11px]">
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
          <div
            className={`mx-auto w-full px-4 ${
              pathname.startsWith("/dispatch")
                ? "max-w-[1600px] py-3 md:px-6 md:py-4"
                : "max-w-7xl py-6 md:px-8 md:py-8"
            }`}
          >
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
