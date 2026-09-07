import Link from "next/link";
import { AlertTriangle, CalendarClock, ChevronRight, DollarSign, PhoneCall } from "lucide-react";
import type { PresentedAttention } from "@/lib/attention-present";

const ICONS = {
  money: DollarSign,
  schedule: CalendarClock,
  comms: PhoneCall,
  alert: AlertTriangle,
} as const;

function iconFor(type: string) {
  if (type.startsWith("invoice") || type === "payment_failed") return ICONS.money;
  if (type.includes("schedule") || type.includes("technician") || type.includes("ready")) return ICONS.schedule;
  if (type.includes("call") || type.includes("replied") || type.includes("update_failed")) return ICONS.comms;
  return ICONS.alert;
}

function tone(priority: PresentedAttention["priority"]) {
  if (priority === "CRITICAL") return "bg-rose-50 text-rose-700";
  if (priority === "HIGH") return "bg-[var(--cy-orange)]/12 text-[var(--cy-orange)]";
  return "bg-slate-100 text-slate-600";
}

function dot(priority: PresentedAttention["priority"]) {
  if (priority === "CRITICAL") return "bg-rose-600";
  if (priority === "HIGH") return "bg-[var(--cy-orange)]";
  return "bg-slate-400";
}

export function NeedsYou({ items, total }: { items: PresentedAttention[]; total: number }) {
  return (
    <section>
      <div className="flex items-end justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">Needs you</h2>
        <Link
          href="/attention"
          className="text-sm font-medium text-[var(--cy-navy)] underline-offset-4 hover:underline"
        >
          View all{total > items.length ? ` (${total})` : ""} →
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="mt-3 rounded-2xl border border-[var(--border)] bg-white px-4 py-5 text-sm text-[var(--cy-text-secondary)]">
          Nothing needs you right now.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-[var(--border)] overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-[0_8px_24px_rgba(11,18,32,0.04)]">
          {items.map((item) => {
            const Icon = iconFor(item.type);
            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className="flex items-center gap-3 px-3 py-3 transition hover:bg-[var(--cy-gray)]/80 focus-visible:bg-[var(--cy-gray)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--cy-navy)] md:px-4"
                >
                  <span className={`inline-flex size-9 shrink-0 items-center justify-center rounded-xl ${tone(item.priority)}`}>
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className={`size-1.5 rounded-full ${dot(item.priority)}`} />
                      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--cy-navy)]">
                        {item.headline}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-sm font-medium text-[var(--cy-navy)]">{item.who}</span>
                    <span className="block truncate text-xs text-[var(--cy-text-secondary)]">{item.why}</span>
                  </span>
                  <span className="hidden shrink-0 items-center gap-1 text-sm font-medium text-[var(--cy-orange)] sm:inline-flex">
                    {item.action}
                    <ChevronRight className="size-4" />
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-[var(--muted-foreground)] sm:hidden" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
