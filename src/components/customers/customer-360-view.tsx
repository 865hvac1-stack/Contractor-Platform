import Link from "next/link";
import { AskContractorYou } from "@/components/ask-contractoryou";
import { StatusBadge } from "@/components/status-badge";
import { formatMoney } from "@/lib/money";
import { suggestedQuestions } from "@/lib/intelligence/intent";
import type { Customer360 } from "@/lib/customers/workspace";
import { CustomerWaitingBanner } from "@/components/waiting/customer-waiting-banner";
import type { CompanyRole } from "@prisma/client";
import { formatUsPhoneDisplay } from "@/lib/phone";
import { formatDate, formatDayTime, formatDurationSeconds } from "@/lib/datetime";
import {
  Customer360Actions,
  CustomerNoteTrigger,
  CustomerPropertyTrigger,
} from "@/components/customers/customer-360-actions";
import { CustomerHistoryTabs } from "@/components/customers/customer-history-tabs";
import { CustomerTimeline } from "@/components/customers/customer-timeline";

function telHref(phone: string | null) {
  return phone ? `tel:${phone.replace(/[^\d+]/g, "")}` : null;
}
function smsHref(customerId: string, phone: string | null) {
  return phone
    ? `/marketing/communications?compose=1&customerId=${encodeURIComponent(customerId)}&to=${encodeURIComponent(phone)}`
    : null;
}

export function Customer360View({
  workspace,
  role,
  backHref,
  backLabel,
  canManage,
  canJob,
  canPay,
  canAsk,
  jobBase = "/jobs",
  newJobHref,
  selfHref,
  timeZone,
}: {
  workspace: Customer360;
  role: CompanyRole;
  backHref: string;
  backLabel: string;
  canManage: boolean;
  canJob: boolean;
  canPay: boolean;
  canAsk: boolean;
  jobBase?: string;
  newJobHref?: string;
  selfHref: string;
  timeZone?: string | null;
}) {
  const { customer, selectedProperty, properties } = workspace;
  const call = telHref(customer.phone);
  const text = smsHref(customer.id, customer.phone);
  const jobHref =
    newJobHref ??
    `${jobBase}/new?customerId=${customer.id}${selectedProperty ? `&propertyId=${selectedProperty.id}` : ""}`;
  const editorProps = {
    customerId: customer.id,
    firstName: customer.firstName,
    lastName: customer.lastName,
    businessName: customer.businessName,
    phone: customer.phone,
    secondaryPhone: customer.secondaryPhone,
    email: customer.email,
    notes: customer.notes,
    preferredContactMethod: customer.preferredContactMethod,
    propertyId: selectedProperty?.id,
    address: selectedProperty?.address,
    city: selectedProperty?.city,
    propertyState: selectedProperty?.state,
    zip: selectedProperty?.zip,
  };
  const latestThread = workspace.communications.threads[0] ?? null;
  const latestCall = workspace.communications.calls[0] ?? null;
  const latestComms =
    latestThread && latestCall
      ? new Date(latestThread.at).getTime() >= new Date(latestCall.at).getTime()
        ? { kind: "thread" as const, thread: latestThread, call: null }
        : { kind: "call" as const, thread: null, call: latestCall }
      : latestThread
        ? { kind: "thread" as const, thread: latestThread, call: null }
        : latestCall
          ? { kind: "call" as const, thread: null, call: latestCall }
          : null;
  const topEquipment = workspace.equipment[0] ?? null;
  const glance = workspace.glance;

  return (
    <div className="space-y-5 pb-4">
      <header className="rounded-2xl border border-[var(--border)] bg-white p-4 md:p-5">
        <Link href={backHref} className="text-sm text-[var(--muted-foreground)] hover:text-[var(--cy-navy)]">
          ← {backLabel}
        </Link>
        <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-[var(--cy-navy)] md:text-3xl">
                {customer.displayName}
              </h1>
              <StatusBadge status={customer.status} />
            </div>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Customer since {formatDate(customer.createdAt, timeZone)}
              {workspace.membership ? ` · ${workspace.membership.planName}` : ""}
            </p>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-[11px] uppercase tracking-[0.12em] text-[var(--cy-text-muted)]">Phone</dt>
                <dd className="mt-0.5 text-[var(--cy-navy)]">
                  {call ? (
                    <a href={call} className="hover:underline">
                      {formatUsPhoneDisplay(customer.phone) || customer.phone}
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-[0.12em] text-[var(--cy-text-muted)]">Email</dt>
                <dd className="mt-0.5 text-[var(--cy-navy)]">
                  {customer.email ? (
                    <a href={`mailto:${customer.email}`} className="hover:underline">
                      {customer.email}
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-[0.12em] text-[var(--cy-text-muted)]">Preferred</dt>
                <dd className="mt-0.5 text-[var(--cy-navy)]">{customer.preferredContactMethod}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-[0.12em] text-[var(--cy-text-muted)]">Membership</dt>
                <dd className="mt-0.5 text-[var(--cy-navy)]">
                  {workspace.membership ? (
                    <Link href="/memberships" className="hover:underline">
                      {workspace.membership.planName}
                    </Link>
                  ) : (
                    "None"
                  )}
                </dd>
              </div>
            </dl>
            <div className="mt-3">
              {selectedProperty ? (
                <Link href={`${selfHref}?propertyId=${selectedProperty.id}`} className="block text-sm hover:underline">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--cy-text-muted)]">
                    {selectedProperty.isPrimary ? "Primary property" : "Property"}
                  </p>
                  <p className="mt-0.5 font-medium text-[var(--cy-navy)]">{selectedProperty.address}</p>
                  <p className="text-[var(--muted-foreground)]">
                    {selectedProperty.city}, {selectedProperty.state} {selectedProperty.zip}
                  </p>
                </Link>
              ) : canManage ? (
                <div className="text-sm">
                  <p className="text-[var(--muted-foreground)]">No property</p>
                  <CustomerPropertyTrigger editorProps={editorProps} compact />
                </div>
              ) : (
                <p className="text-sm text-[var(--muted-foreground)]">No property</p>
              )}
              {properties.length > 1 ? (
                <Link href="#properties" className="mt-1 inline-block text-sm text-[var(--cy-orange)] hover:underline">
                  Properties ({properties.length})
                </Link>
              ) : selectedProperty && canManage ? (
                <span className="mt-1 inline-flex gap-3">
                  <Link href={`${selfHref}?propertyId=${selectedProperty.id}`} className="text-sm text-[var(--cy-orange)] hover:underline">
                    View property
                  </Link>
                  <CustomerPropertyTrigger editorProps={editorProps} compact />
                </span>
              ) : null}
            </div>
          </div>
          <Customer360Actions
            {...editorProps}
            callHref={call}
            textHref={text}
            newJobHref={jobHref}
            newEstimateHref={`/estimates/new?customerId=${customer.id}`}
            canManage={canManage}
            canJob={canJob}
            canPay={canPay}
            takePaymentHref={workspace.activeWork.invoices[0] ? `/invoices/${workspace.activeWork.invoices[0].id}` : null}
          />
        </div>
      </header>

      <CustomerWaitingBanner items={workspace.activeWaiting} timezone={timeZone || "America/New_York"} />

      <section className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
        <GlanceCard
          label="Open jobs"
          value={String(glance.openJobs)}
          href="#active-work"
          empty={glance.openJobs === 0}
        />
        <GlanceCard
          label="Open estimates"
          value={
            glance.openEstimateCents != null && glance.openEstimates > 0
              ? `${glance.openEstimates} · ${formatMoney(glance.openEstimateCents)}`
              : String(glance.openEstimates)
          }
          href="#history"
          empty={glance.openEstimates === 0}
        />
        {canPay ? (
          <GlanceCard
            label="Balance due"
            value={formatMoney(glance.balanceDueCents ?? 0)}
            href="#active-work"
            empty={!glance.balanceDueCents}
          />
        ) : null}
        {canPay ? (
          <GlanceCard
            label="Lifetime value"
            value={formatMoney(glance.lifetimeValueCents ?? 0)}
            href="#financial"
            empty={!glance.lifetimeValueCents}
          />
        ) : null}
        <GlanceCard
          label="Membership"
          value={glance.membershipName || "None"}
          href="/memberships"
          empty={!glance.membershipName}
        />
      </section>

      {properties.length > 1 ? (
        <section id="properties" className="flex gap-2 overflow-x-auto">
          {properties.map((property) => {
            const active = property.id === selectedProperty?.id;
            return (
              <Link
                key={property.id}
                href={active ? selfHref : `${selfHref}?propertyId=${property.id}`}
                className={`min-w-[10rem] rounded-xl border px-3 py-2 text-sm ${
                  active ? "border-[var(--cy-navy)] bg-[var(--cy-navy)] text-white" : "border-[var(--border)] bg-white"
                }`}
              >
                <p className="font-medium">{property.address}</p>
                <p className={active ? "text-white/70" : "text-[var(--muted-foreground)]"}>
                  {property.city}, {property.state}
                </p>
              </Link>
            );
          })}
        </section>
      ) : null}

      {workspace.maintenance ? (
        <section className="rounded-2xl border border-[var(--border)] bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">Maintenance</p>
              <h2 className="mt-1 font-medium text-[var(--cy-navy)]">{workspace.maintenance.planName}</h2>
              {"label" in workspace.maintenance && workspace.maintenance.label ? (
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  Next visit: {workspace.maintenance.label}
                  {workspace.maintenance.scheduledDate
                    ? ` · ${workspace.maintenance.scheduledDate}`
                    : workspace.maintenance.dueStart
                      ? ` · Due ${workspace.maintenance.dueStart}–${workspace.maintenance.dueEnd}`
                      : ""}
                </p>
              ) : (
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">Active plan</p>
              )}
            </div>
            <Link href={workspace.maintenance.href} className="text-sm text-[var(--cy-orange)] hover:underline">
              {"status" in workspace.maintenance && workspace.maintenance.status === "SCHEDULED" ? "Open" : "Schedule"} →
            </Link>
          </div>
        </section>
      ) : null}

      {workspace.attention.length > 0 ? (
        <ul className="flex gap-2 overflow-x-auto">
          {workspace.attention.slice(0, 3).map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                className="block min-w-[14rem] rounded-xl border border-[var(--cy-orange)]/30 bg-white px-3 py-2 text-sm"
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--cy-orange)]">{item.title}</p>
                <p className="mt-1 text-[var(--cy-navy)]">{item.description}</p>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(18rem,0.9fr)]">
        <div className="space-y-5">
          <section id="active-work" className="rounded-2xl border border-[var(--border)] bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-[var(--cy-navy)]">Active work</h2>
              {canJob && workspace.activeWork.jobs.length === 0 && workspace.activeWork.estimates.length === 0 ? (
                <Link href={jobHref} className="text-sm text-[var(--cy-orange)] hover:underline">
                  + New job
                </Link>
              ) : null}
            </div>
            {workspace.activeWork.jobs.length === 0 &&
            workspace.activeWork.estimates.length === 0 &&
            workspace.activeWork.invoices.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                No active work.{" "}
                {canJob ? (
                  <Link href={jobHref} className="text-[var(--cy-orange)] hover:underline">
                    + New job
                  </Link>
                ) : null}
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {workspace.activeWork.jobs.map((job) => (
                  <li key={job.id}>
                    <Link
                      href={`${jobBase}/${job.id}`}
                      className="flex items-center justify-between gap-3 rounded-xl px-2 py-2 hover:bg-[var(--cy-gray)]"
                    >
                      <span>
                        <span className="text-sm font-semibold text-[var(--cy-navy)]">
                          Job {job.jobNumber}
                        </span>
                        <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">
                          {[job.jobType || "Job", job.when ? formatDayTime(job.when, timeZone) : "Unscheduled"]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                      <StatusBadge status={job.status} />
                    </Link>
                  </li>
                ))}
                {workspace.activeWork.estimates.map((row) => (
                  <li key={row.id}>
                    <Link
                      href={`/estimates/${row.id}`}
                      className="flex items-center justify-between gap-3 rounded-xl px-2 py-2 hover:bg-[var(--cy-gray)]"
                    >
                      <span>
                        <span className="text-sm font-semibold text-[var(--cy-navy)]">Estimate {row.estimateNumber}</span>
                        <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">
                          {formatMoney(row.totalCents)}
                        </span>
                      </span>
                      <StatusBadge status={row.status} />
                    </Link>
                  </li>
                ))}
                {workspace.activeWork.invoices.map((row) => (
                  <li key={row.id}>
                    <Link
                      href={`/invoices/${row.id}`}
                      className="flex items-center justify-between gap-3 rounded-xl px-2 py-2 hover:bg-[var(--cy-gray)]"
                    >
                      <span>
                        <span className="text-sm font-semibold text-[var(--cy-navy)]">Invoice {row.invoiceNumber}</span>
                        <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">
                          {formatMoney(row.balanceCents)} due
                        </span>
                      </span>
                      <StatusBadge status={row.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <CustomerHistoryTabs
            jobBase={jobBase}
            jobsHref={`${jobBase}?customerId=${customer.id}`}
            estimatesHref={`/estimates?customerId=${customer.id}`}
            invoicesHref={`/invoices?customerId=${customer.id}`}
            paymentsHref={`/payments?customerId=${customer.id}`}
            timeZone={timeZone}
            canSeeMoney={workspace.canSeeMoney}
            jobs={workspace.jobHistory}
            estimates={workspace.estimates}
            invoices={workspace.invoices}
            payments={workspace.payments}
            equipment={workspace.equipment}
            photos={workspace.photos}
            photoJobId={workspace.activeWork.jobs[0]?.id || workspace.jobHistory[0]?.id}
          />

          <CustomerTimeline events={workspace.timeline} timeZone={timeZone} />
        </div>

        <aside className="space-y-5">
          <section className="rounded-2xl border border-[var(--border)] bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-[var(--cy-navy)]">Communications</h2>
              {text ? (
                <Link href={text} className="text-sm text-[var(--cy-orange)] hover:underline">
                  Text
                </Link>
              ) : null}
            </div>
            {!latestComms ? (
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                No recorded conversations.{" "}
                {text ? (
                  <Link href={text} className="text-[var(--cy-orange)] hover:underline">
                    Text
                  </Link>
                ) : null}
              </p>
            ) : latestComms.kind === "thread" && latestComms.thread ? (
              <Link href={`/marketing/communications/${latestComms.thread.id}`} className="mt-2 block">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--cy-orange)]">
                  {latestComms.thread.channel} · {formatDayTime(latestComms.thread.at, timeZone)}
                </p>
                <p className="mt-1 text-sm text-[var(--cy-navy)]">
                  “{latestComms.thread.last || "Conversation"}”
                </p>
                <p className="mt-2 text-sm text-[var(--cy-orange)]">Open conversation</p>
              </Link>
            ) : latestComms.call ? (
              <Link
                href={`/marketing/communications?filter=${latestComms.call.missed ? "missed" : "today"}`}
                className="mt-2 block"
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--cy-orange)]">
                  {latestComms.call.missed ? "Missed call" : "Call"} · {formatDayTime(latestComms.call.at, timeZone)}
                </p>
                {latestComms.call.durationSeconds != null && !latestComms.call.missed ? (
                  <p className="mt-1 text-sm text-[var(--cy-navy)]">
                    {formatDurationSeconds(latestComms.call.durationSeconds)}
                  </p>
                ) : null}
              </Link>
            ) : null}
          </section>

          <section className="rounded-2xl border border-[var(--border)] bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-[var(--cy-navy)]">Notes</h2>
              {canManage ? <CustomerNoteTrigger customerId={customer.id} propertyId={selectedProperty?.id} /> : null}
            </div>
            {workspace.notes.length === 0 && !customer.notes ? (
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">No notes yet.</p>
            ) : (
              <ul className="mt-2 space-y-2 text-sm">
                {customer.notes ? <li className="text-[var(--cy-navy)]">{customer.notes}</li> : null}
                {workspace.notes.slice(0, 3).map((note) => (
                  <li key={note.id}>
                    <p className="text-[var(--cy-navy)]">{note.body}</p>
                    <p className="text-xs text-[var(--cy-text-muted)]">
                      {note.author} · {formatDate(note.createdAt, timeZone)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section id="equipment" className="rounded-2xl border border-[var(--border)] bg-white p-4">
            <h2 className="text-sm font-semibold text-[var(--cy-navy)]">
              Equipment{workspace.equipment.length > 1 ? ` (${workspace.equipment.length})` : ""}
            </h2>
            {!topEquipment ? (
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">No equipment</p>
            ) : (
              <div className="mt-2">
                <p className="text-sm font-medium text-[var(--cy-navy)]">
                  {[topEquipment.installDate ? new Date(topEquipment.installDate).getFullYear() : null, topEquipment.manufacturer, topEquipment.name || topEquipment.model]
                    .filter(Boolean)
                    .join(" ")}
                </p>
                <p className="text-xs text-[var(--muted-foreground)]">
                  {topEquipment.equipmentType || topEquipment.model || "Asset"}
                </p>
                <Link href="#history" className="mt-2 inline-block text-sm text-[var(--cy-orange)] hover:underline">
                  View equipment →
                </Link>
              </div>
            )}
          </section>

          {workspace.canSeeMoney ? (
            <section id="financial" className="rounded-2xl border border-[var(--border)] bg-white p-4">
              <h2 className="text-sm font-semibold text-[var(--cy-navy)]">Financial relationship</h2>
              {"lifetimeInvoiced" in workspace.value ? (
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <MoneyLink label="Lifetime invoiced" value={workspace.value.lifetimeInvoiced ?? 0} href={`/invoices?customerId=${customer.id}`} />
                  <MoneyLink label="Lifetime collected" value={workspace.value.lifetimeCollected ?? 0} href={`/payments?customerId=${customer.id}`} />
                  <MoneyLink label="Outstanding" value={workspace.value.outstanding ?? 0} href={`/invoices?customerId=${customer.id}`} />
                  <MoneyLink label="Overdue" value={workspace.value.overdue ?? 0} href={`/invoices?status=overdue&customerId=${customer.id}`} />
                </dl>
              ) : null}
            </section>
          ) : null}

          <section className="rounded-2xl border border-[var(--border)] bg-white p-4 text-sm">
            <h2 className="text-sm font-semibold text-[var(--cy-navy)]">Customer details</h2>
            <dl className="mt-3 space-y-2">
              <Detail label="Preferred contact" value={customer.preferredContactMethod} />
              <Detail label="Customer since" value={formatDate(customer.createdAt, timeZone)} />
              <Detail label="Source" value={customer.source || "—"} />
              <Detail
                label="Membership"
                value={workspace.membership?.planName || "None"}
                href="/memberships"
              />
              <Detail
                label="Primary property"
                value={
                  selectedProperty
                    ? `${selectedProperty.address}, ${selectedProperty.city}`
                    : "None"
                }
                href={selectedProperty ? `${selfHref}?propertyId=${selectedProperty.id}` : undefined}
              />
            </dl>
          </section>

          {canAsk ? (
            <AskContractorYou
              compact
              variant="bar"
              subtitle={`Ask anything about ${customer.displayName}.`}
              suggestions={[
                "What happened on the last visit?",
                "Any open estimates?",
                "Does this customer owe us money?",
                "What equipment do they have?",
                "Should we follow up?",
              ].concat(suggestedQuestions(role, null, "office")).slice(0, 5)}
              customerId={customer.id}
              propertyId={selectedProperty?.id}
              placeholder="What should I know about this customer?"
            />
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function GlanceCard({
  label,
  value,
  href,
  empty,
}: {
  label: string;
  value: string;
  href: string;
  empty?: boolean;
}) {
  return (
    <Link href={href} className="rounded-2xl border border-[var(--border)] bg-white px-3 py-3 hover:border-[var(--cy-orange)]/40">
      <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--cy-text-muted)]">{label}</p>
      <p className={`mt-1 text-sm font-semibold text-[var(--cy-navy)] ${empty ? "text-[var(--muted-foreground)]" : ""}`}>
        {value}
      </p>
    </Link>
  );
}

function MoneyLink({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.12em] text-[var(--cy-text-muted)]">{label}</dt>
      <dd className="mt-0.5">
        <Link href={href} className="font-semibold text-[var(--cy-navy)] hover:underline">
          {formatMoney(value)}
        </Link>
      </dd>
    </div>
  );
}

function Detail({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[var(--cy-text-muted)]">{label}</dt>
      <dd className="text-right text-[var(--cy-navy)]">
        {href ? (
          <Link href={href} className="hover:underline">
            {value}
          </Link>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
