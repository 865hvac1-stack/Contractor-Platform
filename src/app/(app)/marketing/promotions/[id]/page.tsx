import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { PromotionForm } from "@/components/automations/promotion-form";

export default async function PromotionEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission("marketing:view");
  const { id } = await params;
  const promotion = await prisma.promotion.findFirst({ where: { id, companyId: ctx.company.id } });
  if (!promotion) notFound();

  return (
    <div className="space-y-6">
      <Link href="/marketing/promotions" className="text-sm text-[var(--muted-foreground)] hover:underline">
        ← Promotions
      </Link>
      <header>
        <h1 className="text-3xl font-semibold text-[var(--cy-navy)]">{promotion.name}</h1>
        <p className="mt-2 text-[var(--muted-foreground)]">
          Regina can reference only the exact active offer and configured terms.
        </p>
      </header>
      {can(ctx.role, "marketing:manage") ? (
        <section className="rounded-2xl border bg-white p-5">
          <PromotionForm promotion={promotion} />
        </section>
      ) : (
        <p className="rounded-2xl border bg-white p-5 text-sm text-[var(--muted-foreground)]">
          You can view this promotion but do not have permission to change it.
        </p>
      )}
    </div>
  );
}
