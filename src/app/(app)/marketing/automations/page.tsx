import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { createAutomationDraftAction } from "@/server/actions/marketing";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";

const TRIGGERS = [
  "NEW_LEAD",
  "MISSED_CALL",
  "ESTIMATE_SENT",
  "ESTIMATE_NOT_APPROVED",
  "JOB_SCHEDULED",
  "JOB_COMPLETED",
  "INVOICE_SENT",
  "INVOICE_OVERDUE",
  "CUSTOMER_INACTIVE",
  "MEMBERSHIP_EXPIRING",
  "REVIEW_NEEDED",
];

const ACTIONS = [
  "CREATE_TASK",
  "NOTIFY_OFFICE",
  "SEND_SMS",
  "SEND_EMAIL",
  "ASSIGN_USER",
  "MOVE_LEAD_STAGE",
  "REQUEST_REVIEW",
  "START_FOLLOW_UP_SEQUENCE",
];

export default async function AutomationsPage() {
  const ctx = await requirePermission("marketing:view");
  const automations = await prisma.automation.findMany({
    where: { companyId: ctx.company.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--cy-navy)]">
          Automations
        </h1>
        <p className="mt-2 max-w-2xl text-[var(--muted-foreground)]">
          TRIGGER → CONDITIONS → ACTIONS → OUTCOME. Drafts can be saved. Enabling send actions
          is blocked until communications are configured. Financial or customer-facing actions
          will require approval.
        </p>
      </header>

      <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
        <h2 className="font-semibold text-[var(--cy-navy)]">New automation draft</h2>
        <ActionForm
          action={createAutomationDraftAction}
          className="mt-4 space-y-3"
          successMessage="Draft saved. It is not enabled."
        >
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required placeholder="Missed call follow-up" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="trigger">Trigger</Label>
              <select
                id="trigger"
                name="trigger"
                className="h-10 w-full rounded-lg border border-[var(--border)] px-2 text-sm"
              >
                {TRIGGERS.map((trigger) => (
                  <option key={trigger} value={trigger}>
                    {trigger.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="action">Action</Label>
              <select
                id="action"
                name="action"
                className="h-10 w-full rounded-lg border border-[var(--border)] px-2 text-sm"
              >
                {ACTIONS.map((action) => (
                  <option key={action} value={action}>
                    {action.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit">Save draft</Button>
            <Button type="button" variant="outline" disabled>
              Enable — communications not configured
            </Button>
          </div>
        </ActionForm>
      </section>

      {automations.length === 0 ? (
        <EmptyState
          title="No automations"
          description="Save the structure now. Missed call → automatic text will run only after a phone and SMS provider are connected."
        />
      ) : (
        <ul className="space-y-3">
          {automations.map((automation) => (
            <li
              key={automation.id}
              className="flex flex-col gap-2 rounded-2xl border border-[var(--border)] bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-medium text-[var(--cy-navy)]">{automation.name}</p>
                <p className="text-sm text-[var(--muted-foreground)]">
                  {automation.trigger.replaceAll("_", " ")} → {automation.action.replaceAll("_", " ")}
                </p>
              </div>
              <StatusBadge status={automation.enabled ? "ACTIVE" : automation.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
