import { redirect } from "next/navigation";
import { CustomerSearchTypeahead } from "@/components/customers/search-typeahead";
import { AskContractorYou } from "@/components/ask-contractoryou";
import {
  OfficeAttentionSection,
  OfficeCommunicationsSection,
  OfficeIncomingCallSection,
  OfficeIntelligenceSection,
  OfficePipelineSection,
  OfficeQuickActions,
  OfficeRecentCustomersSection,
  OfficeScorecards,
  OfficeUpcomingSection,
} from "@/components/office/hub-sections";
import { getOfficeHubData } from "@/lib/office/hub";
import { suggestedQuestions } from "@/lib/intelligence/intent";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/lib/tenant";
import { canAccessWorkspace, landingPath } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

const OFFICE_ASK_PROMPTS = [
  "What does the office need to handle today?",
  "Who needs follow-up?",
  "Which estimates should we call?",
  "Who owes us money?",
  "What approved work needs scheduling?",
  "Which leads have not been answered?",
];

export default async function OfficeHubPage() {
  const ctx = await requirePermission("customers:view");
  if (!canAccessWorkspace(ctx.role, "office")) {
    redirect(landingPath(ctx.role));
  }

  const data = await getOfficeHubData(ctx.company.id);

  return (
    <div className="space-y-6 md:space-y-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--cy-orange)]">
            Customer Hub
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--cy-navy)] md:text-4xl">
            Run the front office from one screen.
          </h1>
          <p className="mt-2 max-w-2xl text-[var(--muted-foreground)]">
            Find customers, handle calls, book work, follow up, and keep the day moving.
          </p>
        </div>
        <p className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-text-muted)]">
          Today · Front office
        </p>
      </header>

      <section className="rounded-2xl border border-[var(--border)] bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
              Start here
            </p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-[var(--cy-navy)]">Customer search</h2>
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">Name, phone, email, address, or company</p>
        </div>
        <div className="mt-3">
          <CustomerSearchTypeahead hrefPrefix="/office/customers" showActions emphasis />
        </div>
        <div className="mt-4">
          <OfficeQuickActions
            canManageCustomers={can(ctx.role, "customers:manage")}
            canManageJobs={can(ctx.role, "jobs:manage")}
            canDispatch={canAccessWorkspace(ctx.role, "dispatch")}
          />
        </div>
      </section>

      <OfficeScorecards scorecards={data.scorecards} />

      <OfficeAttentionSection categories={data.attentionCategories} />

      <OfficePipelineSection stages={data.pipeline} />

      <div className="grid gap-4 xl:grid-cols-2">
        <OfficeRecentCustomersSection customers={data.recentCustomers} />
        <OfficeUpcomingSection jobs={data.todayUpcoming} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <OfficeIntelligenceSection items={data.intelligence} />
        <OfficeCommunicationsSection
          items={data.communications}
          unreadThreads={data.commsSummary.unreadThreads}
          missedCallsOpen={data.commsSummary.missedCallsOpen}
        />
      </div>

      <OfficeIncomingCallSection
        highlevelConnected={data.incomingCall.highlevelConnected}
        missedCallsOpen={data.incomingCall.missedCallsOpen}
      />

      {can(ctx.role, "intelligence:view") ? (
        <AskContractorYou
          suggestions={[...OFFICE_ASK_PROMPTS, ...suggestedQuestions(ctx.role, null, "office")]}
          variant="bar"
          placeholder="What does the office need to handle today?"
        />
      ) : null}
    </div>
  );
}
