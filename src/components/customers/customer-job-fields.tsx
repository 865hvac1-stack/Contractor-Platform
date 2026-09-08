"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  CustomerSearchCombobox,
  type CustomerSearchSelection,
} from "@/components/customers/search-combobox";
import type { CustomerJobHit } from "@/lib/customers/jobs";

export function CustomerJobFields({
  defaultCustomer = null,
  defaultJobId = "",
  canCreateCustomer = false,
  createHref,
  customerHrefPrefix = "/office/customers",
  jobRequired = false,
}: {
  defaultCustomer?: CustomerSearchSelection | null;
  defaultJobId?: string;
  canCreateCustomer?: boolean;
  createHref?: string;
  customerHrefPrefix?: string;
  jobRequired?: boolean;
}) {
  const [customer, setCustomer] = useState<CustomerSearchSelection | null>(defaultCustomer);
  const [jobId, setJobId] = useState(defaultJobId);
  const [jobs, setJobs] = useState<CustomerJobHit[]>([]);
  const [jobQuery, setJobQuery] = useState("");
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [jobOpen, setJobOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const selectedJob = jobs.find((job) => job.id === jobId) ?? null;

  useEffect(() => {
    if (!customer) {
      setJobs([]);
      setJobId("");
      setJobQuery("");
      return;
    }
    const handle = window.setTimeout(async () => {
      setLoadingJobs(true);
      const params = new URLSearchParams();
      if (jobQuery.trim().length >= 2) params.set("q", jobQuery.trim());
      const response = await fetch(`/api/customers/${customer.id}/jobs${params.size ? `?${params}` : ""}`);
      const data = (await response.json()) as { items?: CustomerJobHit[] };
      setJobs(data.items ?? []);
      setActiveIndex(0);
      setLoadingJobs(false);
    }, jobQuery.trim().length >= 2 ? 250 : 0);
    return () => window.clearTimeout(handle);
  }, [customer, jobQuery]);

  function chooseJob(job: CustomerJobHit) {
    setJobId(job.id);
    setJobQuery("");
    setJobOpen(false);
  }

  function clearCustomer() {
    setCustomer(null);
    setJobId("");
    setJobs([]);
    setJobQuery("");
    setJobOpen(false);
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <CustomerSearchCombobox
          selected={customer}
          onSelect={(next) => {
            setCustomer(next);
            setJobId("");
            setJobQuery("");
            setJobOpen(true);
          }}
          onClear={clearCustomer}
          canCreate={canCreateCustomer}
          createHref={createHref}
          customerHrefPrefix={customerHrefPrefix}
        />
      </div>
      <div className="space-y-2 sm:col-span-2">
        <input type="hidden" id="jobId" name="jobId" value={jobId} required={jobRequired} />
        <Label htmlFor="job-search">Job (optional)</Label>
        {!customer ? (
          <p className="rounded-xl border border-dashed border-[var(--border)] px-3 py-3 text-sm text-[var(--muted-foreground)]">
            Find a customer first. Jobs stay scoped to that customer.
          </p>
        ) : selectedJob ? (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-[var(--border)] bg-white px-3 py-3">
            <div className="min-w-0">
              <p className="font-medium text-[var(--cy-navy)]">#{selectedJob.jobNumber}</p>
              <p className="text-sm text-[var(--muted-foreground)]">
                {[selectedJob.serviceType, selectedJob.address, selectedJob.date, selectedJob.status]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <button
              type="button"
              className="shrink-0 text-sm font-medium underline"
              onClick={() => {
                setJobId("");
                setJobOpen(true);
              }}
            >
              Change
            </button>
          </div>
        ) : (
          <>
            <Input
              id="job-search"
              value={jobQuery}
              onChange={(event) => {
                setJobQuery(event.target.value);
                setJobOpen(true);
              }}
              onFocus={() => setJobOpen(true)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setJobOpen(false);
                }
                if (!jobs.length) return;
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveIndex((index) => (index + 1) % jobs.length);
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveIndex((index) => (index - 1 + jobs.length) % jobs.length);
                }
                if (event.key === "Enter" && jobOpen) {
                  event.preventDefault();
                  const job = jobs[activeIndex];
                  if (job) chooseJob(job);
                }
              }}
              placeholder="Search this customer's jobs…"
              autoComplete="off"
              className="h-12"
            />
            {loadingJobs ? <p className="text-sm text-[var(--muted-foreground)]">Loading jobs…</p> : null}
            {jobOpen && !loadingJobs && jobs.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[var(--border)] px-3 py-3 text-sm text-[var(--muted-foreground)]">
                No jobs for this customer. You can still create the invoice.
              </p>
            ) : null}
            {jobOpen && jobs.length > 0 ? (
              <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
                {jobs.map((job, index) => (
                  <li key={job.id}>
                    <button
                      type="button"
                      className={cn(
                        "flex min-h-14 w-full flex-col items-start px-4 py-3 text-left",
                        index === activeIndex && "bg-[var(--cy-gray)]"
                      )}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => chooseJob(job)}
                    >
                      <span className="font-medium text-[var(--cy-navy)]">
                        #{job.jobNumber}
                        {job.current ? (
                          <span className="ml-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--cy-orange)]">
                            Current
                          </span>
                        ) : null}
                      </span>
                      {job.serviceType ? <span className="text-sm text-[var(--cy-navy)]">{job.serviceType}</span> : null}
                      {[job.address, job.date, job.status].filter(Boolean).map((line) => (
                        <span key={line} className="text-sm text-[var(--muted-foreground)]">
                          {line}
                        </span>
                      ))}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
