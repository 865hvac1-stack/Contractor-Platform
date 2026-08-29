import Link from "next/link";
import { requirePermission, jobAccessFilter } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

function formatSchedule(start: Date | null, end: Date | null) {
  if (!start) return "Unscheduled";
  const dateFmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  if (!end) return dateFmt.format(start);
  return `${dateFmt.format(start)} – ${dateFmt.format(end)}`;
}

export default async function JobsPage() {
  const ctx = await requirePermission("jobs:view");
  const access = jobAccessFilter(ctx.role, ctx.user.id);

  const jobs = await prisma.job.findMany({
    where: { companyId: ctx.company.id, ...access },
    include: {
      customer: true,
      property: true,
      assignments: { include: { user: true } },
    },
    orderBy: [{ scheduledStart: "asc" }, { createdAt: "desc" }],
    take: 200,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl tracking-tight">Jobs</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Work in progress across your company.
          </p>
        </div>
        <Link href="/jobs/new" className={cn(buttonVariants())}>
          New job
        </Link>
      </div>

      {jobs.length === 0 ? (
        <EmptyState
          title="No jobs yet"
          description="Create a job to schedule technicians and track progress."
          actionLabel="Create job"
          actionHref="/jobs/new"
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden lg:table-cell">Schedule</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => {
                const customerName =
                  job.customer.businessName?.trim() ||
                  `${job.customer.firstName} ${job.customer.lastName}`.trim();
                return (
                  <TableRow key={job.id}>
                    <TableCell>
                      <Link href={`/jobs/${job.id}`} className="font-medium hover:underline">
                        {job.jobNumber}
                      </Link>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        {job.jobType || job.trade || job.property.address}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Link href={`/customers/${job.customerId}`} className="hover:underline">
                        {customerName}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={job.status} />
                    </TableCell>
                    <TableCell className="hidden text-sm text-[var(--muted-foreground)] lg:table-cell">
                      {formatSchedule(job.scheduledStart, job.scheduledEnd)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
