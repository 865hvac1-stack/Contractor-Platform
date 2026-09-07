import { jobAccessFilter, requirePermission } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { loadWaitingBoard, loadWaitingDetail, loadWaitingDetails } from "@/lib/waiting/board";
import { loadWaitingMetrics } from "@/lib/waiting/metrics";
import { formatMoney } from "@/lib/money";
import { customerDisplayName } from "@/lib/actions/eligibility";
import { WaitingBoard } from "@/components/waiting/waiting-board";
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
  }>;
}) {
  const ctx = await requirePermission("jobs:view");
  const params = await searchParams;
  const [board, metrics, members] = await Promise.all([
    loadWaitingBoard(
      ctx.company.id,
      {
        q: params.q,
        columnId: params.column,
        ownerId: params.owner,
        technicianId: params.tech,
        overdue: params.overdue === "1",
        updateDue: params.due === "1",
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

  const owners = members.map((row) => ({
    id: row.user.id,
    name: `${row.user.firstName} ${row.user.lastName}`.trim(),
  }));
  const assignedOnly = can(ctx.role, "jobs:assigned_only");
  const scopedMetrics = assignedOnly
    ? {
        currentlyWaiting: board.cards.length,
        waitingOnParts: board.cards.filter((card) => card.columnKey === "WAITING_ON_PART").length,
        readyToSchedule: board.cards.filter((card) => card.columnKind === "READY").length,
        overdue: board.cards.filter((card) => card.overdue).length,
        averageDaysWaiting:
          board.cards.length === 0
            ? null
            : Math.round((board.cards.reduce((sum, card) => sum + card.daysWaiting, 0) / board.cards.length) * 10) / 10,
        updatesDueToday: board.cards.filter((card) => card.nextCustomerUpdateAt).length,
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

  return (
    <div className="space-y-3">
      <header className="flex flex-col gap-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--cy-orange)]">Operations</p>
        <h1 className="font-display text-2xl tracking-tight text-[var(--cy-navy)] md:text-3xl">Waiting Board</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          The office shouldn&apos;t have to remember who needs an update. ContractorYou remembers.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
        <Metric label="Currently waiting" value={String(scopedMetrics.currentlyWaiting)} />
        <Metric label="Waiting on parts" value={String(scopedMetrics.waitingOnParts)} />
        <Metric label="Ready to schedule" value={String(scopedMetrics.readyToSchedule)} />
        <Metric label="Overdue" value={String(scopedMetrics.overdue)} warn={scopedMetrics.overdue > 0} />
        <Metric label="Average days waiting" value={scopedMetrics.averageDaysWaiting == null ? "—" : String(scopedMetrics.averageDaysWaiting)} />
        <Metric label="Updates due today" value={String(scopedMetrics.updatesDueToday)} />
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
        }}
      />
    </div>
  );
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-white px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">{label}</p>
      <p className={`mt-0.5 truncate text-lg font-semibold ${warn ? "text-rose-700" : "text-[var(--cy-navy)]"}`}>{value}</p>
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
