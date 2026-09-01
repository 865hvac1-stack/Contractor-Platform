import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { getDailyOwnerBrief } from "@/lib/intelligence/pulse";
import { refreshCompanyInsights } from "@/lib/intelligence/generate";
import { listActiveInsights } from "@/lib/intelligence/insights";
import { getOpportunities } from "@/lib/intelligence/opportunities";
import { suggestedQuestions } from "@/lib/intelligence/intent";
import { openaiConfigured } from "@/lib/intelligence/config";
import { AskContractorYou } from "@/components/ask-contractoryou";
import { recommendAutomationDraftAction } from "@/server/actions/intelligence";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";

export default async function IntelligencePage({
  searchParams,
}: {
  searchParams: Promise<{ ask?: string }>;
}) {
  const ctx = await requirePermission("intelligence:view");
  const params = await searchParams;
  const insights = await refreshCompanyInsights(ctx.company.id).catch(() => listActiveInsights(ctx.company.id));
  const [brief, opportunities] = await Promise.all([
    getDailyOwnerBrief(ctx.company.id, ctx.user.firstName),
    getOpportunities(ctx.company.id),
  ]);
  const configured = openaiConfigured();

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--cy-orange)]">
            ContractorYou Intelligence
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--cy-navy)]">
            {brief.greeting}
          </h1>
          <p className="mt-2 max-w-2xl text-[var(--muted-foreground)]">
            What is happening, what needs attention, and what to do next — from this company&apos;s
            records only.
          </p>
        </div>
        <Link href="/settings/intelligence" className="text-sm text-[var(--cy-orange)]">
          Intelligence settings
        </Link>
      </header>

      <AskContractorYou
        suggestions={suggestedQuestions(ctx.role, null, "command")}
        initialQuestion={params.ask || ""}
        autoSubmit={Boolean(params.ask)}
      />

      <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
        <h2 className="text-lg font-semibold text-[var(--cy-navy)]">Daily owner brief</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">{brief.disclaimer}</p>
        <dl className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-[var(--cy-text-muted)]">Today</dt>
            <dd className="mt-1 text-xl font-semibold">{brief.jobsToday} jobs scheduled</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--cy-text-muted)]">Language model</dt>
            <dd className="mt-1 text-sm">{configured ? "Configured" : "Records only — add OPENAI_API_KEY to explain in sentences"}</dd>
          </div>
        </dl>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[var(--cy-navy)]">Needs attention</h2>
        {insights.length === 0 ? (
          <p className="rounded-2xl border border-dashed bg-white p-6 text-sm text-[var(--muted-foreground)]">
            Not enough history yet. ContractorYou will begin identifying trends as your business data
            grows.
          </p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {insights.map((insight) => (
              <li key={insight.id} className="rounded-2xl border bg-white p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
                  {insight.severity} · {insight.category}
                </p>
                <p className="mt-2 font-medium text-[var(--cy-navy)]">{insight.title}</p>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">{insight.summary}</p>
                {insight.recommendedAction?.startsWith("/") ? (
                  <Link href={insight.recommendedAction} className="mt-3 inline-block text-sm text-[var(--cy-orange)]">
                    Open
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[var(--cy-navy)]">Opportunities</h2>
        {opportunities.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            Create and send estimates to begin seeing sales follow-up opportunities.
          </p>
        ) : (
          <ul className="space-y-2">
            {opportunities.map((item) => (
              <li key={item.id} className="rounded-xl border bg-white px-4 py-3">
                <Link href={item.href} className="font-medium text-[var(--cy-navy)]">
                  {item.priority === "HIGH" ? "High priority · " : ""}
                  {item.title}
                </Link>
                <p className="text-sm text-[var(--muted-foreground)]">{item.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {can(ctx.role, "marketing:manage") ? (
        <section className="rounded-2xl border bg-white p-5">
          <h2 className="font-semibold text-[var(--cy-navy)]">Recommended automation</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Review creates a draft. It stays off until you enable it.
          </p>
          <ActionForm
            action={recommendAutomationDraftAction}
            className="mt-3"
            successMessage="Draft saved. It is not enabled."
          >
            <input type="hidden" name="name" value="Estimate follow-up" />
            <input type="hidden" name="trigger" value="Estimate Sent" />
            <input type="hidden" name="action" value="Wait 48 hours. If still open, draft a follow-up SMS." />
            <Button type="submit" variant="outline">
              Review automation
            </Button>
          </ActionForm>
        </section>
      ) : null}
    </div>
  );
}
