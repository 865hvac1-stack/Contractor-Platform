import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { industries } from "@/lib/brand";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveTechDiscountLimitAction } from "@/server/actions/field";
import { getSequenceSettings } from "@/lib/sequences";
import { ensureCompanyServiceTypes } from "@/lib/trades/service-types";
import { prisma } from "@/lib/db";
import {
  createServiceTypeAction,
  saveInvoiceSequenceAction,
  savePrimaryTradeAction,
  updateServiceTypeAction,
} from "@/server/actions/service-types";

export default async function SettingsPage() {
  const ctx = await requirePermission("company:settings");
  const company = ctx.company;
  await ensureCompanyServiceTypes(prisma, company.id, company.industry);
  const [invoiceSequence, serviceTypes, playbooks] = await Promise.all([
    getSequenceSettings(company.id, "INVOICE"),
    prisma.serviceType.findMany({
      where: { companyId: company.id },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.playbook.findMany({
      where: { companyId: company.id, status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  const industryLabel =
    industries.find((i) => i.value === company.industry)?.label ?? company.industry;

  const fields = [
    { label: "Business name", value: company.businessName },
    { label: "Primary trade", value: industryLabel },
    { label: "Timezone", value: company.timezone },
    { label: "Service area", value: company.serviceArea || "—" },
    { label: "Phone", value: company.phone || "—" },
    { label: "Email", value: company.email || "—" },
    {
      label: "Address",
      value:
        [company.address, company.city, company.state, company.zip]
          .filter(Boolean)
          .join(", ") || "—",
    },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-3xl tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Company profile for {company.businessName}.
        </p>
      </div>

      {can(ctx.role, "intelligence:view") ? (
        <Link
          href="/settings/intelligence"
          className="block rounded-2xl border border-[var(--border)] bg-white p-5 hover:border-[var(--cy-orange)]/40"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
            Intelligence
          </p>
          <h2 className="mt-2 font-medium">ContractorYou Intelligence</h2>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            Status, daily brief, and usage. Provider keys stay on ContractorYou — not in your
            settings form.
          </p>
        </Link>
      ) : null}

      {can(ctx.role, "company:settings") ? (
        <Link
          href="/settings/payments"
          className="block rounded-2xl border border-[var(--border)] bg-white p-5 hover:border-[var(--cy-orange)]/40"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
            ContractorYou Payments
          </p>
          <h2 className="mt-2 font-medium">Payments</h2>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            Accept customer payments and receive deposits to your business bank account. Setup stays in
            ContractorYou. Stripe securely collects verification and bank details.
          </p>
        </Link>
      ) : null}

      {can(ctx.role, "marketing:view") ? (
        <Link
          href="/settings/highlevel"
          className="block rounded-2xl border border-[var(--border)] bg-white p-5 hover:border-[var(--cy-orange)]/40"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
            Integrations
          </p>
          <h2 className="mt-2 font-medium">HighLevel</h2>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            Connect the existing HighLevel location for phone, SMS, conversations, and marketing
            automation. ContractorYou still owns jobs, invoices, and payments.
          </p>
        </Link>
      ) : null}

      {can(ctx.role, "accounting:view") ? (
        <Link
          href="/settings/quickbooks"
          className="block rounded-2xl border border-[var(--border)] bg-white p-5 hover:border-[var(--cy-orange)]/40"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
            Integrations
          </p>
          <h2 className="mt-2 font-medium">QuickBooks</h2>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            Connect QuickBooks to sync invoices. ContractorYou still runs the job; QuickBooks keeps the books.
          </p>
        </Link>
      ) : null}

      {can(ctx.role, "imports:manage") ? (
        <Link
          href="/settings/import"
          className="block rounded-2xl border border-[var(--border)] bg-white p-5 hover:border-[var(--cy-orange)]/40"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
            Bring your data
          </p>
          <h2 className="mt-2 font-medium">Import data</h2>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            Upload customers, jobs, invoices, and the rest of your history from almost any software or
            spreadsheet. Match the columns, preview, then import safely.
          </p>
        </Link>
      ) : null}

      {can(ctx.role, "playbooks:view") ? (
        <Link
          href="/settings/playbooks"
          className="block rounded-2xl border border-[var(--border)] bg-white p-5 hover:border-[var(--cy-orange)]/40"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
            Your way
          </p>
          <h2 className="mt-2 font-medium">Playbooks</h2>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            Tell ContractorYou how each type of work should run — messages, stages, and required
            steps. Existing jobs keep working without one.
          </p>
        </Link>
      ) : null}

      <div className="rounded-xl border border-[var(--border)] bg-white p-6">
        <h2 className="font-medium">Field permissions</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Technician discount cap for assigned-only roles. Leave blank for no extra cap beyond the role.
        </p>
        <ActionForm action={saveTechDiscountLimitAction} className="mt-4 space-y-3" successMessage="Technician discount limit saved.">
          <Label htmlFor="tech-discount">Maximum technician discount %</Label>
          <Input
            id="tech-discount"
            name="percent"
            type="number"
            min={0}
            step="0.1"
            defaultValue={
              company.techDiscountLimitBps != null ? String(company.techDiscountLimitBps / 100) : ""
            }
            placeholder="e.g. 5"
            className="h-11 max-w-xs"
          />
          <Button type="submit">Save field discount limit</Button>
        </ActionForm>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-white p-6">
        <h2 className="font-medium">Primary trade</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Used to seed starter service types. It does not hard-code HVAC logic into the rest of ContractorYou.
        </p>
        <ActionForm action={savePrimaryTradeAction} className="mt-4 space-y-3" successMessage="Primary trade saved.">
          <Label htmlFor="industry">Business type</Label>
          <select
            id="industry"
            name="industry"
            defaultValue={company.industry}
            className="h-10 max-w-sm rounded-lg border border-input bg-transparent px-2.5 text-sm"
          >
            {industries.map((industry) => (
              <option key={industry.value} value={industry.value}>
                {industry.label}
              </option>
            ))}
          </select>
          <Button type="submit">Save trade</Button>
        </ActionForm>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-white p-6">
        <h2 className="font-medium">Invoice numbers</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Next number is {invoiceSequence.prefix}-{String(invoiceSequence.nextValue).padStart(invoiceSequence.padding, "0")}.
          Existing invoices are never renumbered.
        </p>
        <ActionForm action={saveInvoiceSequenceAction} className="mt-4 grid gap-3 sm:grid-cols-3" successMessage="Invoice numbering saved.">
          <div className="space-y-1.5">
            <Label htmlFor="prefix">Prefix</Label>
            <Input id="prefix" name="prefix" defaultValue={invoiceSequence.prefix} maxLength={8} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nextValue">Next number</Label>
            <Input id="nextValue" name="nextValue" type="number" min={invoiceSequence.highestExisting + 1} defaultValue={invoiceSequence.nextValue} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="padding">Digits</Label>
            <Input id="padding" name="padding" type="number" min={3} max={8} defaultValue={invoiceSequence.padding} />
          </div>
          <div className="sm:col-span-3">
            <Button type="submit">Save invoice numbering</Button>
          </div>
        </ActionForm>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-white p-6">
        <h2 className="font-medium">Service types</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          What kind of work you do. Pricebook items are what you charge. Deactivating a type does not change past jobs or invoices.
        </p>
        <ul className="mt-4 space-y-3">
          {serviceTypes.map((type) => (
            <li key={type.id} className="rounded-lg border border-[var(--border)] p-3">
              <ActionForm action={updateServiceTypeAction} className="grid gap-2 sm:grid-cols-12 sm:items-end" successMessage="Service type saved.">
                <input type="hidden" name="serviceTypeId" value={type.id} />
                <div className="sm:col-span-4">
                  <Label htmlFor={`name-${type.id}`}>Name</Label>
                  <Input id={`name-${type.id}`} name="name" defaultValue={type.name} />
                </div>
                <div className="sm:col-span-3">
                  <Label htmlFor={`desc-${type.id}`}>Default description</Label>
                  <Input id={`desc-${type.id}`} name="description" defaultValue={type.description ?? ""} />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor={`playbook-${type.id}`}>Playbook</Label>
                  <select
                    id={`playbook-${type.id}`}
                    name="playbookId"
                    defaultValue={type.playbookId ?? ""}
                    className="h-8 w-full rounded-lg border border-input px-2.5 text-sm"
                  >
                    <option value="">None</option>
                    {playbooks.map((playbook) => (
                      <option key={playbook.id} value={playbook.id}>
                        {playbook.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-1">
                  <Label htmlFor={`sort-${type.id}`}>Order</Label>
                  <Input id={`sort-${type.id}`} name="sortOrder" type="number" defaultValue={type.sortOrder} />
                </div>
                <div className="sm:col-span-1">
                  <Label htmlFor={`active-${type.id}`}>Status</Label>
                  <select
                    id={`active-${type.id}`}
                    name="active"
                    defaultValue={type.active && !type.archivedAt ? "1" : "0"}
                    className="h-8 w-full rounded-lg border border-input px-2.5 text-sm"
                  >
                    <option value="1">Active</option>
                    <option value="0">Inactive</option>
                  </select>
                </div>
                <div className="sm:col-span-1">
                  <Button type="submit" size="sm">Save</Button>
                </div>
              </ActionForm>
            </li>
          ))}
        </ul>
        <ActionForm action={createServiceTypeAction} className="mt-4 grid gap-3 sm:grid-cols-3" successMessage="Service type added.">
          <div className="space-y-1.5">
            <Label htmlFor="new-service-name">New service type</Label>
            <Input id="new-service-name" name="name" placeholder="e.g. Drain cleaning" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-service-desc">Default description</Label>
            <Input id="new-service-desc" name="description" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-service-playbook">Playbook</Label>
            <select id="new-service-playbook" name="playbookId" className="h-8 w-full rounded-lg border border-input px-2.5 text-sm">
              <option value="">None</option>
              {playbooks.map((playbook) => (
                <option key={playbook.id} value={playbook.id}>
                  {playbook.name}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-3">
            <Button type="submit">Add service type</Button>
          </div>
        </ActionForm>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-white p-6">
        <h2 className="font-medium">Company profile</h2>
        <dl className="mt-4 divide-y divide-[var(--border)]">
          {fields.map((f) => (
            <div
              key={f.label}
              className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:justify-between"
            >
              <dt className="text-sm text-[var(--muted-foreground)]">{f.label}</dt>
              <dd className="text-sm font-medium sm:text-right">{f.value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs text-[var(--muted-foreground)]">
          Profile fields are read-only here. Contact an owner or admin to change them.
        </p>
      </div>
    </div>
  );
}
