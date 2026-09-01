import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { openaiConfigured, INTELLIGENCE_MODELS } from "@/lib/intelligence/config";
import { AI_PERMISSION_POLICY, getBusinessContext } from "@/lib/intelligence/operating-context";
import { identifyEstimateFollowups } from "@/lib/actions/read";
import { saveIntelligenceSettingsAction, testEstimateFollowupRuleAction } from "@/server/actions/intelligence";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";

const HUB = [
  { href: "/team/performance", title: "Goals", copy: "Monthly revenue, close rate, membership, and ticket targets." },
  { href: "/marketing/automations", title: "Automations", copy: "Draft automations that use the Action Engine. They stay off until you enable them." },
  { href: "/actions", title: "Approvals", copy: "Prepared drafts, sends, and failed work live in Action Center." },
  { href: "/intelligence", title: "Use Intelligence", copy: "Go back to the brain — ask, notice, and recommend." },
];

export default async function IntelligenceSettingsPage() {
  const ctx = await requirePermission("intelligence:view");
  const [setting, usage, context, automations] = await Promise.all([
    prisma.companyIntelligenceSetting.findFirst({ where: { companyId: ctx.company.id } }),
    prisma.aIUsageEvent.aggregate({
      where: { companyId: ctx.company.id },
      _count: true,
      _sum: { inputTokens: true, outputTokens: true, estimatedCostMicrousd: true },
    }),
    getBusinessContext(ctx.company.id),
    prisma.automation.findMany({
      where: { companyId: ctx.company.id },
      orderBy: { updatedAt: "desc" },
      take: 8,
    }),
  ]);

  const sample = await identifyEstimateFollowups(
    {
      companyId: ctx.company.id,
      userId: ctx.user.id,
      role: ctx.role,
      source: "ui",
      companyName: ctx.company.businessName,
      isDemo: ctx.company.isDemo,
    },
    { minDays: 3, minCents: 0 }
  );

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <Link href="/settings" className="text-sm text-[var(--muted-foreground)]">
          ← Settings
        </Link>
        <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--cy-orange)]">
          AI Control Center
        </p>
        <h1 className="mt-2 font-display text-3xl tracking-tight text-[var(--cy-navy)]">Configure the brain</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
          Intelligence uses this company&apos;s rules, goals, memory, and permissions. Provider keys stay on
          ContractorYou infrastructure — you do not paste an API key here.
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2">
        {HUB.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-2xl border border-[var(--border)] bg-white p-5 hover:border-[var(--cy-orange)]/40"
          >
            <h2 className="font-semibold text-[var(--cy-navy)]">{item.title}</h2>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">{item.copy}</p>
          </Link>
        ))}
      </section>

      <section className="rounded-2xl border bg-white p-5 text-sm">
        <h2 className="font-semibold text-[var(--cy-navy)]">Status</h2>
        <dl className="mt-3 space-y-2">
          <div className="flex justify-between gap-3">
            <dt className="text-[var(--muted-foreground)]">Language model</dt>
            <dd>{openaiConfigured() ? "Configured" : "Records only"}</dd>
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
        <p className="mt-3 text-xs text-[var(--cy-text-muted)]">
          Usage and cost stay here for owners. Ordinary Intelligence screens do not show token counts.
        </p>
      </section>

      {can(ctx.role, "intelligence:manage") ? (
        <ActionForm action={saveIntelligenceSettingsAction} className="rounded-2xl border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-[var(--cy-navy)]">Preferences</h2>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="dailyBriefEnabled" defaultChecked={setting?.dailyBriefEnabled ?? true} />
            Show the daily owner brief on Intelligence
          </label>
          <Button type="submit">Save preferences</Button>
        </ActionForm>
      ) : null}

      <section className="rounded-2xl border bg-white p-5">
        <h2 className="font-semibold text-[var(--cy-navy)]">Rules</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          These are this company&apos;s authorized operating notes. They do not apply to any other company.
        </p>
        {context?.notes.length ? (
          <ul className="mt-4 space-y-2 text-sm">
            {context.notes.map((note) => (
              <li key={note.id} className="rounded-xl bg-[var(--cy-gray)] px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--cy-orange)]">
                  {note.category}
                </p>
                <p className="mt-1 font-medium text-[var(--cy-navy)]">{note.title}</p>
                <p className="mt-1 text-[var(--muted-foreground)]">{note.statement}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-[var(--muted-foreground)]">
            No extra operating notes are stored for this company. Hard ContractorYou rules still apply.
          </p>
        )}
      </section>

      <section className="rounded-2xl border bg-white p-5">
        <h2 className="font-semibold text-[var(--cy-navy)]">Rule tester</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Follow up estimates after {context?.estimateFollowUpDays ?? 3} days. This reads current records only.
          No messages are sent. No tasks are created.
        </p>
        <p className="mt-3 text-sm text-[var(--cy-navy)]">
          Matches {sample.recordIds?.length ?? 0} estimate{(sample.recordIds?.length ?? 0) === 1 ? "" : "s"}
          {sample.estimatedImpactCents
            ? ` · ${formatMoney(sample.estimatedImpactCents)} open value`
            : ""}
          .
        </p>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <Link href="/estimates" className="text-[var(--cy-orange)] hover:underline">
            View matching records
          </Link>
          {can(ctx.role, "intelligence:view") ? (
            <ActionForm action={testEstimateFollowupRuleAction}>
              <Button type="submit" variant="outline">
                Test rule again
              </Button>
            </ActionForm>
          ) : null}
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-5">
        <h2 className="font-semibold text-[var(--cy-navy)]">AI permissions</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          ContractorYou cannot raise a user&apos;s role. External actions default to approval. High-risk work is
          never available through Ask.
        </p>
        <ul className="mt-4 divide-y text-sm">
          {AI_PERMISSION_POLICY.map((row) => (
            <li key={row.action} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="font-medium text-[var(--cy-navy)]">{row.action}</p>
                <p className="text-[var(--muted-foreground)]">{row.note}</p>
              </div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--cy-orange)]">
                {row.level.replaceAll("_", " ")}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-[var(--cy-navy)]">Automations</h2>
          <Link href="/marketing/automations" className="text-sm text-[var(--cy-orange)] hover:underline">
            Open automations
          </Link>
        </div>
        {automations.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--muted-foreground)]">
            No automations on file. Drafts use registered Action Engine tools and stay off until you enable them.
          </p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {automations.map((row) => (
              <li key={row.id} className="rounded-xl bg-[var(--cy-gray)] px-4 py-3">
                <p className="font-medium text-[var(--cy-navy)]">{row.name}</p>
                <p className="text-[var(--muted-foreground)]">
                  {row.trigger} → {row.action} · {row.enabled ? "On" : "Draft / off"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border bg-white p-5">
        <h2 className="font-semibold text-[var(--cy-navy)]">Memory</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
          Company memory is the operating notes and goals above. Operational facts — an invoice being overdue,
          a job running late — are always queried live. ContractorYou does not store “Invoice X is overdue” as
          permanent memory.
        </p>
      </section>

      <section className="rounded-2xl border bg-white p-5">
        <h2 className="font-semibold text-[var(--cy-navy)]">Audit</h2>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          Rule changes, approvals, executions, and Ask questions are written to this company&apos;s audit log.
          Secrets are never stored there.
        </p>
        <Link href="/actions" className="mt-3 inline-block text-sm text-[var(--cy-orange)] hover:underline">
          Review recent AI actions
        </Link>
      </section>
    </div>
  );
}
