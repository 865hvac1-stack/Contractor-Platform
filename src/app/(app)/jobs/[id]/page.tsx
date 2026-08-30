import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, jobAccessFilter } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { loadJobWorkflowView } from "@/lib/playbooks/job-view";
import { JobWorkflowPanel } from "@/components/playbooks/job-workflow";
import { scheduleJobAction } from "@/server/actions/jobs";
import { ActionForm } from "@/components/action-form";
import { JobStatusControls } from "@/components/jobs/job-status-controls";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function toLocalInputValue(d: Date | null | undefined) {
  if (!d) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDateTime(d: Date | null | undefined) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requirePermission("jobs:view");
  const { id } = await params;
  const access = jobAccessFilter(ctx.role, ctx.user.id);

  const job = await prisma.job.findFirst({
    where: { id, companyId: ctx.company.id, ...access },
    include: {
      customer: true,
      property: true,
      assignments: { include: { user: true } },
      estimate: true,
      estimates: { orderBy: { createdAt: "desc" } },
      invoices: { orderBy: { createdAt: "desc" } },
      expenses: { orderBy: { date: "desc" } },
    },
  });

  if (!job) notFound();

  const workflow = await loadJobWorkflowView(ctx.company.id, job.id);
  const canAct =
    can(ctx.role, "jobs:manage") || job.assignments.some((a) => a.userId === ctx.user.id);

  const customerName =
    job.customer.businessName?.trim() ||
    `${job.customer.firstName} ${job.customer.lastName}`.trim();
  const propertyAddress = `${job.property.address}, ${job.property.city}, ${job.property.state} ${job.property.zip}`;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            href="/jobs"
            className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            ← Jobs
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl tracking-tight">{job.jobNumber}</h1>
            <StatusBadge status={job.status} />
            <StatusBadge status={job.priority} />
          </div>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {workflow?.playbookName || job.jobType || job.trade || "Job"} · {customerName}
          </p>
        </div>
      </div>

      {workflow ? (
        <JobWorkflowPanel
          jobId={job.id}
          playbookName={workflow.playbookName}
          customerName={customerName}
          scheduledLabel={formatDateTime(job.scheduledStart)}
          definition={workflow.definition}
          currentStageKey={workflow.currentStageKey}
          completedStepIds={workflow.completedStepIds}
          remaining={workflow.remaining}
          checklist={workflow.checklist}
          customerPhone={job.customer.phone}
          propertyAddress={propertyAddress}
          canAct={canAct && job.status !== "COMPLETED" && job.status !== "CANCELED"}
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
          </CardHeader>
          <CardContent>
            <JobStatusControls jobId={job.id} status={job.status} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Schedule</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-[var(--muted-foreground)]">
              Current: {formatDateTime(job.scheduledStart)}
              {job.scheduledEnd ? ` – ${formatDateTime(job.scheduledEnd)}` : ""}
            </p>
            <ActionForm
              action={scheduleJobAction}
              className="space-y-4"
              successMessage="Schedule updated."
            >
              <input type="hidden" name="jobId" value={job.id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="scheduledStart">Start</Label>
                  <Input
                    id="scheduledStart"
                    name="scheduledStart"
                    type="datetime-local"
                    required
                    defaultValue={toLocalInputValue(job.scheduledStart)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="scheduledEnd">End</Label>
                  <Input
                    id="scheduledEnd"
                    name="scheduledEnd"
                    type="datetime-local"
                    defaultValue={toLocalInputValue(job.scheduledEnd)}
                  />
                </div>
              </div>
              <Button type="submit">Save schedule</Button>
            </ActionForm>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Customer</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <Link href={`/customers/${job.customerId}`} className="font-medium hover:underline">
                {customerName}
              </Link>
            </p>
            <p className="text-[var(--muted-foreground)]">{job.customer.phone || "No phone"}</p>
            <p className="text-[var(--muted-foreground)]">{job.customer.email || "No email"}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Property</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {job.property.name ? (
              <p className="font-medium">{job.property.name}</p>
            ) : null}
            <p>{job.property.address}</p>
            <p className="text-[var(--muted-foreground)]">
              {job.property.city}, {job.property.state} {job.property.zip}
            </p>
            {job.property.accessNotes ? (
              <p className="mt-2 text-[var(--muted-foreground)]">
                Access: {job.property.accessNotes}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Assignees</CardTitle>
        </CardHeader>
        <CardContent>
          {job.assignments.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No one assigned yet.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {job.assignments.map((a) => (
                <li
                  key={a.id}
                  className="rounded-md bg-[var(--muted)] px-2.5 py-1 text-sm"
                >
                  {a.user.firstName} {a.user.lastName}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Description & notes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                Description
              </p>
              <p className="mt-1 whitespace-pre-wrap">{job.description || "—"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                Customer notes
              </p>
              <p className="mt-1 whitespace-pre-wrap">{job.customerNotes || "—"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                Internal notes
              </p>
              <p className="mt-1 whitespace-pre-wrap">{job.internalNotes || "—"}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Linked estimates</CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const linked = [
                ...(job.estimate ? [job.estimate] : []),
                ...job.estimates.filter((e) => e.id !== job.estimateId),
              ];
              if (linked.length === 0) {
                return (
                  <p className="text-sm text-[var(--muted-foreground)]">No linked estimates.</p>
                );
              }
              return (
                <ul className="space-y-2">
                  {linked.map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-2 text-sm">
                      <Link href={`/estimates/${e.id}`} className="font-medium hover:underline">
                        {e.estimateNumber}
                      </Link>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={e.status} />
                        <span className="tabular-nums">{formatMoney(e.totalCents)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              );
            })()}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <section className="space-y-3">
          <h2 className="font-display text-xl">Invoices</h2>
          {job.invoices.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No invoices linked.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-white">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {job.invoices.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell>
                        <Link href={`/invoices/${inv.id}`} className="font-medium hover:underline">
                          {inv.invoiceNumber}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={inv.status} />
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatMoney(inv.balanceCents)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-xl">Expenses</h2>
          {job.expenses.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No expenses linked.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-white">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Expense</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {job.expenses.map((exp) => (
                    <TableRow key={exp.id}>
                      <TableCell>
                        <Link href={`/expenses/${exp.id}`} className="font-medium hover:underline">
                          {exp.vendor || "Expense"}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={exp.category} />
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatMoney(exp.amountCents)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
