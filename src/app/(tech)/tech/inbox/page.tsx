import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { technicianInbox } from "@/lib/tech/inbox";

export default async function TechInboxPage() {
  const ctx = await requirePermission("jobs:view");
  const items = await technicianInbox(ctx.company.id, ctx.user.id);

  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl tracking-tight">Inbox</h1>
      <p className="text-sm text-[var(--muted-foreground)]">
        Only conversations and updates on jobs assigned to you.
      </p>
      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[var(--border)] bg-white px-4 py-12 text-center text-sm text-[var(--muted-foreground)]">
          No customer messages.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id}>
              <Link href={item.href} className="block rounded-2xl border border-[var(--border)] bg-white p-4">
                <p className="font-medium">{item.title}</p>
                <p className="text-sm text-[var(--muted-foreground)]">{item.detail}</p>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">{item.createdAt.toLocaleString()}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
