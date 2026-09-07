import Link from "next/link";
import { jobAccessFilter, requirePermission } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { loadWaitingBoard, loadWaitingDetail, loadWaitingDetails } from "@/lib/waiting/board";
import { loadWaitingMetrics } from "@/lib/waiting/metrics";
import {
  applyWaitingBoardView,
  isWaitingUpdateDueToday,
  parseWaitingFocus,
  waitingKpiHref,
} from "@/lib/waiting/focus";
import { formatMoney } from "@/lib/money";
import { customerDisplayName } from "@/lib/actions/eligibility";
import { WaitingBoard } from "@/components/waiting/waiting-board";
import { JobsSubnav } from "@/components/hub-subnav";
import type { WaitingDetailPayload } from "@/components/waiting/detail-drawer";

export default async function WaitingBoardPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    column?: string;
    owner?: string;
    tech?: string;
    overdue?: string;
    due?: string;
    record?: string;
    days?: string;
    focus?: string;
  }>;
}) {
  const ctx = await requirePermission("jobs:view");
  const params = await searchParams;
  const focus = parseWaitingFocus(params.focus);
  const [rawBoard, metrics, members] = await Promise.all([
    loadWaitingBoard(
      ctx.company.id,
      {
        q: params.q,
        ownerId: params.owner,
        technicianId: params.tech,
        minDays: params.days ? Number(params.days) : undefined,
      },
      jobAccessFilter(ctx.role, ctx.user.id)
    ),
    loadWaitingMetrics(ctx.company.id),
    prisma.membership.findMany({
      where: { companyId: ctx.company.id, status: "ACTIVE" },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    }),
  ]);

  const board = applyWaitingBoardView(rawBoard, {
    focus,
    columnId: params.column,
    overdue: params.overdue === "1",
    updateDue: params.due === "1",
  });

  const owners = members.map((row) => ({
    id: row.user.id,
    name: `${row.user.firstName} ${row.user.lastName}`.trim(),
  }));
  const assignedOnly = can(ctx.role, "jobs:assigned_only");
  const scopedMetrics = assignedOnly
    ? {
        currentlyWaiting: rawBoard.cards.length,
        waitingOnParts: rawBoard.cards.filter((card) => card.columnKey === "WAITING_ON_PART").length,
        readyToSchedule: rawBoard.cards.filter((card) => card.columnKind === "READY").length,
        overdue: rawBoard.cards.filter((card) => card.overdue).length,
        averageDaysWaiting:
          rawBoard.cards.length === 0
            ? null
            : Math.round((rawBoard.cards.reduce((sum, card) => sum + card.daysWaiting, 0) / rawBoard.cards.length) * 10) / 10,
        updatesDueToday: rawBoard.cards.filter((card) => isWaitingUpdateDueToday(card)).length,
        revenueTiedUpCents: 0,
        revenueTiedUpAvailable: false,
      }
    : metrics;
  const jobs = await prisma.job.findMany({
    where: {
      companyId: ctx.company.id,
      status: { notIn: ["COMPLETED", "CANCELED"] },
      waitingRecords: { none: { state: "ACTIVE" } },
      ...jobAccessFilter(ctx.role, ctx.user.id),
    },
    take: 40,
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      jobNumber: true,
      customer: { select: { firstName: true, lastName: true, businessName: true } },
    },
  });

  const ids = board.cards.map((card) => card.id);
  if (params.record && !ids.includes(params.record)) ids.push(params.record);
  const details: WaitingDetailPayload[] = (await loadWaitingDetails(ctx.company.id, ids)).map(serializeDetail);
  const kpiContext = { q: params.q, owner: params.owner, tech: params.tech };

  return (
    <div className="space-y-3">
      <header className="flex flex-col gap-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--cy-orange)]">Operations</p>
        <h1 className="font-display text-2xl tracking-tight text-[var(--cy-navy)] md:text-3xl">Waiting Board</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          The office shouldn&apos;t have to remember who needs an update. ContractorYou remembers.
        </p>
      </header>
      <JobsSubnav />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
        <Metric
          label="Currently waiting"
          value={String(scopedMetrics.currentlyWaiting)}
          href={waitingKpiHref("waiting", kpiContext)}
          active={focus === "waiting"}
          count={scopedMetrics.currentlyWaiting}
        />
        <Metric
          label="Waiting on parts"
          value={String(scopedMetrics.waitingOnParts)}
          href={waitingKpiHref("parts", kpiContext)}
          active={focus === "parts"}
          count={scopedMetrics.waitingOnParts}
        />
        <Metric
          label="Ready to schedule"
          value={String(scopedMetrics.readyToSchedule)}
          href={waitingKpiHref("ready", kpiContext)}
          active={focus === "ready"}
          count={scopedMetrics.readyToSchedule}
        />
        <Metric
          label="Overdue"
          value={String(scopedMetrics.overdue)}
          warn={scopedMetrics.overdue > 0}
          href={waitingKpiHref("overdue", kpiContext)}
          active={focus === "overdue"}
          count={scopedMetrics.overdue}
        />
        <Metric
          label="Average days waiting"
          value={scopedMetrics.averageDaysWaiting == null ? "—" : String(scopedMetrics.averageDaysWaiting)}
        />
        <Metric
          label="Updates due today"
          value={String(scopedMetrics.updatesDueToday)}
          href={waitingKpiHref("due", kpiContext)}
          active={focus === "due"}
          count={scopedMetrics.updatesDueToday}
        />
        <Metric
          label="Revenue tied up"
          value={
            scopedMetrics.revenueTiedUpAvailable ? formatMoney(scopedMetrics.revenueTiedUpCents) : "No linked amounts"
          }
        />
      </div>

      <WaitingBoard
        columns={board.columns.map((column) => ({
          id: column.id,
          key: column.key,
          name: column.name,
          kind: column.kind,
          cards: column.cards,
        }))}
        timezone={ctx.company.timezone}
        owners={owners}
        jobs={jobs.map((job) => ({
          id: job.id,
          jobNumber: job.jobNumber,
          label: customerDisplayName(job.customer),
        }))}
        details={details}
        initialRecordId={params.record}
        filters={{
          q: params.q,
          column: params.column,
          owner: params.owner,
          overdue: params.overdue === "1",
          due: params.due === "1",
          focus,
        }}
      />
    </div>
  );
}

function Metric({
  label,
  value,
  warn,
  href,
  active,
  count,
}: {
  label: string;
  value: string;
  warn?: boolean;
  href?: string;
  active?: boolean;
  count?: number;
}) {
  const actionable = Boolean(href);
  const disabled = actionable && (count ?? 0) === 0;
  const className = [
    "rounded-xl border bg-white px-3 py-2.5 text-left",
    warn ? "border-rose-200" : "border-[var(--border)]",
    active ? "border-[var(--cy-orange)]/55 ring-1 ring-[var(--cy-orange)]/30" : "",
    actionable && !disabled
      ? "cursor-pointer hover:border-[var(--cy-orange)]/45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cy-navy)]"
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const body = (
    <>
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">{label}</p>
      <p className={`mt-0.5 truncate text-lg font-semibold ${warn ? "text-rose-700" : "text-[var(--cy-navy)]"}`}>{value}</p>
    </>
  );

  if (href && !disabled) {
    return (
      <Link href={href} className={className} aria-current={active ? "page" : undefined}>
        {body}
      </Link>
    );
  }

  return (
    <div className={className} aria-disabled={disabled || undefined}>
      {body}
    </div>
  );
}

function serializeDetail(row: NonNullable<Awaited<ReturnType<typeof loadWaitingDetail>>>): WaitingDetailPayload {
  return {
    id: row.id,
    jobId: row.jobId,
    customerId: row.customerId,
    reason: row.reason,
    notes: row.notes,
    enteredAt: row.enteredAt.toISOString(),
    expectedResolutionAt: row.expectedResolutionAt?.toISOString() ?? null,
    lastCustomerUpdateAt: row.lastCustomerUpdateAt?.toISOString() ?? null,
    nextCustomerUpdateAt: row.nextCustomerUpdateAt?.toISOString() ?? null,
    actualArrivalAt: row.actualArrivalAt?.toISOString() ?? null,
    customerRepliedAt: row.customerRepliedAt?.toISOString() ?? null,
    communicationEnabled: row.communicationEnabled,
    automationEnabled: row.automationEnabled,
    cadence: row.cadence,
    customCadenceDays: row.customCadenceDays,
    lastCommunicationStatus: row.lastCommunicationStatus,
    lastCommunicationError: row.lastCommunicationError,
    assignedOwnerUserId: row.assignedOwnerUserId,
    metadata: row.metadata,
    column: { id: row.column.id, key: row.column.key, name: row.column.name, kind: row.column.kind },
    customer: row.customer,
    job: { jobNumber: row.job.jobNumber, status: row.job.status },
    property: row.property,
    assignedOwner: row.assignedOwner,
    transitions: row.transitions.map((transition) => ({
      id: transition.id,
      createdAt: transition.createdAt.toISOString(),
      note: transition.note,
      fromColumn: transition.fromColumn,
      toColumn: transition.toColumn,
      actor: transition.actor,
    })),
    communications: row.communications.map((communication) => ({
      id: communication.id,
      kind: communication.kind,
      sentAt: communication.sentAt?.toISOString() ?? null,
      failedAt: communication.failedAt?.toISOString() ?? null,
      attemptedAt: communication.attemptedAt.toISOString(),
      failureReason: communication.failureReason,
      provider: communication.provider,
      body: communication.body,
    })),
  };
}
