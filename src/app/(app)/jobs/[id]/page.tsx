import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, jobAccessFilter } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { loadJobWorkflowView } from "@/lib/playbooks/job-view";
import { JobWorkflowPanel } from "@/components/playbooks/job-workflow";
import { scheduleJobAction } from "@/server/actions/jobs";
import { createDraftEstimateForJobAction } from "@/server/actions/estimate-options";
import { sellMembershipAction } from "@/server/actions/memberships";
import { addManualJobCostAction } from "@/server/actions/costing";
import { loadJobFinancials } from "@/lib/costing/job";
import { JOB_COST_LABELS } from "@/lib/costing/categories";
import { ActionForm } from "@/components/action-form";
import { JobStatusControls } from "@/components/jobs/job-status-controls";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AskContractorYou } from "@/components/ask-contractoryou";
import { suggestedQuestions } from "@/lib/intelligence/intent";
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
  const financials = can(ctx.role, "job_costs:view")
    ? await loadJobFinancials(ctx.company.id, job.id)
    : null;
  const canAct =
    can(ctx.role, "jobs:manage") || job.assignments.some((a) => a.userId === ctx.user.id);
  const canAddCost = can(ctx.role, "job_costs:manage");
  const membershipPlans = can(ctx.role, "memberships:manage")
    ? await prisma.membershipPlan.findMany({
        where: { companyId: ctx.company.id, active: true },
        orderBy: { name: "asc" },
      })
    : [];

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

      {can(ctx.role, "intelligence:view") ? (
        <AskContractorYou suggestions={suggestedQuestions(ctx.role, job.id)} jobId={job.id} compact />
      ) : null}

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

      {membershipPlans.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Sell a membership</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm action={sellMembershipAction} successMessage="Membership recorded." className="space-y-3">
              <input type="hidden" name="customerId" value={job.customerId} />
              <input type="hidden" name="jobId" value={job.id} />
              <input type="hidden" name="propertyId" value={job.propertyId} />
              <select name="planId" required className="h-8 w-full rounded-lg border border-input px-2.5 text-sm">
                <option value="">Choose a plan</option>
                {membershipPlans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name} · {formatMoney(plan.priceCents)}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="activate" value="true" />
                Activate now
              </label>
              <Button type="submit" size="sm">
                Record membership
              </Button>
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}

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
                  <div className="space-y-3">
                    <p className="text-sm text-[var(--muted-foreground)]">No linked estimates.</p>
                    {can(ctx.role, "estimates:manage") ? (
                      <form
                        action={async () => {
                          "use server";
                          await createDraftEstimateForJobAction(job.id);
                        }}
                      >
                        <Button type="submit" size="sm">
                          Build options
                        </Button>
                      </form>
                    ) : null}
                  </div>
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
            {can(ctx.role, "estimates:manage") ? (
              <form
                className="mt-4"
                action={async () => {
                  "use server";
                  await createDraftEstimateForJobAction(job.id);
                }}
              >
                <Button type="submit" size="sm" variant="outline">
                  Build options
                </Button>
              </form>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {financials ? (
        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-xl">Job costing</h2>
              <p className="text-sm text-[var(--muted-foreground)]">
                {financials.isFinal
                  ? "Profit uses confirmed invoices and confirmed costs."
                  : "Profit is not final while receipts still need review."}
                {financials.lastUpdated
                  ? ` Last updated ${formatDateTime(financials.lastUpdated)}.`
                  : ""}
              </p>
            </div>
            <Link
              href={`/receipts/new?jobId=${job.id}`}
              className="rounded-lg bg-[var(--cy-navy)] px-3 py-2 text-sm font-medium text-white"
            >
              Add receipt
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              { label: "Revenue", value: formatMoney(financials.revenueCents) },
              { label: "Direct costs", value: formatMoney(financials.directCostCents) },
              { label: "Gross profit", value: formatMoney(financials.grossProfitCents) },
              {
                label: "Gross margin",
                value: financials.grossMarginPercent == null ? "—" : `${financials.grossMarginPercent}%`,
              },
            ].map((card) => (
              <div key={card.label} className="rounded-xl border border-[var(--border)] bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">{card.label}</p>
                <p className="mt-1 font-display text-2xl tabular-nums">{card.value}</p>
              </div>
            ))}
          </div>
          {financials.missingCosts ? (
            <p className="text-sm text-amber-800">This job has revenue but no confirmed costs yet.</p>
          ) : null}
          {financials.unconfirmedReceipts.length > 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">
              {financials.unconfirmedReceipts.length} receipt
              {financials.unconfirmedReceipts.length === 1 ? "" : "s"} still need review and are not in these totals.
            </p>
          ) : null}
          {financials.breakdown.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">
              No confirmed costs have been added to this job.
            </p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-white">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead>Sources</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {financials.breakdown.map((line) => (
                    <TableRow key={line.category}>
                      <TableCell className="font-medium">{line.label}</TableCell>
                      <TableCell className="text-sm text-[var(--muted-foreground)]">
                        {line.sources.map((source) => source.description).join(", ")}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(line.amountCents)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {canAddCost ? (
            <ActionForm
              action={addManualJobCostAction}
              successMessage="Cost added."
              className="space-y-3 rounded-xl border border-[var(--border)] bg-white p-4"
            >
              <h3 className="font-medium">Add a cost without a receipt</h3>
              <input type="hidden" name="jobId" value={job.id} />
              <div className="grid gap-3 sm:grid-cols-3">
                <select
                  name="category"
                  className="h-10 rounded-lg border border-input px-2.5 text-sm"
                  defaultValue="PERMIT"
                >
                  {Object.entries(JOB_COST_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <Input name="description" placeholder="Permit, subcontractor…" />
                <Input name="amount" type="number" min="0.01" step="0.01" placeholder="125.00" required />
              </div>
              <Button type="submit" size="sm">
                Add cost
              </Button>
            </ActionForm>
          ) : null}
        </section>
      ) : can(ctx.role, "receipts:manage") ? (
        <div className="rounded-xl border border-[var(--border)] bg-white p-4">
          <Link href={`/receipts/new?jobId=${job.id}`} className="font-medium hover:underline">
            Add a receipt to this job
          </Link>
        </div>
      ) : null}

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
