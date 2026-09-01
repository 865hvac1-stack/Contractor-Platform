"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { CompanyRole } from "@prisma/client";
import { cn } from "@/lib/utils";
import {
  NAV_STORAGE_KEY,
  accordionSectionForPath,
  isNavItemActive,
  parseRememberedSection,
  resolveOpenSection,
  sectionContainsPath,
  visibleAccordionSections,
  visiblePrimaryNav,
  type AccordionSectionId,
  type NavItem,
} from "@/lib/nav";

function readRemembered(): AccordionSectionId | null {
  if (typeof window === "undefined") return null;
  try {
    return parseRememberedSection(window.localStorage.getItem(NAV_STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeRemembered(id: AccordionSectionId | null) {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(NAV_STORAGE_KEY, id);
    else window.localStorage.removeItem(NAV_STORAGE_KEY);
  } catch {
    // Ignore private-mode / blocked storage.
  }
}

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
  const sections = visibleAccordionSections(role);
  const available = sections.map((section) => section.id);
  const [openSection, setOpenSection] = useState<AccordionSectionId | null>(() =>
    resolveOpenSection({
      pathname,
      remembered: null,
      available,
    })
  );

  useEffect(() => {
    setOpenSection(
      resolveOpenSection({
        pathname,
        remembered: accordionSectionForPath(pathname) ? null : readRemembered(),
        available,
      })
    );
    // available is derived from role, which is stable for a session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, role]);

  function toggle(id: AccordionSectionId) {
    setOpenSection((current) => {
      const next = current === id ? null : id;
      writeRemembered(next);
      return next;
    });
  }

  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="ContractorYou">
      {primary.length > 0 ? (
        <div>
          <p className="px-3 pb-1.5 text-[11px] font-medium text-white/40">Command Center</p>
          <div className="space-y-0.5">
            {primary.map((item) => (
              <NavLink key={item.label} item={item} pathname={pathname} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      ) : null}

      {sections.length > 0 ? (
        <div>
          <p className="px-3 pb-1.5 text-[11px] font-medium text-white/40">Business</p>
          <div className="space-y-0.5">
            {sections.map((section) => {
              const Icon = section.icon;
              const expanded = openSection === section.id;
              const containsActive = sectionContainsPath(section, pathname);
              const panelId = `nav-section-${section.id}`;
              const triggerId = `${panelId}-trigger`;
              return (
                <div key={section.id}>
                  <button
                    type="button"
                    id={triggerId}
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    onClick={() => toggle(section.id)}
                    className={cn(
                      "flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 text-sm font-medium transition-colors",
                      containsActive
                        ? "text-white"
                        : "text-white/70 hover:bg-white/6 hover:text-white",
                      expanded && !containsActive ? "bg-white/5" : null,
                      containsActive && !expanded
                        ? "shadow-[inset_2px_0_0_0_var(--cy-orange)]"
                        : null
                    )}
                  >
                    <Icon className="size-4 shrink-0 opacity-80" />
                    <span className="flex-1 text-left">{section.label}</span>
                    <ChevronRight
                      className={cn(
                        "size-3.5 shrink-0 text-white/40 transition-transform",
                        expanded && "rotate-90",
                        containsActive && "text-[var(--cy-orange)]"
                      )}
                    />
                  </button>
                  <div
                    id={panelId}
                    role="region"
                    aria-labelledby={triggerId}
                    hidden={!expanded}
                    className="mt-0.5 space-y-0.5 pl-2"
                  >
                    {section.items.map((item) => (
                      <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </nav>
  );
}
