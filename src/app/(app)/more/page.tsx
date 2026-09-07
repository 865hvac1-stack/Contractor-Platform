import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { moreGroups } from "@/lib/nav";

export default async function MorePage() {
  const ctx = await requirePermission("dashboard:view");
  const groups = moreGroups(ctx.role);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--cy-navy)]">More</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Tools you need, without crowding the everyday menu.
        </p>
      </header>
      {groups.map((group) => (
        <section key={group.label}>
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
            {group.label}
          </h2>
          <ul className="mt-2 divide-y divide-[var(--border)] overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link href={item.href} className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--cy-gray)]/70">
                    <Icon className="size-4 text-[var(--cy-navy)]" />
                    <span className="font-medium text-[var(--cy-navy)]">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
