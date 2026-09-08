import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { listCompanyMaintenance } from "@/lib/scheduling/maintenance";
import { formatClockMinutes, formatLocalDateShort } from "@/lib/scheduling/time";
import { StatusBadge } from "@/components/status-badge";
import type { MaintenanceVisitStatus } from "@prisma/client";

const FILTERS: Array<{ id: string; label: string; status?: MaintenanceVisitStatus | "ALL" }> = [
  { id: "due-soon", label: "Due Soon", status: "DUE_SOON" },
  { id: "unscheduled", label: "Unscheduled", status: "UNSCHEDULED" },
  { id: "scheduled", label: "Scheduled", status: "SCHEDULED" },
  { id: "overdue", label: "Overdue", status: "OVERDUE" },
  { id: "completed", label: "Completed", status: "COMPLETED" },
];

export default async function MaintenanceWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const ctx = await requirePermission("memberships:view");
  const params = await searchParams;
  const current = FILTERS.find((item) => item.id === params.status) ?? FILTERS[0];
  const visits = await listCompanyMaintenance(ctx.company.id, current.status);

  return (
    <div className="space-y-5 pb-10">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">Operations</p>
        <h1 className="mt-1 font-display text-3xl tracking-tight">Maintenance</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Upcoming maintenance workload from real membership plans. Schedule uses the same availability engine as
          conversations.
        </p>
      </div>
      <div className="flex gap-2 overflow-x-auto">
        {FILTERS.map((filter) => (
          <Link
            key={filter.id}
            href={`/maintenance?status=${filter.id}`}
            className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-sm ${
              current.id === filter.id
                ? "border-[var(--cy-navy)] bg-[var(--cy-navy)] text-white"
                : "border-[var(--border)] bg-white"
            }`}
          >
            {filter.label}
          </Link>
        ))}
      </div>
      {visits.length === 0 ? (
        <p className="rounded-2xl border border-[var(--border)] bg-white px-4 py-8 text-sm text-[var(--muted-foreground)]">
          No maintenance visits in this status. Active memberships generate visits from plan cadence — nothing is invented.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-white">
          <table className="min-w-[52rem] w-full text-left text-sm">
            <thead className="border-b border-[var(--border)] text-[var(--muted-foreground)]">
              <tr>
                <th className="px-3 py-2 font-medium">Customer</th>
                <th className="px-3 py-2 font-medium">Plan</th>
                <th className="px-3 py-2 font-medium">Visit</th>
                <th className="px-3 py-2 font-medium">Due window</th>
                <th className="px-3 py-2 font-medium">Appointment</th>
                <th className="px-3 py-2 font-medium">Tech</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visits.map((visit) => {
                const windowParts = visit.scheduledWindow?.split("-").map(Number);
                return (
                  <tr key={`${visit.membershipId}-${visit.cycleKey}`} className="border-t border-[var(--border)]">
                    <td className="px-3 py-2 font-medium">{visit.customerName}</td>
                    <td className="px-3 py-2">{visit.planName}</td>
                    <td className="px-3 py-2">{visit.label}</td>
                    <td className="px-3 py-2">
                      {formatLocalDateShort(visit.dueStart, ctx.company.timezone)} – {formatLocalDateShort(visit.dueEnd, ctx.company.timezone)}
                    </td>
                    <td className="px-3 py-2">
                      {visit.scheduledDate
                        ? `${formatLocalDateShort(visit.scheduledDate, ctx.company.timezone)}${
                            windowParts ? ` · ${formatClockMinutes(windowParts[0])}–${formatClockMinutes(windowParts[1])}` : ""
                          }`
                        : "Unscheduled"}
                    </td>
                    <td className="px-3 py-2">{visit.technicianName || "—"}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={visit.status} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        <Link href={`/customers/${visit.customerId}`} className="underline">
                          Customer
                        </Link>
                        {visit.jobId ? (
                          <Link href={`/jobs/${visit.jobId}`} className="underline">
                            Job
                          </Link>
                        ) : (
                          <Link
                            href={`/customers/${visit.customerId}`}
                            className="underline"
                          >
                            Schedule
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
