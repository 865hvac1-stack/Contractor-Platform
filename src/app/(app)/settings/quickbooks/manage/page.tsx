import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { getActiveQuickBooksScope } from "@/lib/quickbooks/ownership";
import { loadInboundSyncCenter } from "@/lib/quickbooks/inbound-center";
import { buildQuickBooksReconciliation } from "@/lib/quickbooks/reconciliation";
import { maskRealmId } from "@/lib/quickbooks/errors";
import { formatDateTime } from "@/lib/datetime";
import { IMPORT_CONFIRMATION } from "@/lib/quickbooks/inbound-types";
import {
  analyzeQuickBooksImportAction,
  applyQuickBooksReviewAction,
  importApprovedQuickBooksAction,
  refreshPreviewFromSyncCenterAction,
  syncChangesDisabledAction,
} from "@/server/actions/quickbooks-sync-center";
import { ActionForm } from "@/components/action-form";
import { StatusBadge } from "@/components/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { redirect } from "next/navigation";
import {
  createQuickBooksCustomerAction,
  linkQuickBooksCustomerAction,
  unlinkQuickBooksCustomerAction,
} from "@/server/actions/quickbooks";

export const dynamic = "force-dynamic";

export default async function QuickBooksManagePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; filter?: string }>;
}) {
  const ctx = await requirePermission("accounting:view");
  const canManage = can(ctx.role, "accounting:manage");
  const active = await getActiveQuickBooksScope(prisma, ctx.company.id);
  if (!active.ok) redirect("/settings/quickbooks");
  const { view, filter } = await searchParams;
  const inbound = await loadInboundSyncCenter(prisma, active.scope);
  const reconciliation = view === "reconcile" ? await buildQuickBooksReconciliation(prisma, ctx.company.id, active.scope) : null;
  const reviews =
    view === "review" || view === "duplicates" || view === "conflicts"
      ? await prisma.quickBooksImportReview.findMany({
          where: {
            companyId: ctx.company.id,
            environment: active.scope.environment,
            realmId: active.scope.realmId,
            ...(view === "duplicates" ? { confidence: "POSSIBLE" } : {}),
            ...(view === "conflicts" ? { status: { in: ["OPEN", "FAILED"] } } : {}),
            ...(filter === "EXACT" || filter === "HIGH" || filter === "NONE" ? { confidence: filter } : {}),
          },
          orderBy: { updatedAt: "desc" },
          take: 80,
        })
      : [];
  const connectionHealth =
    inbound.connection?.status === "CONNECTED"
      ? inbound.settings.inboundSyncHealth || "Connected"
      : inbound.connection?.status || "Disconnected";

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <Link href="/settings/quickbooks" className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
          ← QuickBooks
        </Link>
        <h1 className="mt-2 font-display text-3xl tracking-tight">QuickBooks Sync Center</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          ContractorYou runs the business. QuickBooks remains the accounting ledger. Import is staged, reviewable, and
          never writes back in this phase.
        </p>
      </div>

      <section className="rounded-2xl border border-sky-200 bg-sky-50 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-800">Connection</p>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Fact label="Status" value={inbound.connection?.status === "CONNECTED" ? "Connected" : "Disconnected"} />
          <Fact label="QuickBooks company" value={inbound.settings.qboCompanyName || "Unknown"} />
          <Fact label="Realm ID" value={maskRealmId(active.scope.realmId)} />
          <Fact label="Environment" value={active.scope.environment === "production" ? "Production" : "Sandbox"} />
          <Fact
            label="Last successful sync"
            value={
              inbound.settings.lastSuccessfulInboundSyncAt
                ? formatDateTime(inbound.settings.lastSuccessfulInboundSyncAt, ctx.company.timezone)
                : "Never"
            }
          />
          <Fact
            label="Last attempted sync"
            value={
              inbound.settings.lastAttemptedInboundSyncAt
                ? formatDateTime(inbound.settings.lastAttemptedInboundSyncAt, ctx.company.timezone)
                : "Never"
            }
          />
          <Fact label="Connection health" value={connectionHealth} />
          <Fact label="Write-back" value={inbound.writeBackEnabled ? "Enabled" : "Disabled"} />
        </dl>
      </section>

      <div className="flex flex-wrap gap-2">
        <ActionForm action={refreshPreviewFromSyncCenterAction}>
          <Button type="submit" size="sm" variant="outline">
            Refresh Preview
          </Button>
        </ActionForm>
        {canManage ? (
          <ActionForm action={analyzeQuickBooksImportAction}>
            {inbound.latestAnalysis?.status === "PAUSED" ? (
              <input type="hidden" name="resumeRunId" value={inbound.latestAnalysis.id} />
            ) : null}
            <Button type="submit" size="sm">
              {inbound.latestAnalysis?.status === "PAUSED" ? "Continue Analyze Import" : "Analyze Import"}
            </Button>
          </ActionForm>
        ) : null}
        <Link href="/settings/quickbooks/manage?view=review" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Review Matches
        </Link>
        <Link href="/settings/quickbooks/manage?view=duplicates" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Review Duplicates
        </Link>
        <Link href="/settings/quickbooks/manage?view=conflicts" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Review Conflicts
        </Link>
        <Link href="/settings/quickbooks/preview" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Read-only preview
        </Link>
        <Link href="/settings/quickbooks/manage?view=log" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Sync log
        </Link>
        <Link href="/settings/quickbooks/manage?view=reconcile" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Reconciliation
        </Link>
        <ActionForm action={syncChangesDisabledAction}>
          <Button type="submit" size="sm" variant="ghost">
            Sync Changes
          </Button>
        </ActionForm>
      </div>

      {inbound.previewError ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">{inbound.previewError}</p>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {inbound.categories.map((row) => (
          <article key={row.objectType} className="rounded-2xl border border-[var(--border)] bg-white px-4 py-4">
            <p className="text-xs uppercase tracking-[0.14em] text-[var(--muted-foreground)]">{row.label}</p>
            <p className="mt-2 text-2xl font-semibold text-[var(--cy-navy)]">
              {row.available == null ? "—" : row.available.toLocaleString()}
            </p>
            <p className="text-xs text-[var(--muted-foreground)]">available in QuickBooks</p>
            <ul className="mt-3 space-y-1 text-sm">
              <li>Already linked {row.linked.toLocaleString()}</li>
              <li>New {row.newCount.toLocaleString()}</li>
              <li>Updated {row.updated.toLocaleString()}</li>
              <li>Possible duplicates {row.duplicates.toLocaleString()}</li>
              <li>Conflicts {row.conflicts.toLocaleString()}</li>
              <li>Skipped {row.skipped.toLocaleString()}</li>
              <li>Failed {row.failed.toLocaleString()}</li>
              <li>
                Last synced{" "}
                {row.lastSynced ? formatDateTime(row.lastSynced, ctx.company.timezone) : "not yet"}
              </li>
            </ul>
          </article>
        ))}
      </section>

      {inbound.plan ? (
        <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <h2 className="font-medium">Import plan</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            This plan is computed from a read-only QuickBooks analysis. Approving a stage still requires confirmation.
            Possible matches are never imported silently.
          </p>
          <ol className="mt-4 space-y-2 text-sm">
            {inbound.plan.stages.map((stage) => (
              <li key={stage.stage}>
                <span className="font-medium">Stage {stage.stage}.</span> {stage.summary}
              </li>
            ))}
          </ol>
          {canManage ? (
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              {[1, 2, 3, 4, 5].map((stage) => (
                <ActionForm key={stage} action={importApprovedQuickBooksAction} className="rounded-xl border border-[var(--border)] p-4">
                  <p className="text-sm font-medium">Import approved records · Stage {stage}</p>
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                    Type {IMPORT_CONFIRMATION} to confirm. There is no import-everything button.
                  </p>
                  <input type="hidden" name="stage" value={String(stage)} />
                  {inbound.latestImport?.status === "PAUSED" && inbound.latestImport.objectType === `STAGE_${stage}` ? (
                    <input type="hidden" name="resumeRunId" value={inbound.latestImport.id} />
                  ) : null}
                  <Input name="confirm" className="mt-3" placeholder={IMPORT_CONFIRMATION} autoComplete="off" />
                  <Button type="submit" size="sm" className="mt-3">
                    Import Stage {stage}
                  </Button>
                </ActionForm>
              ))}
            </div>
          ) : null}
        </section>
      ) : (
        <section className="rounded-2xl border border-[var(--border)] bg-white p-5 text-sm text-[var(--muted-foreground)]">
          Run Analyze Import to build a plan. Analysis does not create customers, invoices, or QuickBooks writes.
        </section>
      )}

      {view === "review" || view === "duplicates" || view === "conflicts" ? (
        <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <h2 className="font-medium">
            {view === "duplicates" ? "Possible duplicates" : view === "conflicts" ? "Conflicts" : "Match review"}
          </h2>
          {reviews.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--muted-foreground)]">Nothing in this queue.</p>
          ) : (
            <ul className="mt-4 divide-y divide-[var(--border)]">
              {reviews.map((row) => (
                <li key={row.id} className="py-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        {row.displayName} · {row.objectType}
                      </p>
                      <p className="text-sm text-[var(--muted-foreground)]">{row.reason}</p>
                      <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                        QuickBooks {row.quickbooksId} · {row.confidence} · {row.status}
                      </p>
                    </div>
                    <StatusBadge status={row.confidence === "POSSIBLE" ? "NEEDS_REVIEW" : row.status} />
                  </div>
                  {canManage && row.objectType === "CUSTOMER" ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <ActionForm action={applyQuickBooksReviewAction} className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="reviewId" value={row.id} />
                        <input type="hidden" name="decision" value="LINK" />
                        <Input name="targetCustomerId" placeholder="ContractorYou customer ID" className="w-56" />
                        <Button type="submit" size="sm" variant="outline">
                          Link to Existing Customer
                        </Button>
                      </ActionForm>
                      <ReviewButton reviewId={row.id} decision="CREATE" label="Create New Customer" />
                      <ReviewButton reviewId={row.id} decision="MERGE" label="Merge Records" extra />
                      <ReviewButton reviewId={row.id} decision="IGNORE" label="Ignore QuickBooks Record" />
                      <ReviewButton reviewId={row.id} decision="NOT_DUPLICATE" label="Mark Not Duplicate" />
                    </div>
                  ) : null}
                  {canManage && row.objectType === "ITEM" ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <ActionForm action={applyQuickBooksReviewAction} className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="reviewId" value={row.id} />
                        <input type="hidden" name="decision" value="LINK" />
                        <Input name="targetCustomerId" placeholder="Pricebook item ID" className="w-56" />
                        <Button type="submit" size="sm" variant="outline">
                          Link to Existing Pricebook Item
                        </Button>
                      </ActionForm>
                      <ReviewButton reviewId={row.id} decision="CREATE" label="Create New Pricebook Item" />
                      <ReviewButton reviewId={row.id} decision="IGNORE" label="Ignore" />
                      <ReviewButton reviewId={row.id} decision="MARK_INACTIVE" label="Mark Inactive" />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {view === "log" ? (
        <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <h2 className="font-medium">Synchronization log</h2>
          {inbound.runs.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--muted-foreground)]">No inbound sync runs yet.</p>
          ) : (
            <ul className="mt-4 divide-y divide-[var(--border)] text-sm">
              {inbound.runs.map((run) => (
                <li key={run.id} className="flex flex-wrap justify-between gap-2 py-3">
                  <div>
                    <p className="font-medium">
                      {run.type} {run.objectType || ""} · {run.status}
                    </p>
                    <p className="text-[var(--muted-foreground)]">
                      Examined {run.recordsExamined} · created {run.createdCount} · updated {run.updatedCount} · linked{" "}
                      {run.linkedCount} · skipped {run.skippedCount} · conflicts {run.conflictCount} · failed {run.failedCount}
                    </p>
                    {run.errorMessage ? <p className="text-rose-700">{run.errorMessage}</p> : null}
                    <p className="text-xs text-[var(--muted-foreground)]">Write-back attempted: {run.writeBackAttempted ? "yes" : "no"}</p>
                  </div>
                  <p className="text-xs text-[var(--muted-foreground)]">{formatDateTime(run.startedAt, ctx.company.timezone)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {reconciliation ? (
        <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <h2 className="font-medium">Reconciliation</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Compare ContractorYou imported counts with the last QuickBooks read. Totals are tenant-scoped to this realm.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-[var(--muted-foreground)]">
                  <th className="py-2">Category</th>
                  <th>QuickBooks</th>
                  <th>ContractorYou</th>
                  <th>Difference</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {reconciliation.rows.map((row) => (
                  <tr key={row.objectType} className="border-t border-[var(--border)]">
                    <td className="py-2">{row.objectType}</td>
                    <td>{row.quickbooks.toLocaleString()}</td>
                    <td>{row.contractorYou.toLocaleString()}</td>
                    <td>{row.difference.toLocaleString()}</td>
                    <td>{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-[var(--muted-foreground)]">
            Imported invoice totals {reconciliation.totals.invoiceTotalCents / 100} · payments{" "}
            {reconciliation.totals.paymentTotalCents / 100} · outstanding {reconciliation.totals.outstandingCents / 100} ·
            expenses {reconciliation.totals.expenseTotalCents / 100}.{" "}
            {reconciliation.mappingsSufficient
              ? "Income accounts are mapped."
              : "Map chart of accounts before treating these as a P&L."}
          </p>
        </section>
      ) : null}

      <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
        <h2 className="font-medium">Operational QuickBooks links</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Existing ContractorYou → QuickBooks mapping issues remain here. Creating customers in QuickBooks is disabled
          until write-back is enabled.
        </p>
        {inbound.center.customers.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--muted-foreground)]">No outbound customer reviews.</p>
        ) : (
          <ul className="mt-4 space-y-4">
            {inbound.center.customers.map(({ mapping, customer }) => (
              <li key={mapping.id} className="rounded-xl border border-[var(--border)] p-3">
                <p className="font-medium">
                  {customer ? customer.businessName || `${customer.firstName} ${customer.lastName}` : "Customer"}
                </p>
                {canManage ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <ActionForm action={linkQuickBooksCustomerAction} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="customerId" value={mapping.internalId} />
                      <Input name="quickbooksId" placeholder="QuickBooks customer ID" className="w-48" required />
                      <Button type="submit" size="sm" variant="outline">
                        Link existing
                      </Button>
                    </ActionForm>
                    <ActionForm action={createQuickBooksCustomerAction}>
                      <input type="hidden" name="customerId" value={mapping.internalId} />
                      <Button type="submit" size="sm">
                        Create in QuickBooks
                      </Button>
                    </ActionForm>
                    <ActionForm action={unlinkQuickBooksCustomerAction}>
                      <input type="hidden" name="customerId" value={mapping.internalId} />
                      <Button type="submit" size="sm" variant="ghost">
                        Unlink
                      </Button>
                    </ActionForm>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[var(--muted-foreground)]">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function ReviewButton({
  reviewId,
  decision,
  label,
  extra,
}: {
  reviewId: string;
  decision: string;
  label: string;
  extra?: boolean;
}) {
  return (
    <ActionForm action={applyQuickBooksReviewAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="reviewId" value={reviewId} />
      <input type="hidden" name="decision" value={decision} />
      {extra ? <Input name="targetCustomerId" placeholder="Surviving customer ID" className="w-56" /> : null}
      <Button type="submit" size="sm" variant="outline">
        {label}
      </Button>
    </ActionForm>
  );
}
