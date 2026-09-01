import Link from "next/link";
import { formatMoney } from "@/lib/money";
import { mapsUrl } from "@/lib/tech/access";
import type { Job360 } from "@/lib/jobs/job-360";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShowMoreText } from "@/components/jobs/show-more-text";
import { DeleteJobButton } from "@/components/jobs/delete-job-button";
import { cn } from "@/lib/utils";

function formatDate(d: Date | null | undefined) {
  if (!d) return null;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);
}

function formatDateTime(d: Date | null | undefined) {
  if (!d) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

function Section({
  title,
  children,
  id,
}: {
  title: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="space-y-3">
      <h2 className="font-display text-xl tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

export function Job360View({
  view,
  backHref,
  canCall,
  canEstimate,
  canInvoice,
  canViewMoney,
  canDelete,
}: {
  view: Job360;
  backHref: string;
  canCall: boolean;
  canEstimate: boolean;
  canInvoice: boolean;
  canViewMoney: boolean;
  canDelete: boolean;
}) {
  const service = view.job.serviceTypeName || view.job.jobType;
  const performedBy = view.technicians.assigned[0]?.name || view.technicians.importedName;
  const importedTechOnly = !view.technicians.assigned.length && Boolean(view.technicians.importedName);

  return (
    <div className="space-y-8 overflow-x-hidden">
      <div className="space-y-4">
        <Link href={backHref} className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
          ← Jobs
        </Link>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-3xl tracking-tight">{view.job.jobNumber}</h1>
              <StatusBadge status={view.job.status} />
              {view.job.historical ? <StatusBadge status="Historical import" /> : null}
            </div>
            {service ? <p className="text-base font-medium">{service}</p> : null}
            <p className="text-sm">
              <Link href={`/customers/${view.customer.id}`} className="font-medium hover:underline">
                {view.customer.name}
              </Link>
            </p>
            <p className="text-sm text-[var(--muted-foreground)]">{view.property.line}</p>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              {performedBy ? (
                <div>
                  <dt className="text-[var(--muted-foreground)]">Technician</dt>
                  <dd>{performedBy}</dd>
                </div>
              ) : null}
              {view.job.scheduledStart ? (
                <div>
                  <dt className="text-[var(--muted-foreground)]">Scheduled</dt>
                  <dd>{formatDateTime(view.job.scheduledStart)}</dd>
                </div>
              ) : null}
              {view.job.completedAt || view.import.occurredAt ? (
                <div>
                  <dt className="text-[var(--muted-foreground)]">
                    {view.job.completedAt ? "Completed" : "Original job date"}
                  </dt>
                  <dd>{formatDate(view.job.completedAt ?? view.import.occurredAt)}</dd>
                </div>
              ) : null}
            </dl>
          </div>
          <div className="flex flex-wrap gap-2">
            {canCall && view.customer.phone ? (
              <>
                <a href={`tel:${view.customer.phone}`} className={cn(buttonVariants({ variant: "outline" }), "h-10")}>
                  Call customer
                </a>
                <a href={`sms:${view.customer.phone}`} className={cn(buttonVariants({ variant: "outline" }), "h-10")}>
                  Text customer
                </a>
              </>
            ) : null}
            <a
              href={mapsUrl(view.property.line)}
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants({ variant: "outline" }), "h-10")}
            >
              Directions
            </a>
            {canEstimate && !view.job.historical ? (
              <Link href={`/estimates/new?jobId=${view.job.id}`} className={cn(buttonVariants({ variant: "outline" }), "h-10")}>
                Create estimate
              </Link>
            ) : null}
            {canInvoice && !view.job.historical ? (
              <Link href={`/invoices/new?jobId=${view.job.id}`} className={cn(buttonVariants({ variant: "outline" }), "h-10")}>
                Create invoice
              </Link>
            ) : null}
            {view.invoices[0] ? (
              <Link href={`/invoices/${view.invoices[0].id}`} className={cn(buttonVariants({ variant: "outline" }), "h-10")}>
                View invoice
              </Link>
            ) : null}
            {canDelete ? <DeleteJobButton jobId={view.job.id} jobNumber={view.job.jobNumber} /> : null}
          </div>
        </div>
        {view.job.historical ? (
          <p className="rounded-xl bg-[var(--cy-gray)] px-4 py-3 text-sm text-[var(--muted-foreground)]">
            Historical import from {view.import.sourceLabel}
            {view.import.externalId ? ` · Original job ${view.import.externalId}` : ""}
            {view.import.importedAt ? ` · Imported ${formatDate(view.import.importedAt)}` : ""}. ContractorYou did
            not message the customer, charge a card, or start billing from this import.
          </p>
        ) : null}
      </div>

      <Section title="What was done">
        <Card>
          <CardContent className="space-y-5 pt-6">
            {view.work.jobType ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                  Job type
                </p>
                <p className="mt-1 text-base font-medium">{view.work.jobType}</p>
              </div>
            ) : null}
            {canViewMoney && view.financials.importedTotalCents != null && view.financials.invoiceCents === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">
                Imported amount {formatMoney(view.financials.importedTotalCents)} — informational only.
              </p>
            ) : null}
            {view.work.blocks.map((block) => (
              <div key={`${block.key}-${block.label}`}>
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                  {block.label}
                </p>
                <div className="mt-2">
                  <ShowMoreText text={block.text} />
                </div>
              </div>
            ))}
            {view.lines.length ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                  Services on file
                </p>
                <ul className="mt-2 space-y-1 text-sm">
                  {view.lines.map((line) => (
                    <li key={line.id}>
                      <span className="font-medium">{line.name}</span>
                      {line.description ? (
                        <span className="text-[var(--muted-foreground)]"> — {line.description}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {view.work.emptyMessage ? (
              <p className="text-sm text-[var(--muted-foreground)]">{view.work.emptyMessage}</p>
            ) : null}
          </CardContent>
        </Card>
      </Section>

      <Section title="Assigned / performed by">
        <Card>
          <CardContent className="space-y-2 pt-6 text-sm">
            {view.technicians.assigned.length ? (
              view.technicians.assigned.map((tech) => <p key={tech.id}>{tech.name}</p>)
            ) : importedTechOnly ? (
              <div>
                <p className="font-medium">{view.technicians.importedName}</p>
                <p className="text-[var(--muted-foreground)]">
                  Historical technician. Imported from the previous system. Not a ContractorYou login.
                </p>
              </div>
            ) : (
              <p className="text-[var(--muted-foreground)]">No technician is recorded on this job.</p>
            )}
          </CardContent>
        </Card>
      </Section>

      <Section title="Equipment serviced">
        {view.equipment.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            No equipment records are linked to this service location.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {view.equipment.map((item) => (
              <Card key={item.id}>
                <CardHeader>
                  <CardTitle className="text-base">{item.name}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm text-[var(--muted-foreground)]">
                  {item.equipmentType ? <p>{item.equipmentType}</p> : null}
                  {item.manufacturer ? <p>{item.manufacturer}</p> : null}
                  {item.model ? <p>Model: {item.model}</p> : null}
                  {item.serialNumber ? <p>Serial: {item.serialNumber}</p> : null}
                  {item.installDate ? <p>Installed: {formatDate(item.installDate)}</p> : null}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Section>

      {canViewMoney ? (
        <Section title="Job financials">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MoneyCard label="Estimate" value={view.financials.estimateCents} />
            <MoneyCard label="Invoice" value={view.financials.invoiceCents} hideEmpty={false} />
            <MoneyCard label="Paid" value={view.financials.paidCents} hideEmpty={false} />
            <MoneyCard label="Balance" value={view.financials.balanceCents} hideEmpty={false} />
          </div>
          {view.financials.refundedCents > 0 ? (
            <p className="text-sm">Refunded {formatMoney(view.financials.refundedCents)}</p>
          ) : null}
          {view.financials.importedTotalCents != null && view.financials.invoiceCents === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">
              Imported job amount {formatMoney(view.financials.importedTotalCents)} — informational only, not an
              invoice or payment.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3 text-sm">
            {view.estimates.map((row) => (
              <Link key={row.id} href={`/estimates/${row.id}`} className="hover:underline">
                {row.estimateNumber} · {formatMoney(row.totalCents)}
              </Link>
            ))}
            {view.invoices.map((row) => (
              <Link key={row.id} href={`/invoices/${row.id}`} className="hover:underline">
                {row.invoiceNumber} · {formatMoney(row.totalCents)}
              </Link>
            ))}
          </div>
        </Section>
      ) : null}

      {view.lines.length ? (
        <Section title="Work & services">
          <Card>
            <CardContent className="divide-y divide-[var(--border)] pt-2">
              {view.lines.map((line) => (
                <div key={line.id} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm">
                  <div>
                    <p className="font-medium">{line.name}</p>
                    {line.description ? (
                      <p className="text-[var(--muted-foreground)]">{line.description}</p>
                    ) : null}
                    <p className="text-xs text-[var(--muted-foreground)]">
                      Qty {line.quantity} · {line.source === "invoice" ? "Invoice" : "Estimate"}
                    </p>
                  </div>
                  <p className="tabular-nums">{formatMoney(line.totalCents)}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </Section>
      ) : null}

      <Section title="Photos & documents">
        {view.photos.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            No photos or documents were included with this job.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {view.photos.map((photo) => (
              <a
                key={photo.id}
                href={photo.href}
                className="overflow-hidden rounded-xl border border-[var(--border)] bg-white"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.href} alt={photo.caption || photo.kind} className="h-36 w-full object-cover" />
                <p className="px-2 py-1 text-xs text-[var(--muted-foreground)]">{photo.kind}</p>
              </a>
            ))}
          </div>
        )}
      </Section>

      <Section title="Timeline">
        {view.timeline.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">No dated events are recorded yet.</p>
        ) : (
          <ol className="space-y-3">
            {view.timeline.map((item, index) => (
              <li key={`${item.title}-${item.at.toISOString()}-${index}`} className="flex gap-3 text-sm">
                <span className="w-36 shrink-0 text-[var(--muted-foreground)]">{formatDateTime(item.at)}</span>
                <span>
                  <span className="font-medium">{item.title}</span>
                  {item.detail ? <span className="block text-[var(--muted-foreground)]">{item.detail}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title="Customer history">
        <Card>
          <CardContent className="space-y-2 pt-6 text-sm">
            <p>Customer since: {formatDate(view.customer.since) ?? "—"}</p>
            <p>Jobs on file: {view.customer.jobCount}</p>
            <p>Last service: {formatDate(view.customer.lastService) ?? "—"}</p>
            <Link href={`/customers/${view.customer.id}`} className={cn(buttonVariants({ variant: "outline" }), "mt-2 h-9")}>
              View customer history
            </Link>
          </CardContent>
        </Card>
      </Section>

      <Section title="Other jobs at this property">
        {view.relatedJobs.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">No other jobs are on file at this location.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] bg-white">
            {view.relatedJobs.map((job) => (
              <li key={job.id}>
                <Link href={`/jobs/${job.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-[var(--cy-gray)]">
                  <span>
                    <span className="font-medium">{job.jobNumber}</span>
                    <span className="ml-2 text-sm text-[var(--muted-foreground)]">{job.label}</span>
                  </span>
                  <span className="text-sm text-[var(--muted-foreground)]">{formatDate(job.when)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {view.job.historical || view.import.fields.length ? (
        <details className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <summary className="cursor-pointer font-medium">Imported record details</summary>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[var(--muted-foreground)]">Source</dt>
              <dd>{view.import.sourceLabel}</dd>
            </div>
            {view.import.externalId ? (
              <div>
                <dt className="text-[var(--muted-foreground)]">Original job ID</dt>
                <dd className="break-all">{view.import.externalId}</dd>
              </div>
            ) : null}
            {view.import.importedAt ? (
              <div>
                <dt className="text-[var(--muted-foreground)]">Imported</dt>
                <dd>{formatDate(view.import.importedAt)}</dd>
              </div>
            ) : null}
            {view.import.fields
              .filter((field) => !view.work.blocks.some((block) => block.text === field.value))
              .map((field) => (
              <div key={field.key}>
                <dt className="text-[var(--muted-foreground)]">{field.label}</dt>
                <dd className="whitespace-pre-wrap break-words">{field.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}

      {canViewMoney && view.costing ? (
        <Section title="Job profitability">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MoneyCard label="Revenue" value={view.costing.revenueCents} hideEmpty={false} />
            <MoneyCard label="Direct cost" value={view.costing.directCostCents} hideEmpty={false} />
            <MoneyCard label="Gross profit" value={view.costing.grossProfitCents} hideEmpty={false} />
            <Card>
              <CardContent className="pt-6">
                <p className="text-xs text-[var(--muted-foreground)]">Gross margin</p>
                <p className="font-display text-2xl">
                  {view.costing.grossMarginPercent == null ? "—" : `${view.costing.grossMarginPercent}%`}
                </p>
              </CardContent>
            </Card>
          </div>
          <p className="text-sm text-[var(--muted-foreground)]">
            {view.costing.isFinal
              ? "Uses confirmed invoices and confirmed costs only."
              : "Not final while receipts still need review."}
          </p>
        </Section>
      ) : null}
    </div>
  );
}

function MoneyCard({
  label,
  value,
  hideEmpty = true,
}: {
  label: string;
  value: number | null;
  hideEmpty?: boolean;
}) {
  if (hideEmpty && (value == null || value === 0)) return null;
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs text-[var(--muted-foreground)]">{label}</p>
        <p className="font-display text-2xl tabular-nums">{value == null ? "—" : formatMoney(value)}</p>
      </CardContent>
    </Card>
  );
}

