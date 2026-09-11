"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatDate, formatDateTime } from "@/lib/datetime";
import { formatMoney } from "@/lib/money";
import { StatusBadge } from "@/components/status-badge";
import { CustomerPhotoGallery } from "@/components/customers/photo-gallery";
import { JobPhotoUpload } from "@/components/tech/job-photos";

const TABS = ["jobs", "estimates", "invoices", "payments", "equipment", "photos"] as const;

type Tab = (typeof TABS)[number];

export function CustomerHistoryTabs({
  jobBase,
  jobsHref,
  estimatesHref,
  invoicesHref,
  paymentsHref,
  timeZone,
  canSeeMoney,
  jobs,
  estimates,
  invoices,
  payments,
  equipment,
  photos,
  photoJobId,
}: {
  jobBase: string;
  jobsHref: string;
  estimatesHref: string;
  invoicesHref: string;
  paymentsHref: string;
  timeZone?: string | null;
  canSeeMoney: boolean;
  jobs: Array<{
    id: string;
    jobNumber: string;
    jobType: string | null;
    status: string;
    when: Date | string;
    technician: string | null;
    amountCents: number | null;
    historical?: boolean;
    sourceSystem?: string | null;
  }>;
  estimates: Array<{
    id: string;
    estimateNumber: string;
    status: string;
    totalCents: number;
    issueDate: Date | string;
  }>;
  invoices: Array<{
    id: string;
    invoiceNumber: string;
    status: string;
    totalCents: number;
    balanceCents: number;
    dueDate: Date | string | null;
    importMode?: string | null;
    sourceSystem?: string | null;
  }>;
  payments: Array<{
    id: string;
    amountCents: number;
    paidAt: Date | string | null;
    method: string | null;
    invoiceId: string | null;
    sourceSystem?: string | null;
    importMode?: string | null;
  }>;
  equipment: Array<{
    id: string;
    name: string;
    manufacturer: string | null;
    model: string | null;
    equipmentType: string | null;
    installDate: Date | string | null;
  }>;
  photos: Array<{
    id: string;
    kind: string;
    kindLabel: string;
    caption: string | null;
    createdAt: Date;
    equipmentId: string | null;
    job: { jobNumber: string };
    uploadedBy: { firstName: string; lastName: string } | null;
  }>;
  photoJobId?: string | null;
}) {
  const visibleTabs = TABS.filter((tab) => tab !== "invoices" && tab !== "payments" ? true : canSeeMoney);
  const [tab, setTab] = useState<Tab>("jobs");
  const current = visibleTabs.includes(tab) ? tab : "jobs";
  const viewAll = useMemo(() => {
    if (current === "jobs") return jobsHref;
    if (current === "estimates") return estimatesHref;
    if (current === "invoices") return invoicesHref;
    if (current === "payments") return paymentsHref;
    return null;
  }, [current, estimatesHref, invoicesHref, jobsHref, paymentsHref]);

  return (
    <section id="history" className="rounded-2xl border border-[var(--border)] bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--cy-navy)]">History</h2>
        {viewAll ? (
          <Link href={viewAll} className="text-sm text-[var(--cy-orange)] hover:underline">
            View all →
          </Link>
        ) : null}
      </div>
      <div className="mt-3 flex gap-1 overflow-x-auto pb-1">
        {visibleTabs.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={`rounded-full px-3 py-1 text-xs capitalize ${
              current === item ? "bg-[var(--cy-navy)] text-white" : "bg-[var(--cy-gray)] text-[var(--cy-navy)]"
            }`}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="mt-3">
        {current === "jobs" ? (
          <HistoryList
            empty="No completed jobs yet."
            items={jobs.slice(0, 8).map((job) => ({
              href: `${jobBase}/${job.id}`,
              title: `${job.jobNumber} · ${job.jobType || (job.historical ? "Historical service" : "Job")}`,
              detail: [
                formatDate(job.when, timeZone),
                job.technician,
                job.amountCents != null ? formatMoney(job.amountCents) : null,
                job.historical ? `Source: ${job.sourceSystem === "HOUSECALL_PRO" ? "Housecall Pro" : job.sourceSystem || "Import"}` : null,
              ]
                .filter(Boolean)
                .join(" · "),
              status: job.historical ? "HISTORICAL" : job.status,
            }))}
          />
        ) : null}
        {current === "estimates" ? (
          <HistoryList
            empty="No estimates yet."
            items={estimates.slice(0, 5).map((row) => ({
              href: `/estimates/${row.id}`,
              title: `${row.estimateNumber} · ${formatMoney(row.totalCents)}`,
              detail: formatDate(row.issueDate, timeZone),
              status: row.status,
            }))}
          />
        ) : null}
        {current === "invoices" ? (
          <HistoryList
            empty="No invoices yet."
            items={invoices.slice(0, 8).map((row) => ({
              href: `/invoices/${row.id}`,
              title: `${row.invoiceNumber} · ${formatMoney(row.totalCents)}`,
              detail: [
                row.importMode === "HISTORICAL" ? "Historical" : row.dueDate ? `Due ${formatDate(row.dueDate, timeZone)}` : row.status,
                row.sourceSystem === "QUICKBOOKS" ? "Source: QuickBooks" : row.sourceSystem ? `Source: ${row.sourceSystem}` : null,
              ]
                .filter(Boolean)
                .join(" · "),
              status: row.importMode === "HISTORICAL" ? "HISTORICAL" : row.status,
            }))}
          />
        ) : null}
        {current === "payments" ? (
          <HistoryList
            empty="No payments recorded."
            items={payments.slice(0, 5).map((row) => ({
              href: row.invoiceId ? `/invoices/${row.invoiceId}` : "/payments",
              title: formatMoney(row.amountCents),
              detail: [row.paidAt ? formatDateTime(row.paidAt, timeZone) : null, row.method].filter(Boolean).join(" · "),
            }))}
          />
        ) : null}
        {current === "equipment" ? (
          <HistoryList
            empty="No equipment recorded."
            items={equipment.slice(0, 5).map((item) => ({
              href: `#equipment`,
              title: [item.manufacturer, item.name].filter(Boolean).join(" ") || "Equipment",
              detail: [item.equipmentType, item.model, item.installDate ? formatDate(item.installDate, timeZone) : null]
                .filter(Boolean)
                .join(" · "),
            }))}
          />
        ) : null}
        {current === "photos" ? (
          <div>
            <CustomerPhotoGallery photos={photos} />
            {photoJobId ? (
              <div className="mt-3">
                <JobPhotoUpload jobId={photoJobId} equipment={equipment.map((item) => ({ id: item.id, name: item.name }))} defaultKind="BEFORE" />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function HistoryList({
  empty,
  items,
}: {
  empty: string;
  items: { href: string; title: string; detail: string; status?: string }[];
}) {
  if (items.length === 0) return <p className="text-sm text-[var(--muted-foreground)]">{empty}</p>;
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={`${item.href}-${item.title}`}>
          <Link
            href={item.href}
            className="flex items-center justify-between gap-3 rounded-xl px-2 py-2 text-sm hover:bg-[var(--cy-gray)]"
          >
            <span>
              <span className="font-medium text-[var(--cy-navy)]">{item.title}</span>
              {item.detail ? <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">{item.detail}</span> : null}
            </span>
            {item.status ? <StatusBadge status={item.status} /> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}
