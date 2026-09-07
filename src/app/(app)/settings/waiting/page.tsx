import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { ensureWaitingSetup } from "@/lib/waiting/columns";
import { CADENCE_LABELS } from "@/lib/waiting/defaults";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createWaitingColumnAction, saveWaitingBoardSettingsAction } from "@/server/actions/waiting";
import type { WaitingCadence } from "@prisma/client";

export default async function WaitingBoardSettingsPage() {
  const ctx = await requirePermission("company:settings");
  const { columns, setting } = await ensureWaitingSetup(ctx.company.id);
  const templates = await prisma.waitingTemplate.findMany({
    where: { companyId: ctx.company.id },
    include: { column: { select: { name: true, key: true } } },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
          Settings · Operations
        </p>
        <h1 className="mt-1 font-display text-3xl tracking-tight">Waiting Board</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Company defaults. Individual waiting records can override cadence and whether the customer is texted.
        </p>
      </div>

      <ActionForm action={saveWaitingBoardSettingsAction} className="space-y-6">
        <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-white p-5">
          <h2 className="font-medium">Automatic customer updates</h2>
          <select
            name="automaticUpdatesEnabled"
            defaultValue={setting.automaticUpdatesEnabled ? "yes" : "no"}
            className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm"
          >
            <option value="yes">On — send confirmations and recurring updates</option>
            <option value="no">Off — office sends updates manually</option>
          </select>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Default cadence</Label>
              <select
                name="defaultCadence"
                defaultValue={setting.defaultCadence}
                className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm"
              >
                {(Object.keys(CADENCE_LABELS) as WaitingCadence[]).map((value) => (
                  <option key={value} value={value}>
                    {CADENCE_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Custom days</Label>
              <Input
                name="defaultCustomCadenceDays"
                type="number"
                min={1}
                max={30}
                defaultValue={setting.defaultCustomCadenceDays ?? ""}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Business hour start</Label>
              <Input name="businessHoursStart" type="number" min={6} max={20} defaultValue={setting.businessHoursStart} />
            </div>
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">
            Recurring texts use {ctx.company.timezone}. Dates are never invented — expected-date language is omitted
            until a verified date is entered.
          </p>
        </section>

        <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-white p-5">
          <h2 className="font-medium">Waiting statuses</h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            Warning / urgent thresholds drive Action Center items. Archive unused columns instead of deleting history.
          </p>
          {columns.map((column) => (
            <div key={column.id} className="grid gap-2 rounded-xl bg-[var(--cy-gray)]/50 p-3 sm:grid-cols-4">
              <input type="hidden" name="columnId" value={column.id} />
              <Input name={`columnName-${column.id}`} defaultValue={column.name} />
              <Input name={`warningDays-${column.id}`} type="number" defaultValue={column.warningDays} />
              <Input name={`urgentDays-${column.id}`} type="number" defaultValue={column.urgentDays} />
              <select
                name={`archive-${column.id}`}
                defaultValue={column.archivedAt ? "yes" : "no"}
                className="h-10 rounded-lg border border-[var(--border)] bg-white px-3 text-sm"
              >
                <option value="no">Active</option>
                <option value="yes">Archived</option>
              </select>
            </div>
          ))}
        </section>

        <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-white p-5">
          <h2 className="font-medium">Message templates</h2>
          <p className="text-xs text-[var(--muted-foreground)]">
            Safe variables: {"{{firstName}}"} {"{{companyName}}"} {"{{itemName}}"} {"{{jobNumber}}"} {"{{waitingReason}}"}{" "}
            {"{{waitingFor}}"} {"{{expectedDateSentence}}"}
          </p>
          {templates.map((template) => (
            <div key={template.id} className="space-y-1.5">
              <Label>
                {template.column?.name ?? "All statuses"} · {template.kind}
              </Label>
              <Textarea name={`template-${template.id}`} rows={3} defaultValue={template.body} />
            </div>
          ))}
        </section>

        <Button type="submit" className="h-11 bg-[var(--cy-navy)] text-white">
          Save Waiting Board settings
        </Button>
      </ActionForm>

      <ActionForm action={createWaitingColumnAction} className="space-y-3 rounded-2xl border border-[var(--border)] bg-white p-5">
        <h2 className="font-medium">Add a status</h2>
        <Input name="name" placeholder="Waiting on permit" />
        <select name="kind" className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm">
          <option value="WAITING">Waiting</option>
          <option value="READY">Ready</option>
        </select>
        <Button type="submit" variant="outline" className="h-10">
          Add status
        </Button>
      </ActionForm>
    </div>
  );
}
