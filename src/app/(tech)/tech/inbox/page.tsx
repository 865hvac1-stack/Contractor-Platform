import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { technicianInbox, technicianInboxEmptyCopy } from "@/lib/tech/inbox";

function timeLabel(value: Date) {
  const sameDay = new Date().toDateString() === value.toDateString();
  return sameDay
    ? value.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : value.toLocaleDateString();
}

export default async function TechInboxPage() {
  const ctx = await requirePermission("jobs:view");
  const items = await technicianInbox(ctx.company.id, ctx.user.id);
  const empty = technicianInboxEmptyCopy();

  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl tracking-tight">Inbox</h1>
      <p className="text-sm text-[var(--muted-foreground)]">
        Only conversations and updates on jobs assigned to you.
      </p>
      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-white px-4 py-12 text-center">
          <p className="text-sm font-medium text-[var(--cy-navy)]">{empty.title}</p>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">{empty.detail}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id}>
              <article className="rounded-2xl border border-[var(--border)] bg-white p-4">
                <Link href={item.href} className="block">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-[var(--cy-navy)]">{item.customer}</p>
                      <p className="text-xs text-[var(--muted-foreground)]">{item.jobContext}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs text-[var(--muted-foreground)]">{timeLabel(item.createdAt)}</p>
                      {item.unread ? (
                        <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--cy-orange)]">
                          Unread
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-[var(--muted-foreground)]">{item.preview}</p>
                </Link>
                {item.phone ? (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <a
                      href={`tel:${item.phone}`}
                      className="inline-flex h-11 items-center justify-center rounded-xl bg-[var(--muted)] text-sm font-medium"
                    >
                      Call
                    </a>
                    <a
                      href={`sms:${item.phone}`}
                      className="inline-flex h-11 items-center justify-center rounded-xl bg-[var(--muted)] text-sm font-medium"
                    >
                      Text
                    </a>
                  </div>
                ) : null}
              </article>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
