import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { PromotionForm } from "@/components/automations/promotion-form";
import { StatusBadge } from "@/components/status-badge";
import { formatDate } from "@/lib/datetime";

export default async function PromotionsPage() {
  const ctx = await requirePermission("marketing:view");
  const promotions = await prisma.promotion.findMany({
    where: { companyId: ctx.company.id },
    orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
  });
  const canManage = can(ctx.role, "marketing:manage");

  return (
    <div className="space-y-7">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--cy-navy)]">Promotions</h1>
          <p className="mt-2 max-w-2xl text-[var(--muted-foreground)]">
            Keep seasonal offers accurate, time-bound, and ready for Regina conversations.
          </p>
        </div>
        <Link href="/marketing/automations" className="text-sm font-semibold text-[var(--cy-orange)] hover:underline">
          Automations →
        </Link>
      </header>

      {canManage ? (
        <section className="rounded-2xl border bg-white p-5">
          <h2 className="font-semibold text-[var(--cy-navy)]">Create promotion</h2>
          <div className="mt-4"><PromotionForm /></div>
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 text-xl font-semibold text-[var(--cy-navy)]">Promotions Bank</h2>
        {promotions.length ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {promotions.map((promotion) => (
              <article key={promotion.id} className="rounded-2xl border bg-white p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-[var(--cy-navy)]">{promotion.name}</h3>
                    <p className="mt-1 text-sm font-medium text-[var(--cy-orange)]">{promotion.offer}</p>
                  </div>
                  <StatusBadge status={runtimeStatus(promotion)} />
                </div>
                <p className="mt-3 text-sm text-[var(--muted-foreground)]">{promotion.headline}</p>
                <dl className="mt-4 grid grid-cols-2 gap-3 border-t pt-4 text-sm">
                  <div><dt className="text-xs text-[var(--muted-foreground)]">Dates</dt><dd>{formatDate(promotion.startsAt, ctx.company.timezone)} – {formatDate(promotion.endsAt, ctx.company.timezone)}</dd></div>
                  <div><dt className="text-xs text-[var(--muted-foreground)]">Audience</dt><dd>{promotion.audience.replaceAll("_", " ")}</dd></div>
                </dl>
                <Link href={`/marketing/promotions/${promotion.id}`} className="mt-4 inline-block text-sm font-semibold text-[var(--cy-orange)] hover:underline">
                  Edit promotion →
                </Link>
              </article>
            ))}
          </div>
        ) : (
          <p className="rounded-2xl border border-dashed bg-white p-6 text-sm text-[var(--muted-foreground)]">
            No promotions yet. Create one here, then attach it to an automation.
          </p>
        )}
      </section>
    </div>
  );
}

function runtimeStatus(promotion: { status: string; startsAt: Date; endsAt: Date }) {
  const now = new Date();
  if (promotion.status === "PAUSED") return "PAUSED";
  if (promotion.endsAt < now) return "EXPIRED";
  if (promotion.startsAt > now) return "SCHEDULED";
  return promotion.status;
}
