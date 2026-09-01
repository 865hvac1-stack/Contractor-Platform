import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { getIntelligenceWorkspace } from "@/lib/intelligence/workspace";
import { suggestedQuestions } from "@/lib/intelligence/intent";
import { AskContractorYou } from "@/components/ask-contractoryou";
import { NoticeFeedback } from "@/components/intelligence/notice-feedback";
import { formatMoney } from "@/lib/money";
import { format } from "date-fns";

const KIND_LABEL: Record<string, string> = {
  opportunity: "Opportunity",
  risk: "Risk",
  trend: "Trend",
  anomaly: "Anomaly",
  positive: "Positive",
  goal_progress: "Goal progress",
  operating_issue: "Operating issue",
  customer_experience: "Customer experience",
  cash: "Cash",
  sales: "Sales",
  team: "Team",
  marketing: "Marketing",
};

export default async function IntelligencePage({
  searchParams,
}: {
  searchParams: Promise<{ ask?: string }>;
}) {
  const ctx = await requirePermission("intelligence:view");
  const params = await searchParams;
  const workspace = await getIntelligenceWorkspace(ctx.company.id, ctx.user.firstName);
  const suggestions = suggestedQuestions(ctx.role, null, "intelligence");

  return (
    <div className="space-y-8 md:space-y-10">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--cy-orange)]">
            ContractorYou Intelligence
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--cy-navy)] md:text-4xl">
            Your business, explained.
          </h1>
          <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
            ContractorYou reads your business records, understands your operating rules, and helps you
            decide what to do next.
          </p>
        </div>
        <Link
          href="/settings/intelligence"
          className="text-sm font-medium text-[var(--cy-orange)] hover:underline"
        >
          AI Control Center
        </Link>
      </header>

      {workspace.dailyBriefEnabled ? (
        <section className="rounded-[28px] bg-[var(--cy-navy)] px-5 py-6 text-white md:px-8 md:py-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--cy-orange)]">
            Owner brief
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">{workspace.brief.greeting}</h2>
          <p className="mt-3 text-sm text-white/70">Today ContractorYou sees:</p>
          <ul className="mt-3 space-y-1.5 text-sm leading-6 text-white/90">
            {workspace.brief.facts.map((fact) => (
              <li key={fact}>• {fact}</li>
            ))}
          </ul>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {workspace.brief.biggestOpportunity ? (
              <div className="rounded-2xl bg-white/8 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
                  {workspace.brief.biggestOpportunity.title}
                </p>
                <p className="mt-2 text-sm leading-6 text-white/90">{workspace.brief.biggestOpportunity.detail}</p>
              </div>
            ) : null}
            {workspace.brief.biggestRisk ? (
              <div className="rounded-2xl bg-white/8 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55">
                  {workspace.brief.biggestRisk.title}
                </p>
                <p className="mt-2 text-sm leading-6 text-white/90">{workspace.brief.biggestRisk.detail}</p>
              </div>
            ) : null}
          </div>
          {workspace.health.score != null ? (
            <p className="mt-5 text-sm text-white/65">
              Business Health is {workspace.health.score}
              {workspace.health.label ? ` · ${workspace.health.label}` : ""}.{" "}
              <Link href="/dashboard" className="text-[var(--cy-orange)] hover:underline">
                See the score in Command Center
              </Link>
            </p>
          ) : (
            <p className="mt-5 text-sm text-white/55">Business Health does not have enough data to score yet.</p>
          )}
        </section>
      ) : null}

      <AskContractorYou
        suggestions={suggestions}
        initialQuestion={params.ask || ""}
        autoSubmit={Boolean(params.ask)}
      />
      {!workspace.providerConfigured ? (
        <p className="text-sm text-[var(--muted-foreground)]">
          Language-model sentences are off. ContractorYou still explains from your records. Command Center,
          Action Center, and rules stay available.
        </p>
      ) : null}

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-[var(--cy-navy)]">What ContractorYou noticed</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Meaningful changes only — each one is backed by a recorded calculation.
          </p>
        </div>
        {workspace.noticed.length === 0 && workspace.positives.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-[var(--border)] bg-white px-5 py-8 text-sm text-[var(--muted-foreground)]">
            Not enough history yet. ContractorYou will notice patterns as this company records more work.
          </p>
        ) : (
          <ul className="space-y-3">
            {[...workspace.noticed.slice(0, 3), ...workspace.positives.slice(0, 2)].map((notice) => (
              <li key={notice.id} className="rounded-2xl border border-[var(--border)] bg-white p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
                  {KIND_LABEL[notice.kind] ?? notice.kind}
                </p>
                <h3 className="mt-2 font-semibold text-[var(--cy-navy)]">{notice.title}</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--cy-navy)]">{notice.what}</p>
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm text-[var(--cy-orange)]">Why ContractorYou noticed</summary>
                  <dl className="mt-3 space-y-2 text-sm text-[var(--muted-foreground)]">
                    <div>
                      <dt className="text-[11px] uppercase tracking-[0.14em]">Why</dt>
                      <dd className="mt-1">{notice.why}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] uppercase tracking-[0.14em]">Data used</dt>
                      <dd className="mt-1">{notice.dataUsed}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] uppercase tracking-[0.14em]">Time period</dt>
                      <dd className="mt-1">{notice.period}</dd>
                    </div>
                  </dl>
                </details>
                <div className="mt-4 flex flex-wrap gap-3 text-sm">
                  {notice.href ? (
                    <Link href={notice.href} className="font-medium text-[var(--cy-orange)] hover:underline">
                      Review
                    </Link>
                  ) : null}
                  {notice.ask ? (
                    <Link
                      href={`/intelligence?ask=${encodeURIComponent(notice.ask)}`}
                      className="font-medium text-[var(--cy-navy)] hover:underline"
                    >
                      Ask why
                    </Link>
                  ) : null}
                  {notice.prepareHref ? (
                    <Link href={notice.prepareHref} className="font-medium text-[var(--cy-navy)] hover:underline">
                      {notice.prepareLabel || "Prepare action"}
                    </Link>
                  ) : null}
                </div>
                <NoticeFeedback noticeId={notice.id} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-[var(--cy-navy)]">Opportunities</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">Summaries first. Full lists stay in Action Center.</p>
        </div>
        {workspace.opportunities.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            No summarized opportunities yet. Send estimates or complete jobs to give ContractorYou something to work with.
          </p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {workspace.opportunities.map((item) => (
              <li key={item.id} className="rounded-2xl border border-[var(--border)] bg-white p-5">
                <h3 className="font-semibold text-[var(--cy-navy)]">{item.title}</h3>
                <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                  {item.count} {item.count === 1 ? "record" : "records"}
                  {item.valueCents ? ` · ${formatMoney(item.valueCents)} opportunity` : ""}
                </p>
                <p className="mt-2 text-sm leading-6 text-[var(--cy-navy)]">{item.reason}</p>
                <div className="mt-4 flex flex-wrap gap-3 text-sm">
                  <Link href={item.href} className="font-medium text-[var(--cy-orange)] hover:underline">
                    {item.reviewLabel}
                  </Link>
                  {item.prepareHref ? (
                    <Link href={item.prepareHref} className="font-medium text-[var(--cy-navy)] hover:underline">
                      {item.prepareLabel}
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {workspace.risks.length > 0 ? (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-[var(--cy-navy)]">Risks &amp; trends</h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {workspace.risks.map((risk) => (
              <li key={risk.id} className="rounded-2xl border border-[var(--border)] bg-white p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-text-muted)]">
                  {KIND_LABEL[risk.kind]}
                </p>
                <p className="mt-2 text-sm leading-6 text-[var(--cy-navy)]">{risk.what}</p>
                {risk.href ? (
                  <Link href={risk.href} className="mt-3 inline-block text-sm text-[var(--cy-orange)] hover:underline">
                    Review
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-[var(--cy-navy)]">Recommended next actions</h2>
        {workspace.recommendations.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            No prepared action is needed from the current books. Check Command Center for the live picture.
          </p>
        ) : (
          <ol className="space-y-3">
            {workspace.recommendations.map((row) => (
              <li key={row.id} className="rounded-2xl border border-[var(--border)] bg-white p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
                  {row.rank}
                </p>
                <h3 className="mt-1 font-semibold text-[var(--cy-navy)]">{row.title}</h3>
                <p className="mt-2 text-sm text-[var(--muted-foreground)]">{row.detail}</p>
                <div className="mt-3 flex flex-wrap gap-3 text-sm">
                  <Link href={row.href} className="font-medium text-[var(--cy-orange)] hover:underline">
                    Review
                  </Link>
                  {row.prepareHref ? (
                    <Link href={row.prepareHref} className="font-medium text-[var(--cy-navy)] hover:underline">
                      {row.prepareLabel}
                    </Link>
                  ) : null}
                  {row.ask ? (
                    <Link
                      href={`/intelligence?ask=${encodeURIComponent(row.ask)}`}
                      className="font-medium text-[var(--cy-navy)] hover:underline"
                    >
                      Ask ContractorYou
                    </Link>
                  ) : null}
                  <Link href="/actions" className="text-[var(--muted-foreground)] hover:underline">
                    Open Action Center
                  </Link>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-xl font-semibold text-[var(--cy-navy)]">Company goals</h2>
          <Link href="/team/performance" className="text-sm text-[var(--cy-orange)] hover:underline">
            Manage goals
          </Link>
        </div>
        {workspace.goals.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            No company goals are set. Add targets in Team performance and they will show up here.
          </p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {workspace.goals.map((goal) => (
              <li key={goal.id} className="rounded-2xl border border-[var(--border)] bg-white p-5">
                <h3 className="font-semibold text-[var(--cy-navy)]">{goal.title}</h3>
                <p className="mt-2 text-2xl font-semibold text-[var(--cy-navy)]">{goal.currentLabel}</p>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  Target {goal.targetLabel}
                  {goal.percent != null ? ` · ${goal.percent}% achieved` : ""}
                </p>
                {goal.remainingLabel ? (
                  <p className="mt-1 text-sm text-[var(--muted-foreground)]">{goal.remainingLabel}</p>
                ) : null}
                {goal.projection ? <p className="mt-2 text-sm text-[var(--cy-navy)]">{goal.projection}</p> : null}
                {goal.trend ? <p className="mt-1 text-xs text-[var(--cy-text-muted)]">{goal.trend}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-xl font-semibold text-[var(--cy-navy)]">Recent AI actions</h2>
          <Link href="/actions" className="text-sm text-[var(--cy-orange)] hover:underline">
            Action Center
          </Link>
        </div>
        {workspace.recentActions.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            No prepared actions yet. Ask ContractorYou to draft follow-ups and they will land in Action Center.
          </p>
        ) : (
          <ul className="space-y-2">
            {workspace.recentActions.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/actions/${row.id}`}
                  className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-white px-4 py-3 text-sm hover:border-[var(--cy-orange)]/40"
                >
                  <span className="font-medium text-[var(--cy-navy)]">{row.title}</span>
                  <span className="text-[var(--muted-foreground)]">
                    {row.status.replaceAll("_", " ").toLowerCase()} · {format(row.createdAt, "MMM d")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-[var(--cy-navy)]">Business rules &amp; memory</h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Live records always outrank notes. Configure the brain in AI Control Center — this page uses it.
            </p>
          </div>
          <Link href="/settings/intelligence" className="text-sm text-[var(--cy-orange)] hover:underline">
            Open AI Control Center
          </Link>
        </div>
        {workspace.context?.notes.length ? (
          <ul className="mt-4 space-y-2 text-sm">
            {workspace.context.notes.slice(0, 6).map((note) => (
              <li key={note.id} className="rounded-xl bg-[var(--cy-gray)] px-4 py-3 text-[var(--cy-navy)]">
                <span className="font-medium">{note.title}.</span> {note.statement}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-[var(--muted-foreground)]">
            No extra company operating notes are on file. ContractorYou still uses hard product rules and live records.
          </p>
        )}
      </section>
    </div>
  );
}
