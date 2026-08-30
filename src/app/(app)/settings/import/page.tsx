import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { RECORD_TYPE_LABELS, SOURCE_LABELS } from "@/lib/imports/types";
import { StartImportForm } from "@/components/imports/import-forms";
import { WizardSteps } from "@/components/imports/wizard-steps";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const COMING_SOON = [
  "Jobs",
  "Estimates",
  "Invoices",
  "Payments",
  "Equipment",
  "Memberships",
  "Pricebook items",
];

export default async function ImportDataPage() {
  const ctx = await requirePermission("imports:manage");
  const sessions = await prisma.importSession.findMany({
    where: { companyId: ctx.company.id },
    orderBy: { createdAt: "desc" },
    take: 40,
  });
  const customerCount = await prisma.customer.count({ where: { companyId: ctx.company.id } });

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <Link href="/settings" className="text-sm text-[var(--muted-foreground)]">
          ← Settings
        </Link>
        <h1 className="mt-2 font-display text-3xl tracking-tight">Import data</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--muted-foreground)]">
          Moving from another system? Upload a customer export and we will help you match the columns, preview the
          records, and import them safely into ContractorYou.
        </p>
      </div>

      <WizardSteps current={1} />

      {customerCount === 0 ? (
        <section className="rounded-2xl border border-dashed border-[var(--cy-orange)]/40 bg-white p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
            Import your existing customers
          </p>
          <h2 className="mt-2 font-display text-2xl">Bring your list with you</h2>
          <p className="mt-2 max-w-xl text-sm text-[var(--muted-foreground)]">
            Housecall Pro, ServiceTitan, Jobber, QuickBooks, or a spreadsheet you built yourself — upload the file
            you already have.
          </p>
        </section>
      ) : null}

      <section className="rounded-2xl border border-[var(--border)] bg-white p-6">
        <h2 className="font-semibold text-[var(--cy-navy)]">Start a customer import</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          File upload is supported now. Direct sync with another software only appears when that connection actually
          exists.
        </p>
        <div className="mt-5">
          <StartImportForm canImport={can(ctx.role, "imports:manage")} />
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-white p-6">
        <h2 className="font-semibold text-[var(--cy-navy)]">How it works</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-[var(--muted-foreground)]">
          <li>Export customers from the software you use today, or save a spreadsheet as CSV or Excel.</li>
          <li>Tell us which column contains the customer&apos;s phone number, email, and address.</li>
          <li>We show how many rows are ready, which look like duplicates, and which need a look.</li>
          <li>Nothing is added to your live list until you confirm.</li>
        </ol>
      </section>

      <section>
        <h2 className="font-semibold text-[var(--cy-navy)]">Later import types</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          The import engine is built so jobs, invoices, and the rest can plug in without a rebuild. They are foundation
          ready — not live yet.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {COMING_SOON.map((label) => (
            <div key={label} className="rounded-xl border border-dashed border-[var(--border)] bg-white px-4 py-3">
              <p className="font-medium">{label}</p>
              <p className="text-xs uppercase tracking-[0.14em] text-[var(--muted-foreground)]">Coming soon</p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold text-[var(--cy-navy)]">Import history</h2>
        {sessions.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-[var(--border)] bg-white p-6 text-sm text-[var(--muted-foreground)]">
            No imports yet. Upload a customer list to get started.
          </p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
            <ul className="divide-y divide-[var(--border)]">
              {sessions.map((session) => (
                <li key={session.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">
                      {RECORD_TYPE_LABELS[session.recordType]} · {SOURCE_LABELS[session.sourceType]}
                    </p>
                    <p className="text-sm text-[var(--muted-foreground)]">
                      {session.rowCount.toLocaleString()} rows · {session.fileName} ·{" "}
                      {session.createdAt.toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge status={session.status} />
                    <Link
                      href={`/settings/import/${session.id}`}
                      className={cn(buttonVariants({ variant: "outline" }), "h-8")}
                    >
                      View
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
