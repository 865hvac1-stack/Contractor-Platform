"use client";

import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

export function ClickableRecordRow({
  href,
  children,
  className,
  label = "Open record",
}: {
  href: string;
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  const router = useRouter();

  function go() {
    router.push(href);
  }

  function onClick(event: MouseEvent<HTMLTableRowElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("a, button, input, select, textarea, label")) return;
    go();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTableRowElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target as HTMLElement;
    if (target !== event.currentTarget) return;
    event.preventDefault();
    go();
  }

  return (
    <tr
      tabIndex={0}
      role="link"
      aria-label={label}
      data-href={href}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className={cn(
        "cursor-pointer border-t border-[var(--border)] transition-colors",
        "hover:bg-[var(--cy-gray)]/80",
        "focus-visible:bg-[var(--cy-gray)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cy-orange)] focus-visible:ring-inset",
        className
      )}
    >
      {children}
    </tr>
  );
}

export function ClickableLeadRow({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <ClickableRecordRow href={href} className={className} label="Open lead">
      {children}
    </ClickableRecordRow>
  );
}
