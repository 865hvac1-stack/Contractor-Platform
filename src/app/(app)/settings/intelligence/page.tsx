import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { openaiConfigured, INTELLIGENCE_MODELS } from "@/lib/intelligence/config";
import { saveIntelligenceSettingsAction } from "@/server/actions/intelligence";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";

export default async function IntelligenceSettingsPage() {
  const ctx = await requirePermission("intelligence:view");
  const [setting, usage] = await Promise.all([
    prisma.companyIntelligenceSetting.findFirst({ where: { companyId: ctx.company.id } }),
    prisma.aIUsageEvent.aggregate({
      where: { companyId: ctx.company.id },
      _count: true,
      _sum: { inputTokens: true, outputTokens: true },
    }),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href="/settings" className="text-sm text-[var(--muted-foreground)]">
          ← Settings
        </Link>
        <h1 className="mt-2 font-display text-3xl tracking-tight">Intelligence</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          ContractorYou Intelligence uses your company records. Provider keys stay on ContractorYou
          infrastructure — you do not paste an API key here.
        </p>
      </div>

      <section className="rounded-2xl border bg-white p-5 text-sm">
        <h2 className="font-medium">Status</h2>
        <dl className="mt-3 space-y-2">
          <div className="flex justify-between gap-3">
            <dt className="text-[var(--muted-foreground)]">AI provider</dt>
            <dd>{openaiConfigured() ? "Configured" : "Not configured"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-[var(--muted-foreground)]">Model</dt>
            <dd>{INTELLIGENCE_MODELS.default}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-[var(--muted-foreground)]">Questions asked</dt>
            <dd>{usage._count}</dd>
          </div>
        </dl>
      </section>

      {can(ctx.role, "intelligence:manage") ? (
        <ActionForm action={saveIntelligenceSettingsAction} className="rounded-2xl border bg-white p-5 space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="dailyBriefEnabled" defaultChecked={setting?.dailyBriefEnabled ?? true} />
            Daily owner brief
          </label>
          <Button type="submit">Save</Button>
        </ActionForm>
      ) : null}
    </div>
  );
}
