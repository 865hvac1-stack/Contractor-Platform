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
import { JOB_COST_LABELS } from "@/lib/costing/categories";
import { ActionForm } from "@/components/action-form";
import { JobStatusControls } from "@/components/jobs/job-status-controls";
import { Job360View } from "@/components/jobs/job-360-view";
import { loadJob360 } from "@/lib/jobs/job-360";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AskContractorYou } from "@/components/ask-contractoryou";
import { suggestedQuestions } from "@/lib/intelligence/intent";

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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const ctx = await requirePermission("jobs:view");
  const { id } = await params;
  const { from } = await searchParams;
  const access = jobAccessFilter(ctx.role, ctx.user.id);
  const backHref = from?.startsWith("/jobs") ? from : "/jobs";

  const view = await loadJob360(prisma, {
    companyId: ctx.company.id,
    jobId: id,
    role: ctx.role,
    access,
  });
  if (!view) notFound();

  const workflow = await loadJobWorkflowView(ctx.company.id, view.job.id);
  const canAct =
    (can(ctx.role, "jobs:manage") || view.technicians.assigned.some((row) => row.id === ctx.user.id)) &&
    view.job.status !== "COMPLETED" &&
    view.job.status !== "CANCELED";
  const canAddCost = can(ctx.role, "job_costs:manage");
  const membershipPlans =
    can(ctx.role, "memberships:manage") && !view.job.historical
      ? await prisma.membershipPlan.findMany({
          where: { companyId: ctx.company.id, active: true },
          orderBy: { name: "asc" },
        })
      : [];

  return (
    <div className="space-y-8">
      <Job360View
        view={view}
        backHref={backHref}
        canCall={can(ctx.role, "customers:view")}
        canEstimate={can(ctx.role, "estimates:manage")}
        canInvoice={can(ctx.role, "invoices:manage")}
        canViewMoney={can(ctx.role, "invoices:view")}
        canDelete={can(ctx.role, "jobs:manage")}
      />

      {can(ctx.role, "intelligence:view") ? (
        <AskContractorYou suggestions={suggestedQuestions(ctx.role, view.job.id)} jobId={view.job.id} compact />
      ) : null}

      {workflow ? (
        <JobWorkflowPanel
          jobId={view.job.id}
          playbookName={workflow.playbookName}
          customerName={view.customer.name}
          scheduledLabel={formatDateTime(view.job.scheduledStart)}
          definition={workflow.definition}
          currentStageKey={workflow.currentStageKey}
          completedStepIds={workflow.completedStepIds}
          remaining={workflow.remaining}
          checklist={workflow.checklist}
          customerPhone={view.customer.phone}
          propertyAddress={view.property.line}
          canAct={canAct && !view.job.historical}
        />
      ) : null}

      {can(ctx.role, "jobs:manage") || canAct ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
            </CardHeader>
            <CardContent>
              <JobStatusControls jobId={view.job.id} status={view.job.status as never} />
            </CardContent>
          </Card>
          {can(ctx.role, "jobs:manage") && !view.job.historical ? (
            <Card>
              <CardHeader>
                <CardTitle>Schedule</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-4 text-sm text-[var(--muted-foreground)]">
                  Current: {formatDateTime(view.job.scheduledStart)}
                </p>
                <ActionForm action={scheduleJobAction} className="space-y-4" successMessage="Schedule updated.">
                  <input type="hidden" name="jobId" value={view.job.id} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="scheduledStart">Start</Label>
                      <Input
                        id="scheduledStart"
                        name="scheduledStart"
                        type="datetime-local"
                        required
                        defaultValue={toLocalInputValue(view.job.scheduledStart)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="scheduledEnd">End</Label>
                      <Input id="scheduledEnd" name="scheduledEnd" type="datetime-local" />
                    </div>
                  </div>
                  <Button type="submit">Save schedule</Button>
                </ActionForm>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      {membershipPlans.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Sell a membership</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm action={sellMembershipAction} successMessage="Membership recorded." className="space-y-3">
              <input type="hidden" name="customerId" value={view.customer.id} />
              <input type="hidden" name="jobId" value={view.job.id} />
              <input type="hidden" name="propertyId" value={view.property.id} />
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

      {can(ctx.role, "estimates:manage") && view.estimates.length === 0 && !view.job.historical ? (
        <form
          action={async () => {
            "use server";
            await createDraftEstimateForJobAction(view.job.id);
          }}
        >
          <Button type="submit" size="sm">
            Build estimate options
          </Button>
        </form>
      ) : null}

      {canAddCost ? (
        <ActionForm
          action={addManualJobCostAction}
          successMessage="Cost added."
          className="space-y-3 rounded-xl border border-[var(--border)] bg-white p-4"
        >
          <h3 className="font-medium">Add a cost without a receipt</h3>
          <input type="hidden" name="jobId" value={view.job.id} />
          <div className="grid gap-3 sm:grid-cols-3">
            <select name="category" className="h-10 rounded-lg border border-input px-2.5 text-sm" defaultValue="PERMIT">
              {Object.entries(JOB_COST_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <Input name="description" placeholder="Permit, subcontractor…" />
            <Input name="amount" type="number" min="0.01" step="0.01" placeholder="125.00" required />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm">
              Add cost
            </Button>
            {can(ctx.role, "receipts:manage") ? (
              <Link href={`/receipts/new?jobId=${view.job.id}`} className="text-sm font-medium underline">
                Add a receipt
              </Link>
            ) : null}
          </div>
        </ActionForm>
      ) : null}
    </div>
  );
}
