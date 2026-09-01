import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { requireAssignedJob, mapsUrl, propertyAddress, fieldStatusLabel } from "@/lib/tech/access";
import { nextTechnicianAction } from "@/lib/playbooks/engine";
import { loadJobWorkflowView } from "@/lib/playbooks/job-view";
import { customerHasActiveMembership, unitPriceForCustomer, searchPricebookWhere } from "@/lib/pricebook/pricing";
import { formatMoney } from "@/lib/money";
import { optionTotals } from "@/lib/estimates/totals";
import { membershipPlanValueLines } from "@/lib/memberships/plans";
import { customerLabel } from "@/lib/tech/today";
import { fieldCtaForStep, fieldSectionForStep } from "@/lib/tech/next-step";
import { JobWorkflowPanel } from "@/components/playbooks/job-workflow";
import { PricebookPicker } from "@/components/pricebook/picker";
import { FieldStatusButtons } from "@/components/tech/field-status";
import { JobNotesForm } from "@/components/tech/job-notes";
import { JobPhotoUpload } from "@/components/tech/job-photos";
import { EquipmentForm } from "@/components/tech/equipment-form";
import { TechEstimateActions } from "@/components/tech/estimate-actions";
import { TechInvoicePay } from "@/components/tech/invoice-pay";
import { TechMembershipSell } from "@/components/tech/membership-sell";
import { TechReceiptUpload } from "@/components/tech/receipt-upload";
import { CompleteJobPanel } from "@/components/tech/complete-job";
import { WorkspaceSection } from "@/components/tech/workspace-section";
import { Reveal } from "@/components/tech/reveal";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createDraftEstimateForJobAction } from "@/server/actions/estimate-options";
import { createInvoiceFromJobAction } from "@/server/actions/field";
import { stripeClientConfigured, stripePublishableKey } from "@/lib/payments/config";
import { appUrl } from "@/lib/payments/config";
import { syncOpenStripePaymentsForInvoice } from "@/lib/payments/sync";
import { CompanySmsForm } from "@/components/highlevel/company-sms-form";

export default async function TechJobWorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requirePermission("jobs:view");
  const { job: assigned } = await requireAssignedJob(id);

  const [full, workflow, plans, receipts, assignedMembership, pickerItems, membership, stripeAccount] = await Promise.all([
    prisma.job.findFirst({
      where: { id: assigned.id, companyId: ctx.company.id },
      include: {
        customer: true,
        property: { include: { equipment: { orderBy: { createdAt: "desc" } } } },
        playbook: { select: { name: true } },
        assignments: { include: { user: { select: { firstName: true, lastName: true } } } },
        estimates: {
          include: {
            options: { orderBy: { sortOrder: "asc" }, include: { lineItems: true } },
            lineItems: true,
          },
          orderBy: { createdAt: "desc" },
        },
        invoices: { include: { payments: true, lineItems: true }, orderBy: { createdAt: "desc" } },
        photos: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 24 },
        customerMemberships: { include: { plan: true }, orderBy: { createdAt: "desc" } },
      },
    }),
    loadJobWorkflowView(ctx.company.id, assigned.id),
    prisma.membershipPlan.findMany({
      where: { companyId: ctx.company.id, active: true },
      orderBy: { name: "asc" },
    }),
    prisma.receipt.findMany({
      where: { companyId: ctx.company.id, jobId: assigned.id },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
    prisma.membership.findUnique({
      where: { companyId_userId: { companyId: ctx.company.id, userId: ctx.user.id } },
      select: { assignedVehicleId: true },
    }),
    prisma.pricebookItem.findMany({
      where: searchPricebookWhere(ctx.company.id, ""),
      include: { category: { select: { name: true } } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      take: 20,
    }),
    customerHasActiveMembership(prisma, ctx.company.id, assigned.customerId),
    prisma.stripeConnectAccount.findUnique({ where: { companyId: ctx.company.id } }),
  ]);

  if (!full) notFound();

  const previousJobs = await prisma.job.findMany({
    where: { companyId: ctx.company.id, customerId: full.customerId, id: { not: full.id } },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: { id: true, jobType: true, status: true, completedAt: true, createdAt: true, description: true },
  });

  const customerName = customerLabel(full.customer);
  const addr = propertyAddress(full.property);
  const maps = mapsUrl(addr);
  const phone = full.customer.phone;
  const activeMembership = full.customerMemberships.find((row) => row.status === "ACTIVE") ?? full.customerMemberships[0];
  const estimate = full.estimates[0] ?? null;
  let invoice = full.invoices[0] ?? null;
  if (invoice) {
    await syncOpenStripePaymentsForInvoice(prisma, ctx.company.id, invoice.id);
    invoice =
      (await prisma.invoice.findFirst({
        where: { id: invoice.id, companyId: ctx.company.id },
        include: { payments: true, lineItems: true },
      })) ?? invoice;
  }
  const next = workflow ? nextTechnicianAction(workflow.definition, new Set(workflow.completedStepIds)) : null;
  const remaining = workflow?.remaining ?? [];
  const warrantyJob = /warranty/i.test(`${full.jobType ?? ""} ${full.description ?? ""}`);

  const canEstimate = can(ctx.role, "estimates:manage");
  const canInvoice = can(ctx.role, "invoices:field");
  const canPay = can(ctx.role, "invoices:field");
  const canMembership = can(ctx.role, "memberships:manage");
  const canOverride = can(ctx.role, "jobs:manage");
  const canDiscount = can(ctx.role, "estimates:discount");
  const canEditEquipment = can(ctx.role, "equipment:manage");
  const canReceipts = can(ctx.role, "receipts:manage");

  const membershipRule = canMembership
    ? await prisma.compensationRule.findFirst({
        where: { companyId: ctx.company.id, active: true, trigger: "MEMBERSHIP_SOLD" },
        select: { amountCents: true },
      })
    : null;

  const nextSection = next ? fieldSectionForStep(next) : remaining[0] ? fieldSectionForStep(remaining[0]) : null;
  const noteCount = Number(Boolean(full.internalNotes)) + Number(Boolean(full.customerNotes));

  return (
    <div className="space-y-5">
      <div>
        <Link href="/tech/jobs" className="text-xs font-medium text-[var(--muted-foreground)]">
          ← Today&apos;s jobs
        </Link>
        <h1 className="mt-1 font-display text-2xl tracking-tight">{customerName}</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          {full.playbook?.name || full.jobType || "Job"} · {fieldStatusLabel(full.status)}
        </p>
      </div>

      {next ? (
        <section id="next" className="rounded-2xl bg-[var(--cy-navy)] p-4 text-white shadow-lg">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--cy-orange)]">Next step</p>
          <h2 className="mt-1 text-xl font-semibold">{next.title}</h2>
          <p className="mt-1 text-sm text-white/70">{next.when}</p>
          <Link
            href={`#${fieldSectionForStep(next)}`}
            className={cn(buttonVariants(), "mt-3 inline-flex h-12 min-w-[10rem] items-center justify-center")}
          >
            {fieldCtaForStep(next)}
          </Link>
        </section>
      ) : remaining.length === 0 ? (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-900">Playbook requirements are complete.</p>
          <p className="mt-1 text-xs text-emerald-800">Finish the job when the work is done.</p>
        </section>
      ) : null}

      <section id="overview" className="rounded-2xl border border-[var(--border)] bg-white p-4">
        <p className="text-sm">{addr}</p>
        {full.scheduledStart ? (
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {full.scheduledStart.toLocaleString()}
            {full.scheduledEnd
              ? ` – ${full.scheduledEnd.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
              : ""}
          </p>
        ) : null}
        {full.description ? <p className="mt-2 text-sm">{full.description}</p> : null}
        {activeMembership ? (
          <p className="mt-2 inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
            {activeMembership.plan.name} · {activeMembership.status}
          </p>
        ) : (
          <p className="mt-2 text-xs text-[var(--muted-foreground)]">No membership on this property.</p>
        )}
        {full.property.accessNotes ? (
          <p className="mt-2 text-sm">Access: {full.property.accessNotes}</p>
        ) : null}
        {warrantyJob ? (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            This job looks like warranty work. Capture equipment, failed part, and photos. Vendor claims are not
            submitted from the field yet.
          </p>
        ) : null}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <a
            href={maps}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-[var(--muted)] text-sm font-medium"
          >
            Directions
          </a>
          {phone ? (
            <a
              href={`tel:${phone}`}
              title="Device call. Company browser calling is not available."
              className="inline-flex h-11 items-center justify-center rounded-xl bg-[var(--muted)] text-sm font-medium"
            >
              Device call
            </a>
          ) : (
            <span className="inline-flex h-11 items-center justify-center rounded-xl bg-[var(--muted)] text-sm text-[var(--muted-foreground)]">
              No phone
            </span>
          )}
        </div>
        {phone ? <CompanySmsForm to={phone} customerId={full.customer.id} /> : null}
        <FieldStatusButtons jobId={full.id} status={full.status} />
      </section>

      <WorkspaceSection
        id="playbook"
        title="Job details"
        summary={workflow ? workflow.playbookName : "No playbook"}
        open={nextSection === "playbook" || nextSection === "overview"}
      >
        <p className="text-xs text-[var(--muted-foreground)]">Follow the playbook. You are not editing it.</p>
        {workflow ? (
          <JobWorkflowPanel
            jobId={full.id}
            playbookName={workflow.playbookName}
            customerName={customerName}
            scheduledLabel=""
            definition={workflow.definition}
            currentStageKey={workflow.currentStageKey}
            completedStepIds={workflow.completedStepIds}
            remaining={remaining}
            checklist={workflow.checklist}
            customerPhone={phone}
            customerId={full.customer.id}
            propertyAddress={addr}
            canAct={full.status !== "COMPLETED" && full.status !== "CANCELED"}
            compact
          />
        ) : (
          <p className="rounded-2xl border border-dashed border-[var(--border)] bg-white px-4 py-8 text-center text-sm text-[var(--muted-foreground)]">
            No playbook is attached to this job.
          </p>
        )}
      </WorkspaceSection>

      <WorkspaceSection
        id="customer"
        title="Customer & history"
        summary={previousJobs.length ? `${previousJobs.length} previous job${previousJobs.length === 1 ? "" : "s"}` : "No previous service"}
      >
        <p className="mt-2 text-sm">{customerName}</p>
        <p className="text-sm text-[var(--muted-foreground)]">
          {full.customer.phone ?? "No phone"} · {full.customer.email ?? "No email"}
        </p>
        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          Previous jobs
        </h3>
        {previousJobs.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">No previous service history.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {previousJobs.map((job) => (
              <li key={job.id} className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm">
                <p className="font-medium">{job.jobType || "Job"}</p>
                <p className="text-xs text-[var(--muted-foreground)]">
                  {job.status} · {(job.completedAt ?? job.createdAt).toLocaleDateString()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </WorkspaceSection>

      <WorkspaceSection
        id="equipment"
        title="Equipment"
        summary={
          full.property.equipment.length
            ? `${full.property.equipment.length} system${full.property.equipment.length === 1 ? "" : "s"} added`
            : "No equipment recorded"
        }
        open={nextSection === "equipment"}
      >
        {full.property.equipment.length ? (
          <ul className="mt-3 space-y-2">
            {full.property.equipment.map((eq) => (
              <li key={eq.id} className="rounded-xl border border-[var(--border)] p-3 text-sm">
                <p className="font-medium">
                  {eq.name}
                  {eq.manufacturer || eq.model ? ` · ${[eq.manufacturer, eq.model].filter(Boolean).join(" ")}` : ""}
                </p>
                <p className="text-xs text-[var(--muted-foreground)]">
                  Serial {eq.serialNumber ?? "—"} · Installed {eq.installDate?.toLocaleDateString() ?? "—"}
                </p>
                {eq.notes ? <p className="mt-1 text-xs">{eq.notes}</p> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">No equipment on this property yet.</p>
        )}
        {canEditEquipment ? (
          <Reveal label="Add equipment" defaultOpen={nextSection === "equipment" && full.property.equipment.length === 0}>
            <EquipmentForm
              jobId={full.id}
              customerId={full.customerId}
              propertyId={full.propertyId}
              warrantyJob={warrantyJob}
            />
            <div className="mt-3">
              <p className="mb-2 text-xs text-[var(--muted-foreground)]">Capture a data plate while you add it.</p>
              <JobPhotoUpload jobId={full.id} equipment={full.property.equipment} defaultKind="DATA_PLATE" defaultOpen />
            </div>
          </Reveal>
        ) : null}
      </WorkspaceSection>

      <WorkspaceSection
        id="options"
        title="Options & estimate"
        summary={
          estimate
            ? `${estimate.options.length || 1} option${(estimate.options.length || 1) === 1 ? "" : "s"} · ${estimate.status}`
            : "Not started"
        }
        open={nextSection === "options"}
      >
        {estimate ? (
          <div className="mt-2 space-y-3">
            <p className="text-sm">
              {estimate.estimateNumber} · {estimate.status}
              {estimate.totalCents ? ` · ${formatMoney(estimate.totalCents)}` : ""}
            </p>
            {estimate.options.length > 0 ? (
              <ul className="space-y-2">
                {estimate.options.map((opt) => {
                  const totals = optionTotals(opt.lineItems);
                  return (
                    <li key={opt.id} className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm">
                      <p className="font-medium">
                        {opt.name} · {formatMoney(totals.totalCents)}
                        {estimate.approvedOptionId === opt.id ? " · Approved" : ""}
                      </p>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        {opt.lineItems.length} line{opt.lineItems.length === 1 ? "" : "s"}
                      </p>
                      {canEstimate ? (
                        <PricebookPicker
                          estimateId={estimate.id}
                          optionId={opt.id}
                          customerId={full.customerId}
                          initialItems={pickerItems.map((item) => ({
                            id: item.id,
                            name: item.name,
                            sku: item.sku,
                            type: item.type,
                            category: item.category.name,
                            customerDescription: item.customerDescription,
                            technicianNotes: item.technicianNotes,
                            standardPriceCents: item.standardPriceCents,
                            memberPriceCents: item.memberPriceCents,
                            unitPriceCents: unitPriceForCustomer({
                              standardPriceCents: item.standardPriceCents,
                              memberPriceCents: item.memberPriceCents,
                              eligible: Boolean(membership),
                            }),
                            memberEligible: Boolean(membership) && item.memberPriceCents != null,
                            unit: item.unit,
                          }))}
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-xs text-[var(--muted-foreground)]">No Good / Better / Best options yet.</p>
            )}
            {canEstimate ? (
              <TechEstimateActions
                estimateId={estimate.id}
                jobId={full.id}
                canDiscount={canDiscount}
                maxDiscountBps={ctx.company.techDiscountLimitBps}
              />
            ) : null}
            {estimate.publicToken ? (
              <Link
                href={`/tech/jobs/${full.id}/present`}
                className={cn(buttonVariants(), "flex h-12 items-center justify-center")}
              >
                Present to customer
              </Link>
            ) : null}
          </div>
        ) : canEstimate ? (
          <form
            action={async () => {
              "use server";
              await createDraftEstimateForJobAction(full.id);
            }}
            className="mt-3"
          >
            <Button type="submit" className="h-12 w-full">
              Build options
            </Button>
          </form>
        ) : (
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">You do not have permission to build estimates.</p>
        )}
      </WorkspaceSection>

      <WorkspaceSection
        id="photos"
        title="Photos & notes"
        summary={`${full.photos.length} photo${full.photos.length === 1 ? "" : "s"} · ${noteCount} note${noteCount === 1 ? "" : "s"}`}
        open={nextSection === "photos"}
      >
        <JobPhotoUpload jobId={full.id} equipment={full.property.equipment} defaultOpen={nextSection === "photos"} />
        {full.photos.length ? (
          <ul className="mt-3 grid grid-cols-3 gap-2">
            {full.photos.map((photo) => (
              <li key={photo.id} className="overflow-hidden rounded-lg border border-[var(--border)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/job-photos/${photo.id}`} alt={photo.kind} className="aspect-square w-full object-cover" />
                <p className="px-1 py-0.5 text-[10px] text-[var(--muted-foreground)]">
                  {photo.kind.replaceAll("_", " ")}
                  {photo.caption ? ` · ${photo.caption}` : ""}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">No job photos yet.</p>
        )}
        <Reveal label="Add notes">
          <JobNotesForm jobId={full.id} internalNotes={full.internalNotes} customerNotes={full.customerNotes} />
        </Reveal>
      </WorkspaceSection>

      <WorkspaceSection
        id="costs"
        title="Costs & receipts"
        summary={receipts.length ? `${receipts.length} receipt${receipts.length === 1 ? "" : "s"}` : "None"}
      >
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          Assign a receipt to this job, your truck, or a company expense. Company profitability is not shown here.
        </p>
        {canReceipts ? (
          <TechReceiptUpload jobId={full.id} defaultVehicleId={assignedMembership?.assignedVehicleId} />
        ) : null}
        {receipts.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">No receipts on this job.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {receipts.map((receipt) => (
              <li key={receipt.id} className="rounded-xl border border-[var(--border)] px-3 py-2">
                {receipt.vendor ?? "Receipt"} ·{" "}
                {receipt.totalCents != null ? formatMoney(receipt.totalCents) : "Amount pending"} · {receipt.processingStatus}
              </li>
            ))}
          </ul>
        )}
      </WorkspaceSection>

      <WorkspaceSection
        id="invoice"
        title="Invoice & payment"
        summary={
          invoice
            ? `${formatMoney(invoice.totalCents)} · ${invoice.balanceCents === 0 ? "Paid" : invoice.status}`
            : "No invoice"
        }
        open={nextSection === "invoice"}
      >
        {invoice ? (
          <TechInvoicePay
            invoice={{
              id: invoice.id,
              invoiceNumber: invoice.invoiceNumber,
              status: invoice.status,
              totalCents: invoice.totalCents,
              amountPaidCents: invoice.amountPaidCents,
              balanceCents: invoice.balanceCents,
              publicToken: invoice.publicToken,
            }}
            canPay={canPay}
            card={
              stripeClientConfigured() &&
              stripeAccount &&
              !stripeAccount.disabledAt &&
              stripeAccount.chargesEnabled &&
              stripePublishableKey()
                ? {
                    publishableKey: stripePublishableKey(),
                    stripeAccountId: stripeAccount.stripeAccountId,
                    returnUrl: `${appUrl()}/tech/jobs/${full.id}`,
                  }
                : null
            }
          />
        ) : canInvoice ? (
          <form
            action={async () => {
              "use server";
              await createInvoiceFromJobAction(full.id);
            }}
            className="mt-3"
          >
            <Button type="submit" className="h-12 w-full">
              Create invoice from approved work
            </Button>
          </form>
        ) : (
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">No invoice yet.</p>
        )}
      </WorkspaceSection>

      <WorkspaceSection
        id="membership"
        title="Membership"
        summary={activeMembership ? `${activeMembership.plan.name} · ${activeMembership.status}` : "None"}
        open={nextSection === "membership"}
      >
        {activeMembership ? (
          <p className="mt-2 text-sm">
            {activeMembership.plan.name} is already on this customer ({activeMembership.status}).
          </p>
        ) : canMembership ? (
          <TechMembershipSell
            customerId={full.customerId}
            propertyId={full.propertyId}
            jobId={full.id}
            plans={plans.map((plan) => ({
              id: plan.id,
              name: plan.name,
              priceCents: plan.priceCents,
              billingFrequency: plan.billingFrequency,
              lines: membershipPlanValueLines(plan),
            }))}
            incentiveHint={
              membershipRule?.amountCents
                ? { amountCents: membershipRule.amountCents, status: "PENDING" }
                : null
            }
          />
        ) : (
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">No membership on this property.</p>
        )}
      </WorkspaceSection>

      <section id="complete" className="rounded-2xl border border-[var(--border)] bg-white p-4">
        <CompleteJobPanel
          jobId={full.id}
          remaining={remaining}
          canOverride={canOverride}
          jobStatus={full.status}
        />
      </section>
    </div>
  );
}
