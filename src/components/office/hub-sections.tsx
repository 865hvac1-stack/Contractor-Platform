import type { ReactNode } from "react";
import Link from "next/link";
import { format, formatDistanceToNow } from "date-fns";
import {
  Briefcase,
  CalendarDays,
  ChevronRight,
  Inbox,
  Mail,
  MessageSquare,
  Phone,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { OfficeMetricCard } from "@/components/office/metric-card";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import type {
  OfficeCommunicationItem,
  OfficeRecentCustomer,
  OfficeScorecard,
  OfficeUpcomingJob,
} from "@/lib/office/hub";
import type { OfficeAttentionCategory, OfficeAttentionTone } from "@/lib/office/attention-categories";
import type { OfficeIntelligenceItem } from "@/lib/office/intelligence";
import type { OfficePipelineStage } from "@/lib/office/pipeline";

const ATTENTION_BAR: Record<OfficeAttentionTone, string> = {
  opportunity: "bg-[var(--cy-orange)]",
  schedule: "bg-slate-500",
  money: "bg-amber-500",
  urgent: "bg-red-500",
  neutral: "bg-[var(--cy-navy)]",
};

const cardHover =
  "transition-[border-color,box-shadow,background-color] duration-200 hover:border-[var(--cy-navy)]/20 hover:bg-white hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cy-orange)]/40 motion-reduce:transition-none";

function SectionEyebrow({ children, accent = false }: { children: ReactNode; accent?: boolean }) {
  return (
    <p
      className={cn(
        "text-[11px] font-semibold uppercase tracking-[0.16em]",
        accent ? "text-[var(--cy-orange)]" : "text-[var(--cy-text-muted)]"
      )}
    >
      {children}
    </p>
  );
}

function customerInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "CU";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1]?.[0] ?? ""}`.toUpperCase();
}

function compactOpportunity(cents: number) {
  const dollars = Math.round(cents / 100);
  if (dollars >= 1000) return `$${Math.round(dollars / 1000)}K OPPORTUNITY`;
  return `${formatMoney(cents)} OPPORTUNITY`;
}

function jobStatusPresentation(job: OfficeUpcomingJob, now = new Date()) {
  if (job.status === "COMPLETED") return { label: "Completed", className: "bg-emerald-50 text-emerald-800" };
  if (job.status === "IN_PROGRESS") return { label: "In progress", className: "bg-teal-50 text-teal-800" };
  if (job.status === "CANCELED") return { label: "Canceled", className: "bg-stone-100 text-stone-500" };
  const end = job.scheduledEnd ?? job.scheduledStart;
  if (end && end.getTime() < now.getTime() && (job.status === "SCHEDULED" || job.status === "DISPATCHED")) {
    return { label: "Running late", className: "bg-rose-50 text-rose-800" };
  }
  if (job.status === "DISPATCHED") return { label: "Dispatched", className: "bg-indigo-50 text-indigo-800" };
  return { label: "Upcoming", className: "bg-slate-100 text-slate-700" };
}

function communicationIcon(channel: string) {
  const value = channel.toUpperCase();
  if (value.includes("CALL") || value.includes("VOICE")) return Phone;
  if (value.includes("EMAIL") || value.includes("MAIL")) return Mail;
  return MessageSquare;
}

export function OfficeScorecards({ scorecards }: { scorecards: OfficeScorecard[] }) {
  if (scorecards.length === 0) {
    return (
      <section className="rounded-2xl border border-dashed border-[var(--border)] bg-white px-5 py-6">
        <SectionEyebrow>Today&apos;s front office</SectionEyebrow>
        <h2 className="mt-1 text-lg font-semibold tracking-tight text-[var(--cy-navy)]">No activity yet</h2>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          Metrics appear only from verified ContractorYou data.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div>
        <SectionEyebrow>Today&apos;s front office</SectionEyebrow>
        <h2 className="mt-1 text-lg font-semibold tracking-tight text-[var(--cy-navy)]">Workload at a glance</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Verified counts with explicit time windows — never estimated.
        </p>
      </div>
      <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-1 md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 xl:grid-cols-3 2xl:grid-cols-4">
        {scorecards.map((scorecard) => (
          <OfficeMetricCard key={scorecard.label} {...scorecard} />
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
      ? { label: "New customer", short: "Customer", href: "/office/customers/new", primary: true, icon: UserPlus }
      : null,
    canManageJobs
      ? { label: "New job", short: "Job", href: "/office/jobs/new", primary: true, icon: Briefcase }
      : null,
    canDispatch
      ? { label: "Schedule", short: "Schedule", href: "/dispatch", primary: false, icon: CalendarDays }
      : { label: "Schedule", short: "Schedule", href: "/schedule", primary: false, icon: CalendarDays },
    { label: "Inbox", short: "Inbox", href: "/marketing/communications", primary: false, icon: Inbox },
  ].filter(Boolean) as {
    label: string;
    short: string;
    href: string;
    primary: boolean;
    icon: typeof UserPlus;
  }[];

  return (
    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <Link
            key={action.label}
            href={action.href}
            className={cn(
              buttonVariants({ variant: action.primary ? "default" : "outline" }),
              "min-h-11 justify-center rounded-full px-4 text-sm font-semibold"
            )}
          >
            <Icon className="size-4" aria-hidden />
            <span className="sm:hidden">
              {action.primary ? "+" : ""} {action.short}
            </span>
            <span className="hidden sm:inline">
              {action.primary ? "+ " : ""}
              {action.label}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

export function OfficeAttentionSection({
  categories,
}: {
  categories: OfficeAttentionCategory[];
}) {
  if (categories.length === 0) {
    return (
      <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
        <SectionEyebrow accent>Needs your attention</SectionEyebrow>
        <h2 className="mt-1 text-lg font-semibold tracking-tight text-[var(--cy-navy)]">Work queue is clear</h2>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">Nothing needs office follow-up right now.</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <SectionEyebrow accent>Needs your attention</SectionEyebrow>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-[var(--cy-navy)]">Act on the highest-value work</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Summary only. Open Action Center for the individual work queue.
          </p>
        </div>
        <Link
          href="/attention"
          className="text-sm font-medium text-[var(--cy-orange)] transition-transform duration-200 hover:translate-x-0.5 motion-reduce:transform-none"
        >
          Action Center →
        </Link>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {categories.map((category) => (
          <Link
            key={category.id}
            href={category.href}
            className={cn(
              "group relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--cy-gray)]/50 p-4",
              cardHover
            )}
          >
            <span className={cn("absolute inset-x-0 top-0 h-0.5", ATTENTION_BAR[category.tone])} aria-hidden />
            {category.signal ? (
              <span
                className={cn(
                  "mb-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]",
                  category.signal === "high"
                    ? "bg-rose-50 text-rose-800"
                    : "bg-[var(--cy-orange-muted)] text-[#9A3412]"
                )}
              >
                {category.signal === "high"
                  ? "High priority"
                  : category.amountCents
                    ? compactOpportunity(category.amountCents)
                    : "Opportunity"}
              </span>
            ) : null}
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--cy-navy)]">
              {category.label}
            </p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-[var(--cy-navy)]">
              {category.id === "overdue_invoices"
                ? `${category.count} invoice${category.count === 1 ? "" : "s"}`
                : `${category.customerCount} customer${category.customerCount === 1 ? "" : "s"}`}
            </p>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {category.amountCents != null
                ? category.id === "overdue_invoices"
                  ? `${formatMoney(category.amountCents)} overdue`
                  : `${formatMoney(category.amountCents)} opportunity`
                : category.summary}
            </p>
            <span className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-[var(--cy-orange)]">
              {category.actionLabel}
              <span className="ml-1 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transform-none">
                →
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function OfficePipelineSection({ stages }: { stages: OfficePipelineStage[] }) {
  if (stages.length === 0 || stages.every((stage) => stage.count === 0)) return null;

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
      <SectionEyebrow>Front office pipeline</SectionEyebrow>
      <h2 className="mt-1 text-lg font-semibold tracking-tight text-[var(--cy-navy)]">Where work sits today</h2>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">
        Lead → booked → follow-up → approved → payment. Click a stage to open the work.
      </p>
      <div className="mt-4 flex items-stretch gap-1 overflow-x-auto pb-1">
        {stages.map((stage, index) => (
          <div key={stage.id} className="flex min-w-0 shrink-0 items-center gap-1">
            <Link
              href={stage.href}
              className={cn(
                "min-w-[8.5rem] rounded-2xl border border-[var(--border)] bg-[var(--cy-gray)]/50 px-3 py-3",
                cardHover,
                stage.count === 0 && "opacity-60"
              )}
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--cy-text-muted)]">
                {stage.label}
              </p>
              <p className="mt-2 text-xl font-semibold tabular-nums text-[var(--cy-navy)]">{stage.count}</p>
            </Link>
            {index < stages.length - 1 ? (
              <ChevronRight className="hidden size-4 shrink-0 text-[var(--cy-text-muted)] sm:block" aria-hidden />
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

export function OfficeRecentCustomersSection({ customers }: { customers: OfficeRecentCustomer[] }) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <SectionEyebrow>Recent customers</SectionEyebrow>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-[var(--cy-navy)]">Just worked</h2>
        </div>
        <Link href="/customers" className="text-sm font-medium text-[var(--cy-orange)]">
          View all →
        </Link>
      </div>
      {customers.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--muted-foreground)]">No customers yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-[var(--border)]">
          {customers.map((customer) => (
            <li key={customer.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-start gap-3">
                <Link
                  href={`/office/customers/${customer.id}`}
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--cy-navy)] text-[11px] font-semibold text-white"
                  aria-hidden
                >
                  {customerInitials(customer.name)}
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-0.5">
                      <Link
                        href={`/office/customers/${customer.id}`}
                        className="block font-semibold text-[var(--cy-navy)] hover:underline"
                      >
                        {customer.name}
                      </Link>
                      {customer.property ? (
                        <Link
                          href={`/office/customers/${customer.id}?propertyId=${customer.property.id}`}
                          className="block truncate text-sm text-[var(--muted-foreground)] hover:text-[var(--cy-navy)] hover:underline"
                        >
                          {customer.property.label}
                        </Link>
                      ) : null}
                      {customer.context ? (
                        <Link
                          href={customer.context.href}
                          className="block truncate text-sm text-[var(--cy-text-secondary)] hover:text-[var(--cy-navy)] hover:underline"
                        >
                          {customer.context.text}
                        </Link>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      {customer.phone ? (
                        <a
                          href={`tel:${customer.phone.replace(/[^\d+]/g, "")}`}
                          className="inline-flex min-h-9 items-center gap-1 rounded-full border border-[var(--border)] bg-white px-2.5 text-xs font-medium text-[var(--cy-navy)] transition-colors duration-200 hover:border-[var(--cy-navy)]/20"
                        >
                          <Phone className="size-3.5" aria-hidden />
                          Call
                        </a>
                      ) : null}
                      {customer.phone ? (
                        <Link
                          href={`/marketing/communications?compose=1&customerId=${customer.id}&to=${encodeURIComponent(customer.phone)}`}
                          className="inline-flex min-h-9 items-center gap-1 rounded-full border border-[var(--border)] bg-white px-2.5 text-xs font-medium text-[var(--cy-navy)] transition-colors duration-200 hover:border-[var(--cy-navy)]/20"
                        >
                          <MessageSquare className="size-3.5" aria-hidden />
                          Text
                        </Link>
                      ) : null}
                      {customer.membership ? (
                        <Link
                          href={customer.membership.href}
                          className="rounded-full bg-[var(--cy-orange-muted)] px-2.5 py-1 text-[11px] font-medium text-[#9A3412]"
                        >
                          {customer.membership.planName}
                        </Link>
                      ) : null}
                    </div>
                  </div>
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
        <div>
          <SectionEyebrow>Today / upcoming</SectionEyebrow>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-[var(--cy-navy)]">On the board</h2>
        </div>
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
            const status = jobStatusPresentation(job);
            return (
              <li key={job.id} className="rounded-xl border border-[var(--border)] px-3 py-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold tabular-nums text-[var(--cy-navy)]">{timeLabel}</p>
                      <span className={cn("inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", status.className)}>
                        {status.label}
                      </span>
                    </div>
                    <Link href={`/office/customers/${job.customer.id}`} className="block font-semibold text-[var(--cy-navy)] hover:underline">
                      {job.customer.name}
                    </Link>
                    <Link href={`/jobs/${job.id}`} className="block text-sm text-[var(--cy-text-secondary)] hover:underline">
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
                    className="inline-flex min-h-11 shrink-0 items-center text-sm font-medium text-[var(--cy-orange)] hover:underline"
                  >
                    Open dispatch →
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
          <SectionEyebrow>Communications</SectionEyebrow>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-[var(--cy-navy)]">Recent conversations</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {[
              unreadThreads > 0 ? `${unreadThreads} unread` : null,
              missedCallsOpen > 0 ? `${missedCallsOpen} missed calls` : null,
            ]
              .filter(Boolean)
              .join(" · ") || "From HighLevel sync — unread only when recorded"}
          </p>
        </div>
        <Link href="/marketing/communications" className="text-sm font-medium text-[var(--cy-orange)]">
          Inbox →
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--muted-foreground)]">
          No conversations stored yet. Connect HighLevel and sync communications to populate the inbox.
        </p>
      ) : (
        <ul className="mt-4 space-y-1">
          {items.map((item) => {
            const Icon = communicationIcon(item.channel);
            return (
              <li key={item.id} className="flex min-h-11 items-start gap-3 rounded-xl px-2 py-2 transition-colors duration-200 hover:bg-[var(--cy-gray)]">
                <Link href={item.href} className="flex min-w-0 flex-1 items-start gap-3">
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--cy-gray)] text-[var(--cy-navy)]">
                    <Icon className="size-3.5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-semibold text-[var(--cy-navy)]">{item.name}</span>
                      {item.unread ? (
                        <span className="size-1.5 shrink-0 rounded-full bg-[var(--cy-orange)]" aria-label="Unread" />
                      ) : null}
                    </span>
                    {item.preview ? (
                      <span className="mt-0.5 block truncate text-sm text-[var(--muted-foreground)]">{item.preview}</span>
                    ) : null}
                  </span>
                </Link>
                <span className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
                  <span className="text-[11px] text-[var(--cy-text-muted)]">
                    {formatDistanceToNow(item.lastActivityAt, { addSuffix: true })}
                  </span>
                  {item.customerId ? (
                    <Link
                      href={`/office/customers/${item.customerId}`}
                      className="text-[11px] font-medium text-[var(--cy-orange)] hover:underline"
                    >
                      Customer
                    </Link>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function OfficeIntelligenceSection({ items }: { items: OfficeIntelligenceItem[] }) {
  if (items.length === 0) {
    return (
      <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-[var(--cy-orange)]" aria-hidden />
          <SectionEyebrow accent>ContractorYou Intelligence</SectionEyebrow>
        </div>
        <h2 className="mt-1 text-lg font-semibold tracking-tight text-[var(--cy-navy)]">Front office intelligence</h2>
        <p className="mt-3 text-sm text-[var(--muted-foreground)]">
          Observations appear when verified front-office data supports them.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-[var(--cy-orange)]" aria-hidden />
        <SectionEyebrow accent>ContractorYou Intelligence</SectionEyebrow>
      </div>
      <h2 className="mt-1 text-lg font-semibold tracking-tight text-[var(--cy-navy)]">What needs a decision</h2>
      <ul className="mt-4 space-y-3">
        {items.map((item) => (
          <li key={item.id} className="rounded-xl bg-[var(--cy-gray)] px-3 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--cy-orange)]">{item.label}</p>
            <p className="mt-1 text-sm text-[var(--cy-navy)]">{item.summary}</p>
            <div className="mt-2 flex flex-wrap gap-3">
              <Link href={item.href} className="text-sm font-medium text-[var(--cy-orange)] hover:underline">
                {item.actionLabel} →
              </Link>
              <Link
                href={`/intelligence?ask=${encodeURIComponent(item.askQuestion)}`}
                className="text-sm text-[var(--muted-foreground)] hover:text-[var(--cy-navy)] hover:underline"
              >
                Ask why
              </Link>
            </div>
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
    <section className="rounded-2xl border border-[var(--border)] bg-white px-4 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[var(--cy-navy)]">
          <span className="mr-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--cy-orange)]">
            Incoming call
          </span>
          No active call.
          <span className="ml-1 text-[var(--muted-foreground)]">
            HighLevel {highlevelConnected ? "connected" : "not connected"}.
          </span>
        </p>
        {missedCallsOpen > 0 ? (
          <Link href="/marketing/communications?filter=missed" className="text-sm font-medium text-[var(--cy-orange)] hover:underline">
            {missedCallsOpen} missed call{missedCallsOpen === 1 ? "" : "s"} →
          </Link>
        ) : null}
      </div>
    </section>
  );
}
