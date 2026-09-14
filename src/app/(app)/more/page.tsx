import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { moreGroups, SETTINGS_ITEM } from "@/lib/nav";
import { can } from "@/lib/permissions";

export default async function MorePage() {
  const ctx = await requirePermission("dashboard:view");
  const groups = moreGroups(ctx.role);
  const settingsVisible = can(ctx.role, "company:settings");

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
      {settingsVisible ? (
        <section>
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
            Workspace
          </h2>
          <Link
            href={SETTINGS_ITEM.href}
            className="mt-2 flex min-h-12 items-center gap-3 rounded-2xl border border-[var(--border)] bg-white px-4 py-3 hover:border-[var(--cy-orange)]/40 hover:bg-[var(--cy-gray)]/70"
          >
            <SETTINGS_ITEM.icon className="size-4 text-[var(--cy-navy)]" />
            <span className="font-medium text-[var(--cy-navy)]">Settings</span>
          </Link>
        </section>
      ) : null}
    </div>
  );
}
