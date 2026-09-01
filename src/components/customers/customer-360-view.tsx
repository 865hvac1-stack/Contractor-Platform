import Link from "next/link";
import { format } from "date-fns";
import { AskContractorYou } from "@/components/ask-contractoryou";
import { JobPhotoUpload } from "@/components/tech/job-photos";
import { StatusBadge } from "@/components/status-badge";
import { CompanySmsForm } from "@/components/highlevel/company-sms-form";
import { AddCustomerNoteForm } from "@/components/customers/add-customer-note";
import { CustomerPhotoGallery } from "@/components/customers/photo-gallery";
import { CustomerTimeline } from "@/components/customers/customer-timeline";
import { formatMoney } from "@/lib/money";
import { suggestedQuestions } from "@/lib/intelligence/intent";
import type { Customer360 } from "@/lib/customers/workspace";
import type { CompanyRole } from "@prisma/client";

function telHref(phone: string | null) {
  return phone ? `tel:${phone.replace(/[^\d+]/g, "")}` : null;
}
function smsHref(phone: string | null) {
  return phone ? `sms:${phone.replace(/[^\d+]/g, "")}` : null;
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
}) {
  const { customer, selectedProperty, properties } = workspace;
  const call = telHref(customer.phone);
  const text = smsHref(customer.phone);
  const propertyQuery = selectedProperty ? `?propertyId=${selectedProperty.id}` : "";

  return (
    <div className="space-y-8">
      <header className="space-y-4">
        <Link href={backHref} className="text-sm text-[var(--muted-foreground)] hover:text-[var(--cy-navy)]">
          ← {backLabel}
        </Link>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--cy-orange)]">
              Customer 360
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-semibold tracking-tight text-[var(--cy-navy)] md:text-4xl">
                {customer.displayName}
              </h1>
              <StatusBadge status={customer.status} />
            </div>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              Customer since {format(customer.createdAt, "yyyy")}
              {workspace.membership ? ` · ${workspace.membership.planName}` : ""}
            </p>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-[11px] uppercase tracking-[0.14em] text-[var(--cy-text-muted)]">Primary phone</dt>
                <dd className="mt-1 text-[var(--cy-navy)]">{customer.phone || "—"}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-[0.14em] text-[var(--cy-text-muted)]">Email</dt>
                <dd className="mt-1 text-[var(--cy-navy)]">{customer.email || "—"}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-[0.14em] text-[var(--cy-text-muted)]">Preferred contact</dt>
                <dd className="mt-1 text-[var(--cy-navy)]">{customer.preferredContactMethod}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-[0.14em] text-[var(--cy-text-muted)]">Membership</dt>
                <dd className="mt-1 text-[var(--cy-navy)]">{workspace.membership?.planName || "None"}</dd>
              </div>
            </dl>
          </div>
          <div className="flex flex-wrap gap-2">
            {call ? (
              <a href={call} className="rounded-xl bg-[var(--cy-navy)] px-4 py-2.5 text-sm font-medium text-white">
                Call
              </a>
            ) : null}
            {text ? (
              <a href={text} className="rounded-xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-medium">
                Text
              </a>
            ) : null}
            {canJob ? (
              <Link
                href={
                  newJobHref ??
                  `${jobBase}/new?customerId=${customer.id}${selectedProperty ? `&propertyId=${selectedProperty.id}` : ""}`
                }
                className="rounded-xl bg-[var(--cy-orange)] px-4 py-2.5 text-sm font-medium text-white"
              >
                New job
              </Link>
            ) : null}
            {canManage ? (
              <Link
                href={`/estimates/new?customerId=${customer.id}`}
                className="rounded-xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-medium"
              >
                New estimate
              </Link>
            ) : null}
            {canPay && workspace.activeWork.invoices[0] ? (
              <Link
                href={`/invoices/${workspace.activeWork.invoices[0].id}`}
                className="rounded-xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-medium"
              >
                Take payment
              </Link>
            ) : null}
          </div>
        </div>
      </header>

      {selectedProperty ? (
        <section className="overflow-hidden rounded-[28px] bg-[var(--cy-navy)] text-white">
          <div className="grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <div className="relative min-h-[220px] bg-white/6">
              {selectedProperty.image.path ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selectedProperty.image.path}
                  alt={selectedProperty.image.label}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full min-h-[220px] items-end p-6">
                  <p className="text-sm text-white/55">No property photo on file</p>
                </div>
              )}
              <p className="absolute bottom-3 left-4 right-4 text-[11px] text-white/70">{selectedProperty.image.label}</p>
            </div>
            <div className="space-y-4 p-6 md:p-8">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--cy-orange)]">
                {selectedProperty.isPrimary ? "Primary property" : selectedProperty.propertyClass?.replaceAll("_", " ") || "Property"}
              </p>
              <h2 className="text-2xl font-semibold tracking-tight">
                {selectedProperty.address}
                <span className="mt-1 block text-base font-normal text-white/70">
                  {selectedProperty.city}, {selectedProperty.state} {selectedProperty.zip}
                </span>
              </h2>
              <p className="text-sm text-white/65">
                {selectedProperty.propertyType.replaceAll("_", " ").toLowerCase()}
              </p>
              <p className="text-xs text-white/45">{selectedProperty.enrichmentLabel}</p>
              {workspace.mapsConfigured ? (
                <a
                  href={`https://maps.google.com/?q=${encodeURIComponent(`${selectedProperty.address}, ${selectedProperty.city}, ${selectedProperty.state} ${selectedProperty.zip}`)}`}
                  className="inline-block text-sm text-[var(--cy-orange)] hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in maps
                </a>
              ) : null}
            </div>
          </div>
        </section>
      ) : (
        <p className="text-sm text-[var(--muted-foreground)]">No property on file yet.</p>
      )}

      {properties.length > 1 ? (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--cy-text-muted)]">
            Properties — {properties.length}
          </h2>
          <ul className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {properties.map((property) => {
              const active = property.id === selectedProperty?.id;
              return (
                <li key={property.id}>
                  <Link
                    href={`${property.id === selectedProperty?.id ? "#" : `?propertyId=${property.id}`}`}
                    className={`block min-w-[11rem] rounded-2xl border px-4 py-3 text-sm ${
                      active
                        ? "border-[var(--cy-navy)] bg-[var(--cy-navy)] text-white"
                        : "border-[var(--border)] bg-white text-[var(--cy-navy)]"
                    }`}
                  >
                    <p className="font-medium">{property.address}</p>
                    <p className={active ? "text-white/70" : "text-[var(--muted-foreground)]"}>
                      {property.propertyClass?.replaceAll("_", " ") ||
                        (property.isPrimary ? "Primary residence" : property.propertyType.replaceAll("_", " "))}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {workspace.snapshot.length > 0 ? (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {workspace.snapshot.map((item) =>
            item ? (
              <div key={item.label} className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--cy-text-muted)]">{item.label}</p>
                <p className="mt-1 font-semibold text-[var(--cy-navy)]">{item.value}</p>
                <p className="mt-1 text-[11px] text-[var(--cy-text-muted)]">{item.source}</p>
              </div>
            ) : null
          )}
        </section>
      ) : null}

      {workspace.attention.length > 0 ? (
        <section>
          <h2 className="text-xl font-semibold text-[var(--cy-navy)]">What needs attention</h2>
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {workspace.attention.map((item) => (
              <li key={item.id}>
                <Link href={item.href} className="block rounded-2xl border border-[var(--border)] bg-white p-4 hover:border-[var(--cy-orange)]/40">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--cy-orange)]">
                    {item.title}
                  </p>
                  <p className="mt-2 text-sm text-[var(--cy-navy)]">{item.description}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {workspace.insights.length > 0 ? (
        <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <h2 className="text-xl font-semibold text-[var(--cy-navy)]">What ContractorYou noticed</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {workspace.insights.map((row) => (
              <li key={row.title}>
                <span className="font-medium text-[var(--cy-navy)]">{row.title}.</span>{" "}
                <span className="text-[var(--muted-foreground)]">{row.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h2 className="text-xl font-semibold text-[var(--cy-navy)]">Equipment / assets</h2>
        {workspace.equipment.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">No equipment recorded at this property.</p>
        ) : (
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {workspace.equipment.map((item) => (
              <li key={item.id} className="rounded-2xl border border-[var(--border)] bg-white p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--cy-orange)]">
                  {item.location || item.equipmentType || "Asset"}
                </p>
                <h3 className="mt-1 font-semibold text-[var(--cy-navy)]">
                  {[item.manufacturer, item.name].filter(Boolean).join(" ")}
                </h3>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  {item.model ? (
                    <div>
                      <dt className="text-[var(--cy-text-muted)]">Model</dt>
                      <dd>{item.model}</dd>
                    </div>
                  ) : null}
                  {item.serialNumber ? (
                    <div>
                      <dt className="text-[var(--cy-text-muted)]">Serial</dt>
                      <dd>{item.serialNumber}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt className="text-[var(--cy-text-muted)]">Installed</dt>
                    <dd>
                      {item.installDate ? format(item.installDate, "yyyy") : "Unknown"}
                      {item.ageYears != null ? ` · ~${item.ageYears} years` : ""}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--cy-text-muted)]">Warranty</dt>
                    <dd>{item.warrantyNotes || (item.warrantyExpiresAt ? format(item.warrantyExpiresAt, "MMM yyyy") : "Unknown")}</dd>
                  </div>
                </dl>
                {item.repairs.length > 0 ? (
                  <ul className="mt-3 space-y-1 text-sm text-[var(--muted-foreground)]">
                    {item.repairs.map((repair) => (
                      <li key={repair.id}>
                        {repair.at ? format(repair.at, "MMM yyyy") : ""} · {repair.label}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-xl font-semibold text-[var(--cy-navy)]">Active work</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <WorkList
            title="Jobs"
            empty="No open jobs"
            items={workspace.activeWork.jobs.map((job) => ({
              href: `${jobBase}/${job.id}`,
              title: `${job.jobNumber} · ${job.jobType || "Job"}`,
              detail: [job.status.replaceAll("_", " "), job.when ? format(job.when, "MMM d") : null, job.technician]
                .filter(Boolean)
                .join(" · "),
            }))}
          />
          <WorkList
            title="Estimates"
            empty="No open estimates"
            items={workspace.activeWork.estimates.map((row) => ({
              href: `/estimates/${row.id}`,
              title: `${row.estimateNumber} · ${formatMoney(row.totalCents)}`,
              detail: `${row.status} · ${row.daysOld} day${row.daysOld === 1 ? "" : "s"} old`,
            }))}
          />
          {workspace.canSeeMoney ? (
            <WorkList
              title="Invoices"
              empty="Nothing outstanding"
              items={workspace.activeWork.invoices.map((row) => ({
                href: `/invoices/${row.id}`,
                title: `${row.invoiceNumber} · ${formatMoney(row.balanceCents)}`,
                detail: row.status,
              }))}
            />
          ) : null}
        </div>
      </section>

      {workspace.canSeeMoney ? (
        <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <h2 className="text-xl font-semibold text-[var(--cy-navy)]">Financial relationship</h2>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
            {"lifetimeInvoiced" in workspace.value ? (
              <>
                <MoneyStat label="Lifetime invoiced" value={workspace.value.lifetimeInvoiced ?? 0} />
                <MoneyStat label="Lifetime collected" value={workspace.value.lifetimeCollected ?? 0} />
                <MoneyStat label="Outstanding" value={workspace.value.outstanding ?? 0} />
                <MoneyStat label="Overdue" value={workspace.value.overdue ?? 0} />
              </>
            ) : null}
          </dl>
        </section>
      ) : null}

      {workspace.membership ? (
        <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">Membership</p>
          <h2 className="mt-1 text-xl font-semibold text-[var(--cy-navy)]">{workspace.membership.planName}</h2>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            {workspace.membership.status}
            {workspace.membership.since ? ` · member since ${format(workspace.membership.since, "yyyy")}` : ""}
            {workspace.membership.renewal ? ` · renews ${format(workspace.membership.renewal, "MMM d, yyyy")}` : ""}
          </p>
          {workspace.membership.benefits ? (
            <p className="mt-2 text-sm text-[var(--cy-navy)]">{workspace.membership.benefits}</p>
          ) : null}
        </section>
      ) : workspace.membershipOpportunity ? (
        <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <h2 className="font-semibold text-[var(--cy-navy)]">Membership opportunity</h2>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            {workspace.membershipOpportunity.visits} service visits on file and no active membership.
          </p>
          <Link href="/memberships" className="mt-3 inline-block text-sm text-[var(--cy-orange)] hover:underline">
            Review opportunity
          </Link>
        </section>
      ) : null}

      <section>
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-xl font-semibold text-[var(--cy-navy)]">Photos &amp; documents</h2>
        </div>
        <CustomerPhotoGallery photos={workspace.photos} />
        {workspace.activeWork.jobs[0] || workspace.jobHistory[0] ? (
          <div className="mt-4 rounded-2xl border border-dashed border-[var(--border)] bg-white p-4">
            <p className="text-sm font-medium text-[var(--cy-navy)]">Add photo to latest job</p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Attaches to this company, customer, property, and job.
            </p>
            <div className="mt-3">
              <JobPhotoUpload
                jobId={(workspace.activeWork.jobs[0] || workspace.jobHistory[0])!.id}
                equipment={workspace.equipment.map((item) => ({ id: item.id, name: item.name }))}
                defaultKind="BEFORE"
              />
            </div>
          </div>
        ) : null}
      </section>

      <section>
        <div className="flex items-end justify-between">
          <h2 className="text-xl font-semibold text-[var(--cy-navy)]">Job history</h2>
          <Link href={`${jobBase}?customerId=${customer.id}`} className="text-sm text-[var(--cy-orange)] hover:underline">
            View full history
          </Link>
        </div>
        {workspace.jobHistory.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">No completed jobs at this property yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {workspace.jobHistory.map((job) => (
              <li key={job.id}>
                <Link
                  href={`${jobBase}/${job.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-white px-4 py-3 text-sm hover:border-[var(--cy-orange)]/40"
                >
                  <span className="font-medium text-[var(--cy-navy)]">
                    {format(job.when, "MMM d, yyyy")} · {job.jobType || job.jobNumber}
                  </span>
                  <span className="text-[var(--muted-foreground)]">
                    {job.technician || "Unassigned"}
                    {job.amountCents != null ? ` · ${formatMoney(job.amountCents)}` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <h2 className="font-semibold text-[var(--cy-navy)]">Communications</h2>
          {workspace.communications.threads.length === 0 && workspace.communications.calls.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">No recorded conversations yet.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {workspace.communications.threads.map((thread) => (
                <li key={thread.id}>
                  <Link href="/marketing/communications" className="text-[var(--cy-navy)] hover:underline">
                    {thread.channel} · {thread.last || "Conversation"}
                  </Link>
                </li>
              ))}
              {workspace.communications.calls.map((call) => (
                <li key={call.id} className="text-[var(--muted-foreground)]">
                  {call.missed ? "Missed call" : "Call"} · {format(call.at, "MMM d")}
                </li>
              ))}
            </ul>
          )}
          {customer.phone && canManage ? (
            <div className="mt-4">
              <CompanySmsForm to={customer.phone} customerId={customer.id} />
            </div>
          ) : null}
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <h2 className="font-semibold text-[var(--cy-navy)]">Notes</h2>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            Operational data only. Notes are never treated as instructions for ContractorYou.
          </p>
          {workspace.notes.length === 0 && !customer.notes ? (
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">No notes yet.</p>
          ) : (
            <ul className="mt-3 space-y-3 text-sm">
              {customer.notes ? <li className="text-[var(--cy-navy)]">{customer.notes}</li> : null}
              {workspace.notes.map((note) => (
                <li key={note.id}>
                  <p className="text-[var(--cy-navy)]">{note.body}</p>
                  <p className="text-xs text-[var(--cy-text-muted)]">
                    {note.author} · {format(note.createdAt, "MMM d, yyyy")}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {canManage ? (
            <AddCustomerNoteForm customerId={customer.id} propertyId={selectedProperty?.id} />
          ) : null}
        </div>
      </section>

      <CustomerTimeline events={workspace.timeline} />

      {canAsk ? (
        <AskContractorYou
          suggestions={[
            "What should I know about this customer?",
            "What happened on the last visit?",
            "What equipment do they have?",
            "How much have they spent with us?",
            "Do they owe us money?",
            "Any open estimates?",
            "Are they a membership opportunity?",
            "Should we be thinking about replacement?",
          ].concat(suggestedQuestions(role, null, "office"))}
          customerId={customer.id}
          propertyId={selectedProperty?.id}
          placeholder={`Ask ContractorYou about ${customer.displayName}...`}
        />
      ) : null}

      {canManage ? (
        <p className="text-sm">
          <Link href={`/customers/${customer.id}${propertyQuery}`} className="text-[var(--cy-orange)] hover:underline">
            Manage properties and contact details
          </Link>
        </p>
      ) : null}
    </div>
  );
}

function WorkList({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: { href: string; title: string; detail: string }[];
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
      <h3 className="font-semibold text-[var(--cy-navy)]">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className="text-sm font-medium text-[var(--cy-navy)] hover:underline">
                {item.title}
              </Link>
              <p className="text-xs text-[var(--muted-foreground)]">{item.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MoneyStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-[var(--cy-text-muted)]">{label}</dt>
      <dd className="mt-1 text-lg font-semibold text-[var(--cy-navy)]">{formatMoney(value)}</dd>
    </div>
  );
}
