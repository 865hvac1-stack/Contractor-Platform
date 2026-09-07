import Link from "next/link";
import { formatWaitingDate, waitingSinceLabel } from "@/lib/waiting/format";

export function CustomerWaitingBanner({
  items,
  timezone,
}: {
  items: Array<{
    id: string;
    columnName: string;
    waitingFor: string | null;
    enteredAt: Date;
    nextCustomerUpdateAt: Date | null;
    jobNumber: string;
  }>;
  timezone: string;
}) {
  if (items.length === 0) return null;
  return (
    <section className="rounded-2xl border border-[var(--cy-orange)]/40 bg-white p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
        Active waiting item
      </p>
      <ul className="mt-3 space-y-3">
        {items.map((item) => (
          <li key={item.id}>
            <p className="font-semibold text-[var(--cy-navy)]">{item.columnName}</p>
            <p className="text-sm">{item.waitingFor || item.jobNumber}</p>
            <p className="text-sm text-[var(--muted-foreground)]">
              {waitingSinceLabel(item.enteredAt)}
              {item.nextCustomerUpdateAt
                ? ` · Next update ${formatWaitingDate(item.nextCustomerUpdateAt, timezone)}`
                : ""}
            </p>
            <Link href={`/operations/waiting?record=${item.id}`} className="mt-1 inline-block text-sm font-medium text-[var(--cy-navy)] underline">
              Open waiting record
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
