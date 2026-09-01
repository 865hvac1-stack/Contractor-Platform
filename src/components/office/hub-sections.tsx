import Link from "next/link";
import { format } from "date-fns";
import { KpiCard } from "@/components/kpi-card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AttentionCardActions } from "@/components/attention-card-actions";
import type {
  OfficeCommunicationItem,
  OfficeRecentCustomer,
  OfficeScorecard,
  OfficeUpcomingJob,
} from "@/lib/office/hub";
import type { RankedAttention } from "@/lib/attention-priority";
import type { OfficeAttentionCategory } from "@/lib/office/attention-categories";
import type { OfficeIntelligenceItem } from "@/lib/office/intelligence";
import type { OfficePipelineStage } from "@/lib/office/pipeline";

export function OfficeScorecards({ scorecards }: { scorecards: OfficeScorecard[] }) {
  if (scorecards.length === 0) {
    return (
      <section className="rounded-2xl border border-dashed border-[var(--border)] bg-white px-5 py-6">
        <h2 className="text-lg font-semibold tracking-tight text-[var(--cy-navy)]">Today&apos;s front office</h2>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          No front-office activity recorded yet today. Metrics appear only from verified ContractorYou data.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-[var(--cy-navy)]">Today&apos;s front office</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">Verified counts from today&apos;s office workload.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {scorecards.map((scorecard) => (
          <KpiCard key={scorecard.label} {...scorecard} />
        ))}
      </div>
    </section>
  );
}

export function OfficeQuickActions({
  canManageCustomers,
  canManageJobs,
  canDispatch,
}: {
  canManageCustomers: boolean;
  canManageJobs: boolean;
  canDispatch: boolean;
}) {
  const actions = [
    canManageCustomers
      ? { label: "+ New customer", href: "/office/customers/new", primary: true }
      : null,
    canManageJobs ? { label: "+ New job", href: "/office/jobs/new", primary: true } : null,
    canDispatch
      ? { label: "Schedule", href: "/dispatch", primary: false }
      : { label: "Schedule", href: "/schedule", primary: false },
    { label: "Inbox", href: "/marketing/communications", primary: false },
  ].filter(Boolean) as { label: string; href: string; primary: boolean }[];

  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((action) => (
        <Link
          key={action.label}
          href={action.href}
          className={cn(
            buttonVariants({ variant: action.primary ? "default" : "outline" }),
            "min-h-11 rounded-full px-4"
          )}
        >
          {action.label}
        </Link>
      ))}
    </div>
  );
}

export function OfficeAttentionSection({
  categories,
  items = [],
}: {
  categories: OfficeAttentionCategory[];
  items?: RankedAttention[];
}) {
  if (categories.length === 0) {
    return (
      <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
        <h2 className="text-lg font-semibold tracking-tight text-[var(--cy-navy)]">Needs your attention</h2>
        <p className="mt-3 text-sm text-[var(--muted-foreground)]">Nothing needs office follow-up right now.</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-[var(--cy-navy)]">Needs your attention</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Summarized from the same needs-attention engine — not a duplicate queue.
          </p>
        </div>
        <Link href="/attention" className="text-sm font-medium text-[var(--cy-orange)]">
          View all →
        </Link>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {categories.map((category) => (
          <Link
            key={category.id}
            href={category.href}
            className="group rounded-2xl border border-[var(--border)] bg-[var(--cy-gray)]/40 p-4 transition hover:border-[var(--cy-navy)]/15 hover:bg-white hover:shadow-sm"
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--cy-orange)]">
              {category.label}
            </p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-[var(--cy-navy)]">{category.count}</p>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">{category.summary}</p>
            <span className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-[var(--cy-orange)] group-hover:underline">
              {category.actionLabel} →
            </span>
          </Link>
        ))}
      </div>
      {items.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-xl bg-[var(--cy-gray)]/70 px-4 py-3">
              <Link href={item.href} className="block">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--cy-orange)]">
                  {item.title}
                </p>
                <p className="mt-1 text-sm text-[var(--cy-navy)]">{item.description}</p>
              </Link>
              <AttentionCardActions type={item.type} entityId={item.entityId} href={item.href} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function OfficePipelineSection({ stages }: { stages: OfficePipelineStage[] }) {
  if (stages.length === 0) return null;

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
      <h2 className="text-lg font-semibold tracking-tight text-[var(--cy-navy)]">Front office pipeline</h2>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">
        Workload view from existing leads, estimates, and invoices.
      </p>
      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {stages.map((stage) => (
          <Link
            key={stage.id}
            href={stage.href}
            className="min-w-[9.5rem] shrink-0 rounded-2xl border border-[var(--border)] bg-[var(--cy-gray)]/50 px-4 py-3 transition hover:border-[var(--cy-navy)]/15 hover:bg-white"
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">
              {stage.label}
            </p>
            <p className="mt-2 text-xl font-semibold tabular-nums text-[var(--cy-navy)]">{stage.count}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function OfficeRecentCustomersSection({ customers }: { customers: OfficeRecentCustomer[] }) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-[var(--cy-navy)]">Recent customers</h2>
        <Link href="/customers" className="text-sm font-medium text-[var(--cy-orange)]">
          View all customers →
        </Link>
      </div>
      {customers.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--muted-foreground)]">No customers yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-[var(--border)]">
          {customers.map((customer) => (
            <li key={customer.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <Link
                    href={`/office/customers/${customer.id}`}
                    className="block font-medium text-[var(--cy-navy)] hover:underline"
                  >
                    {customer.name}
                  </Link>
                  {customer.property ? (
                    <Link
                      href={`/office/customers/${customer.id}?propertyId=${customer.property.id}`}
                      className="block text-sm text-[var(--muted-foreground)] hover:text-[var(--cy-navy)] hover:underline"
                    >
                      {customer.property.label}
                    </Link>
                  ) : null}
                  {customer.context ? (
                    <Link href={customer.context.href} className="block text-sm text-[var(--cy-orange)] hover:underline">
                      {customer.context.text}
                    </Link>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {customer.phone ? (
                    <a
                      href={`tel:${customer.phone.replace(/[^\d+]/g, "")}`}
                      className="rounded-full bg-[var(--cy-navy)] px-3 py-1.5 text-xs font-medium text-white"
                    >
                      Call
                    </a>
                  ) : null}
                  {customer.phone ? (
                    <a
                      href={`sms:${customer.phone.replace(/[^\d+]/g, "")}`}
                      className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-medium"
                    >
                      Text
                    </a>
                  ) : null}
                  {customer.membership ? (
                    <Link
                      href={customer.membership.href}
                      className="rounded-full bg-[var(--cy-orange-muted)] px-3 py-1 text-xs font-medium text-[#9A3412]"
                    >
                      {customer.membership.planName}
                    </Link>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function OfficeUpcomingSection({ jobs }: { jobs: OfficeUpcomingJob[] }) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-[var(--cy-navy)]">Today / upcoming</h2>
        <Link href="/dispatch" className="text-sm font-medium text-[var(--cy-orange)]">
          Dispatch →
        </Link>
      </div>
      {jobs.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--muted-foreground)]">Nothing scheduled for today.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {jobs.map((job) => {
            const timeLabel =
              job.scheduledStart && job.scheduledEnd
                ? `${format(job.scheduledStart, "h:mm")}–${format(job.scheduledEnd, "h:mm a")}`
                : job.scheduledStart
                  ? format(job.scheduledStart, "h:mm a")
                  : "TBD";
            return (
              <li key={job.id} className="rounded-xl border border-[var(--border)] px-3 py-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                      {timeLabel}
                    </p>
                    <Link href={`/office/customers/${job.customer.id}`} className="font-medium text-[var(--cy-navy)] hover:underline">
                      {job.customer.name}
                    </Link>
                    <Link href={`/jobs/${job.id}`} className="block text-sm text-[var(--cy-navy)] hover:underline">
                      {job.jobType || job.jobNumber}
                    </Link>
                    {job.property ? (
                      <Link
                        href={`/office/customers/${job.customer.id}?propertyId=${job.property.id}`}
                        className="block text-sm text-[var(--muted-foreground)] hover:underline"
                      >
                        {job.property.label}
                      </Link>
                    ) : null}
                    {job.technician ? (
                      <Link href="/team" className="block text-sm text-[var(--muted-foreground)] hover:underline">
                        {job.technician.name}
                      </Link>
                    ) : (
                      <Link href={job.dispatchHref} className="block text-sm text-[var(--cy-orange)] hover:underline">
                        Unassigned · Dispatch
                      </Link>
                    )}
                  </div>
                  <Link
                    href={job.dispatchHref}
                    className="shrink-0 text-xs font-medium text-[var(--cy-orange)] hover:underline"
                  >
                    Open dispatch
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function OfficeCommunicationsSection({
  items,
  unreadThreads,
  missedCallsOpen,
}: {
  items: OfficeCommunicationItem[];
  unreadThreads: number;
  missedCallsOpen: number;
}) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-[var(--cy-navy)]">Communications</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {[
              unreadThreads > 0 ? `${unreadThreads} unread` : null,
              missedCallsOpen > 0 ? `${missedCallsOpen} missed calls` : null,
            ]
              .filter(Boolean)
              .join(" · ") || "Recent conversations from HighLevel sync"}
          </p>
        </div>
        <Link href="/marketing/communications" className="text-sm font-medium text-[var(--cy-orange)]">
          View inbox →
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--muted-foreground)]">
          No conversations stored yet. Connect HighLevel and sync communications to populate the inbox.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {items.map((item) => (
            <li key={item.id} className="flex min-h-11 items-start justify-between gap-3 rounded-xl px-2 py-2 hover:bg-[var(--cy-gray)]">
              <Link href={item.href} className="min-w-0 flex-1">
                <p className="truncate font-medium text-[var(--cy-navy)]">
                  {item.unread ? "● " : ""}
                  {item.name}
                </p>
                {item.preview ? (
                  <p className="truncate text-sm text-[var(--muted-foreground)]">{item.preview}</p>
                ) : null}
              </Link>
              {item.customerId ? (
                <Link href={`/office/customers/${item.customerId}`} className="shrink-0 text-xs text-[var(--cy-orange)] hover:underline">
                  Customer
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function OfficeIntelligenceSection({ items }: { items: OfficeIntelligenceItem[] }) {
  if (items.length === 0) {
    return (
      <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
        <h2 className="text-lg font-semibold tracking-tight text-[var(--cy-navy)]">Front office intelligence</h2>
        <p className="mt-3 text-sm text-[var(--muted-foreground)]">
          Observations appear when verified front-office data supports them.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
      <h2 className="text-lg font-semibold tracking-tight text-[var(--cy-navy)]">Front office intelligence</h2>
      <ul className="mt-4 space-y-3">
        {items.map((item) => (
          <li key={item.id} className="rounded-xl bg-[var(--cy-gray)] px-3 py-3">
            <Link href={item.href} className="block transition hover:opacity-90">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--cy-orange)]">
                {item.label}
              </p>
              <p className="mt-1 text-sm text-[var(--cy-navy)]">{item.summary}</p>
              <p className="mt-2 text-xs font-medium text-[var(--cy-orange)]">{item.actionLabel} →</p>
            </Link>
            <Link
              href={`/intelligence?ask=${encodeURIComponent(item.askQuestion)}`}
              className="mt-2 inline-block text-xs text-[var(--muted-foreground)] hover:text-[var(--cy-navy)] hover:underline"
            >
              Ask why
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function OfficeIncomingCallSection({
  highlevelConnected,
  missedCallsOpen,
}: {
  highlevelConnected: boolean;
  missedCallsOpen: number;
}) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--cy-orange)]">
            Incoming call
          </p>
          <p className="mt-1 text-sm font-medium text-[var(--cy-navy)]">No active call</p>
          <p className="text-xs text-[var(--muted-foreground)]">
            HighLevel {highlevelConnected ? "connected" : "not connected"}. Inbound calls are not simulated here.
          </p>
        </div>
        {missedCallsOpen > 0 ? (
          <Link href="/marketing/communications?filter=missed" className="text-sm font-medium text-[var(--cy-orange)] hover:underline">
            {missedCallsOpen} missed call{missedCallsOpen === 1 ? "" : "s"} →
          </Link>
        ) : null}
      </div>
    </section>
  );
}
