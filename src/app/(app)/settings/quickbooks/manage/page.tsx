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
  applyQuickBooksReviewAction,
  importApprovedQuickBooksAction,
  refreshPreviewFromSyncCenterAction,
  syncChangesDisabledAction,
} from "@/server/actions/quickbooks-sync-center";
import { AnalyzeImportControl } from "@/components/quickbooks/analyze-import-control";
import { loadQuickBooksReviewRows } from "@/lib/quickbooks/review-center";
import { ANALYSIS_STATUS_DEFINITIONS } from "@/lib/quickbooks/analysis-classification";
import { ReviewCheckbox, ReviewSelection } from "@/components/quickbooks/review-selection";
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
  searchParams: Promise<{
    view?: string;
    filter?: string;
    q?: string;
    page?: string;
    pageSize?: string;
    sort?: string;
    reason?: string;
    differences?: string;
    reviewed?: string;
    selection?: string;
  }>;
}) {
  const ctx = await requirePermission("accounting:view");
  const canManage = can(ctx.role, "accounting:manage");
  const active = await getActiveQuickBooksScope(prisma, ctx.company.id);
  if (!active.ok) redirect("/settings/quickbooks");
  const { view, filter, q, page, pageSize, sort, reason, differences, reviewed, selection } = await searchParams;
  const inbound = await loadInboundSyncCenter(prisma, active.scope);
  const reconciliation = view === "reconcile" ? await buildQuickBooksReconciliation(prisma, ctx.company.id, active.scope) : null;
  const reviews =
    view === "review" || view === "duplicates" || view === "conflicts"
      ? await loadQuickBooksReviewRows(prisma, active.scope, {
          view,
          filter,
          search: q,
          page: Number(page || "1"),
          pageSize: Number(pageSize || "25"),
          sort,
          reason,
          differences,
          reviewed,
        })
      : null;
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
          <AnalyzeImportControl
            resumeRunId={inbound.latestAnalysis?.status === "PAUSED" ? inbound.latestAnalysis.id : null}
            initialStatus={inbound.latestAnalysis?.status}
          />
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
              {row.objectType === "CUSTOMER" ? (
                <>
                  <li>Exact proposed matches {row.exact.toLocaleString()}</li>
                  <li>High-confidence proposed matches {row.high.toLocaleString()}</li>
                </>
              ) : null}
              <li>New {row.newCount.toLocaleString()}</li>
              <li>Updated {row.updated.toLocaleString()}</li>
              <li>Possible duplicates {row.duplicates.toLocaleString()}</li>
              <li>{row.objectType === "PAYMENT" ? "Payments with conflicts" : "Conflicts"} {row.conflicts.toLocaleString()}</li>
              {row.objectType === "PAYMENT" ? (
                <li>Conflict issues {row.conflictIssues.toLocaleString()}</li>
              ) : null}
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

      <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
        <h2 className="font-medium">Import readiness</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Typed confirmation cannot override an unresolved dependency, possible duplicate, or critical conflict.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {inbound.readiness.map((row) => (
            <div key={row.stage} className="rounded-xl border border-[var(--border)] p-3 text-sm">
              <p className="font-medium">Stage {row.stage} · {row.label}</p>
              <p className={row.ready ? "mt-1 text-emerald-700" : "mt-1 text-amber-700"}>
                {row.status.replaceAll("_", " ")}
              </p>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">{row.reason}</p>
            </div>
          ))}
        </div>
      </section>

      <details className="rounded-2xl border border-[var(--border)] bg-white p-5">
        <summary className="cursor-pointer font-medium">Analysis definitions</summary>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          {Object.entries(ANALYSIS_STATUS_DEFINITIONS).map(([status, definition]) => (
            <div key={status}>
              <dt className="font-medium">{status.replaceAll("_", " ")}</dt>
              <dd className="text-[var(--muted-foreground)]">{definition}</dd>
            </div>
          ))}
        </dl>
      </details>

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
                  <p className="mt-1 text-xs font-medium text-amber-700">
                    {inbound.readiness.find((row) => row.stage === stage)?.status.replaceAll("_", " ")}
                  </p>
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                    Type {IMPORT_CONFIRMATION} to confirm. There is no import-everything button.
                  </p>
                  <input type="hidden" name="stage" value={String(stage)} />
                  {inbound.latestImport?.status === "PAUSED" && inbound.latestImport.objectType === `STAGE_${stage}` ? (
                    <input type="hidden" name="resumeRunId" value={inbound.latestImport.id} />
                  ) : null}
                  <Input
                    name="confirm"
                    className="mt-3"
                    placeholder={IMPORT_CONFIRMATION}
                    autoComplete="off"
                    disabled={!inbound.readiness.find((row) => row.stage === stage)?.ready}
                  />
                  <Button
                    type="submit"
                    size="sm"
                    className="mt-3"
                    disabled={!inbound.readiness.find((row) => row.stage === stage)?.ready}
                  >
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
          <form method="get" className="mt-4 flex flex-wrap items-end gap-2">
            <input type="hidden" name="view" value={view} />
            <Input
              name="q"
              defaultValue={q}
              placeholder="Search name, phone, email, or address"
              className="w-full sm:w-80"
            />
            <select name="reason" defaultValue={reason || ""} className="h-8 rounded-lg border border-[var(--border)] bg-white px-2 text-sm">
              <option value="">All match reasons</option>
              <option value="email">Email</option>
              <option value="phone">Phone</option>
              <option value="name">Name</option>
              <option value="address">Address</option>
              <option value="external ID">External ID</option>
            </select>
            <select name="differences" defaultValue={differences || ""} className="h-8 rounded-lg border border-[var(--border)] bg-white px-2 text-sm">
              <option value="">Any differences</option>
              <option value="yes">Has differences</option>
              <option value="no">No differences</option>
            </select>
            <select name="reviewed" defaultValue={reviewed || ""} className="h-8 rounded-lg border border-[var(--border)] bg-white px-2 text-sm">
              <option value="">Reviewed + unreviewed</option>
              <option value="reviewed">Reviewed</option>
              <option value="unreviewed">Unreviewed</option>
            </select>
            <select name="sort" defaultValue={sort || "highest"} className="h-8 rounded-lg border border-[var(--border)] bg-white px-2 text-sm">
              <option value="highest">Highest confidence</option>
              <option value="lowest">Lowest confidence</option>
              <option value="name">Customer name</option>
              <option value="differences">Most differences</option>
            </select>
            <select name="pageSize" defaultValue={String(reviews?.pageSize || 25)} className="h-8 rounded-lg border border-[var(--border)] bg-white px-2 text-sm">
              <option value="25">25 per page</option>
              <option value="50">50 per page</option>
              <option value="100">100 per page</option>
            </select>
            <Button type="submit" size="sm" variant="outline">Search</Button>
          </form>
          {view === "review" && reviews ? (
            <nav className="mt-3 flex flex-wrap gap-2 text-xs">
              {[
                ["", "All", reviews.counts.all],
                ["exact", "Exact Matches", reviews.counts.exact],
                ["high", "High Confidence", reviews.counts.high],
                ["new", "New Customers", reviews.counts.new],
                ["possible", "Possible Duplicates", reviews.counts.possible],
                ["reviewed", "Reviewed", reviews.counts.reviewed],
              ].map(([value, label, count]) => (
                <Link
                  key={label}
                  href={`/settings/quickbooks/manage?view=review${value ? `&filter=${value}` : ""}`}
                  className={cn(
                    "rounded-full border px-3 py-1",
                    (filter || "") === value ? "border-[var(--cy-orange)] text-[var(--cy-orange)]" : "border-[var(--border)]"
                  )}
                >
                  {label} ({Number(count).toLocaleString()})
                </Link>
              ))}
            </nav>
          ) : null}
          {reviews && view === "review" ? (
            <ReviewProgress progress={reviews.progress} readiness={inbound.readiness[0]} />
          ) : null}
          {!reviews || reviews.rows.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--muted-foreground)]">Nothing in this queue.</p>
          ) : (
            <ReviewSelection
              pageIds={reviews.rows.map((row) => row.id)}
              confidenceFilter={filter}
              safeExact={reviews.safeBulk.exact}
              unsafeExact={reviews.safeBulk.unsafeExact}
              safeNew={reviews.safeBulk.new}
              exactTotal={reviews.progress.exact.total}
              search={q}
              reason={reason}
              differences={differences}
              reviewed={reviewed}
              filteredTotal={reviews.total}
              analysisRunId={inbound.latestAnalysis?.id || ""}
              initialSelectionMode={selection === "all" ? "ALL_FILTERED" : "NONE"}
              filterKey={[view, filter, q, pageSize, sort, reason, differences, reviewed].join("|")}
            >
            <div className="mt-4 space-y-6">
              <p className="text-sm text-[var(--muted-foreground)]">
                Showing {reviews.from.toLocaleString()}–{reviews.to.toLocaleString()} of {reviews.total.toLocaleString()}
              </p>
              {Object.entries(groupReviews(reviews.rows)).map(([objectType, grouped]) => (
                <div key={objectType}>
                  {view === "conflicts" ? (
                    <h3 className="border-b border-[var(--border)] pb-2 text-sm font-semibold">
                      {objectType.replaceAll("_", " ")} · {grouped.length}
                    </h3>
                  ) : null}
                  <ul className="divide-y divide-[var(--border)]">
                    {grouped.map((row) => (
                <li key={row.id} className="py-4">
                  <div className="flex items-start gap-2">
                    <ReviewCheckbox id={row.id} />
                    <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        {row.displayName} · {row.objectType}
                      </p>
                      {row.matchedFields.length ? (
                        <p className="mt-1 text-xs text-emerald-700">
                          Matched: {row.matchedFields.join(", ")}
                        </p>
                      ) : null}
                      {row.differingFields.length ? (
                        <p className="mt-1 text-xs text-amber-700">
                          Different: {row.differingFields.join(", ")}
                        </p>
                      ) : null}
                      {row.conflictReasons.length ? (
                        <ul className="mt-2 list-disc pl-4 text-xs text-rose-700">
                          {row.conflictReasons.map((reason) => <li key={reason}>{reason}</li>)}
                        </ul>
                      ) : null}
                      <p className="text-sm text-[var(--muted-foreground)]">{row.reason}</p>
                      <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                        QuickBooks {row.quickbooksId} · {row.confidence} · {row.status}
                      </p>
                    </div>
                    <div className="text-right">
                      <StatusBadge status={row.confidence === "POSSIBLE" || row.confidence === "CONFLICT" ? "NEEDS_REVIEW" : row.status} />
                      <p className="mt-1 text-xs font-medium text-[var(--muted-foreground)]">
                        {row.confidence.replaceAll("_", " ")}
                        {row.confidenceScore > 0 ? ` · ${row.confidenceScore}%` : ""}
                      </p>
                    </div>
                    </div>
                  </div>
                  {row.objectType === "CUSTOMER" ? (
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <CustomerSide title="QuickBooks" values={row.qbo} differing={row.differingFields} />
                      <CustomerSide
                        title="ContractorYou"
                        values={row.contractorYou || {
                          name: "No candidate",
                          company: null,
                          phone: null,
                          email: null,
                          serviceAddress: null,
                        }}
                        differing={row.differingFields}
                      />
                    </div>
                  ) : null}
                  {row.objectType === "CUSTOMER" && row.confidence === "POSSIBLE" && row.candidates.length ? (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs">
                      <p className="font-semibold">Plausible ContractorYou candidates</p>
                      <ul className="mt-2 space-y-1">
                        {row.candidates.map((candidate) => (
                          <li key={candidate.id} className="flex flex-wrap items-center justify-between gap-2">
                            <span>{candidate.name} · {candidate.phone || "no phone"} · {candidate.email || "no email"} · {candidate.address || "no property address"}</span>
                            <ActionForm action={applyQuickBooksReviewAction}>
                              <input type="hidden" name="reviewId" value={row.id} />
                              <input type="hidden" name="decision" value="LINK" />
                              <input type="hidden" name="targetCustomerId" value={candidate.id} />
                              <Button type="submit" size="sm" variant="outline">Link this customer</Button>
                            </ActionForm>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {canManage && row.objectType === "CUSTOMER" ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {row.confidence === "EXACT" || row.confidence === "HIGH" ? (
                        <>
                          <ReviewButton reviewId={row.id} decision="APPROVE" label="Approve Match" />
                          <ReviewButton reviewId={row.id} decision="NOT_SAME" label="Not Same Customer" />
                          <ReviewButton reviewId={row.id} decision="MANUAL_REVIEW" label="Review Details" />
                        </>
                      ) : row.confidence === "NONE" ? (
                        <>
                          <ReviewButton reviewId={row.id} decision="APPROVE_NEW" label="Approve as New Customer" />
                          <ReviewButton reviewId={row.id} decision="MOVE_DUPLICATE" label="Move to Possible Duplicate" />
                          <ReviewButton reviewId={row.id} decision="IGNORE" label="Ignore" />
                        </>
                      ) : (
                        <>
                          <ActionForm action={applyQuickBooksReviewAction} className="flex flex-wrap items-end gap-2">
                            <input type="hidden" name="reviewId" value={row.id} />
                            <input type="hidden" name="decision" value="LINK" />
                            <Input name="targetCustomerId" placeholder="ContractorYou customer ID" className="w-56" />
                            <Button type="submit" size="sm" variant="outline">Link Existing Customer</Button>
                          </ActionForm>
                          <ReviewButton reviewId={row.id} decision="CREATE" label="Create New Customer" />
                          <MergeReviewForm reviewId={row.id} />
                          <ReviewButton reviewId={row.id} decision="IGNORE" label="Ignore" />
                          <ReviewButton reviewId={row.id} decision="NOT_DUPLICATE" label="Not a Duplicate" />
                        </>
                      )}
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
                </div>
              ))}
              <nav className="flex items-center justify-between gap-3 border-t border-[var(--border)] pt-4 text-sm">
                {reviews.page > 1 ? (
                  <Link href={reviewPageHref({ view, filter, q, page: reviews.page - 1, pageSize: reviews.pageSize, sort, reason, differences, reviewed, selection })} className="text-[var(--cy-orange)]">
                    ← Previous
                  </Link>
                ) : <span />}
                <span>Page {reviews.page} of {reviews.totalPages}</span>
                {reviews.page < reviews.totalPages ? (
                  <Link href={reviewPageHref({ view, filter, q, page: reviews.page + 1, pageSize: reviews.pageSize, sort, reason, differences, reviewed, selection })} className="text-[var(--cy-orange)]">
                    Next →
                  </Link>
                ) : <span />}
              </nav>
            </div>
            </ReviewSelection>
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

type ReviewResult = Awaited<ReturnType<typeof loadQuickBooksReviewRows>>;
type ReviewRow = ReviewResult["rows"][number];

function groupReviews(rows: ReviewRow[]) {
  return rows.reduce<Record<string, ReviewRow[]>>((groups, row) => {
    (groups[row.objectType] ??= []).push(row);
    return groups;
  }, {});
}

function reviewPageHref(input: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  return `/settings/quickbooks/manage?${params.toString()}`;
}

function ReviewProgress({
  progress,
  readiness,
}: {
  progress: ReviewResult["progress"];
  readiness: { ready: boolean; status: string; reason: string };
}) {
  return (
    <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--cy-gray)]/40 p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.12em]">Stage 1 review progress</p>
      <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <ReviewProgressItem label="Exact Matches" total={progress.exact.total} done={progress.exact.approved} remaining={progress.exact.remaining} />
        <ReviewProgressItem label="High Confidence" total={progress.high.total} done={progress.high.approved} remaining={progress.high.remaining} />
        <ReviewProgressItem label="New Customers" total={progress.new.total} done={progress.new.approved} remaining={progress.new.remaining} />
        <ReviewProgressItem label="Possible Duplicates" total={progress.possible.total} done={progress.possible.resolved} remaining={progress.possible.remaining} />
      </dl>
      <p className={`mt-3 text-sm font-medium ${readiness.ready ? "text-emerald-700" : "text-amber-700"}`}>
        Stage 1 readiness: {readiness.ready ? "READY TO IMPORT" : "NOT READY"} · {readiness.reason}
      </p>
    </div>
  );
}

function ReviewProgressItem({
  label,
  total,
  done,
  remaining,
}: {
  label: string;
  total: number;
  done: number;
  remaining: number;
}) {
  return (
    <div>
      <dt className="font-medium">{label}</dt>
      <dd>{total.toLocaleString()} total · {done.toLocaleString()} approved/resolved · {remaining.toLocaleString()} remaining</dd>
    </div>
  );
}

function CustomerSide({
  title,
  values,
  differing,
}: {
  title: string;
  values: {
    name: string;
    company?: string | null;
    phone?: string | null;
    email?: string | null;
    billingAddress?: string | null;
    serviceAddress?: string | null;
  };
  differing: string[];
}) {
  const fields = [
    ["Name", values.name, differing.some((field) => field.includes("name"))],
    ["Company", values.company, differing.includes("company")],
    ["Phone", values.phone, differing.includes("phone")],
    ["Email", values.email, differing.includes("email")],
    ["Billing address", values.billingAddress, differing.includes("billing address")],
    ["Service/property address", values.serviceAddress, differing.includes("service address")],
  ] as const;
  return (
    <div className="rounded-xl border border-[var(--border)] p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">{title}</p>
      <dl className="mt-2 space-y-1 text-sm">
        {fields.map(([label, value, different]) => (
          <div key={label} className={different ? "rounded bg-amber-50 px-1 text-amber-950" : ""}>
            <dt className="inline text-[var(--muted-foreground)]">{label}: </dt>
            <dd className="inline">{value || "—"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ReviewButton({
  reviewId,
  decision,
  label,
}: {
  reviewId: string;
  decision: string;
  label: string;
}) {
  return (
    <ActionForm action={applyQuickBooksReviewAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="reviewId" value={reviewId} />
      <input type="hidden" name="decision" value={decision} />
      <Button type="submit" size="sm" variant="outline">
        {label}
      </Button>
    </ActionForm>
  );
}

function MergeReviewForm({ reviewId }: { reviewId: string }) {
  return (
    <ActionForm action={applyQuickBooksReviewAction} className="flex flex-wrap items-end gap-2 rounded-lg border border-amber-200 p-2">
      <input type="hidden" name="reviewId" value={reviewId} />
      <input type="hidden" name="decision" value="MERGE" />
      <Input name="targetCustomerId" placeholder="Surviving customer ID" className="w-48" />
      <Input name="confirmation" placeholder="REVIEW MERGE MAPPING" className="w-52" />
      <Button type="submit" size="sm" variant="outline">Confirm Proposed Merge</Button>
    </ActionForm>
  );
}
