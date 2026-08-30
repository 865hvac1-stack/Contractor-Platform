import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { getChannelCards } from "@/lib/integrations/connections";
import { PROVIDER_CATEGORIES } from "@/lib/integrations/catalog";
import { actionLabel, oauthStartHref } from "@/lib/integrations/oauth-href";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default async function ChannelsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const ctx = await requirePermission("marketing:view");
  const { error } = await searchParams;
  const cards = await getChannelCards(ctx.company.id);
  const canManage = can(ctx.role, "marketing:manage");

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--cy-navy)]">Channels</h1>
          <p className="mt-2 max-w-2xl text-[var(--muted-foreground)]">
            Connect real marketing accounts. ContractorYou will not pretend a connection exists.
          </p>
        </div>
        <Link href="/marketing/onboarding" className={cn(buttonVariants({ variant: "outline" }))}>
          Setup wizard
        </Link>
      </header>

      {error ? (
        <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
          {decodeURIComponent(error)}
        </p>
      ) : null}

      {PROVIDER_CATEGORIES.map((category) => {
        const group = cards.filter((c) => c.provider.category === category.key);
        return (
          <section key={category.key} className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--cy-text-muted)]">
              {category.label}
            </h2>
            <div className="grid gap-3 md:grid-cols-2">
              {group.map((card) => {
                const href =
                  card.action === "CONNECT" || card.action === "RECONNECT"
                    ? oauthStartHref(card.provider.key)
                    : `/marketing/channels/${card.provider.key}`;
                return (
                  <article
                    key={card.provider.key}
                    className="rounded-2xl border border-[var(--border)] bg-white p-5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-[var(--cy-navy)]">{card.provider.name}</h3>
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
                      <div className="col-span-2">
                        <dt className="text-[var(--cy-text-muted)]">Status detail</dt>
                        <dd className="mt-0.5">
                          {card.errorMessage ||
                            card.healthMessage ||
                            (card.env.configured
                              ? "Ready to connect"
                              : card.env.missing.length
                                ? `Missing: ${card.env.missing.join(", ")}`
                                : "Not connected")}
                        </dd>
                      </div>
                    </dl>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {canManage && card.action !== "COMING_SOON" ? (
                        <Link
                          href={href}
                          className={cn(buttonVariants(), "h-9 px-3 text-xs")}
                        >
                          {actionLabel(card.action)}
                        </Link>
                      ) : (
                        <span className="rounded-lg bg-[var(--cy-gray)] px-3 py-1.5 text-xs text-[var(--cy-text-muted)]">
                          {card.provider.key === "website_chat" ? "Coming soon" : actionLabel(card.action)}
                        </span>
                      )}
                      <Link
                        href={`/marketing/channels/${card.provider.key}`}
                        className={cn(buttonVariants({ variant: "outline" }), "h-9 px-3 text-xs")}
                      >
                        Details
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
