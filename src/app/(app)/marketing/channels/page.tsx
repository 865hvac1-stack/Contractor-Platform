import { requirePermission } from "@/lib/tenant";
import { getChannelCards } from "@/lib/integrations/connections";
import { PROVIDER_CATEGORIES } from "@/lib/integrations/catalog";
import { StatusBadge } from "@/components/status-badge";

export default async function ChannelsPage() {
  const ctx = await requirePermission("marketing:view");
  const cards = await getChannelCards(ctx.company.id);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--cy-navy)]">Channels</h1>
        <p className="mt-2 max-w-2xl text-[var(--muted-foreground)]">
          Central place to connect Google, Meta, phone, and website sources. OAuth is not
          enabled until provider credentials are configured server-side. We will not pretend a
          connection exists.
        </p>
      </header>

      {PROVIDER_CATEGORIES.map((category) => {
        const group = cards.filter((c) => c.provider.category === category.key);
        return (
          <section key={category.key} className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--cy-text-muted)]">
              {category.label}
            </h2>
            <div className="grid gap-3 md:grid-cols-2">
              {group.map((card) => (
                <article
                  key={card.provider.key}
                  className="rounded-2xl border border-[var(--border)] bg-white p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--cy-gray)] text-sm font-semibold text-[var(--cy-navy)]">
                        {card.provider.name.slice(0, 2).toUpperCase()}
                      </div>
                      <h3 className="mt-3 font-semibold text-[var(--cy-navy)]">
                        {card.provider.name}
                      </h3>
                      <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                        {card.provider.description}
                      </p>
                    </div>
                    <StatusBadge status={card.status} />
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-xs text-[var(--cy-text-secondary)]">
                    <div>
                      <dt className="text-[var(--cy-text-muted)]">Account</dt>
                      <dd className="mt-0.5">{card.accountLabel ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-[var(--cy-text-muted)]">Last sync</dt>
                      <dd className="mt-0.5">
                        {card.lastSyncAt ? card.lastSyncAt.toLocaleString() : "Never"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[var(--cy-text-muted)]">Health</dt>
                      <dd className="mt-0.5">{card.healthMessage ?? "Not connected"}</dd>
                    </div>
                    <div>
                      <dt className="text-[var(--cy-text-muted)]">Permissions</dt>
                      <dd className="mt-0.5">None granted</dd>
                    </div>
                  </dl>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled
                      className="rounded-lg bg-[var(--cy-navy)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                    >
                      {card.provider.readiness === "coming_soon"
                        ? "Coming soon"
                        : "Connect — integration not configured"}
                    </button>
                    <button
                      type="button"
                      disabled
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--cy-text-muted)]"
                    >
                      Configure
                    </button>
                    <button
                      type="button"
                      disabled
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--cy-text-muted)]"
                    >
                      Disconnect
                    </button>
                  </div>
                  <p className="mt-3 text-xs text-[var(--cy-text-muted)]">{card.provider.value}</p>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
