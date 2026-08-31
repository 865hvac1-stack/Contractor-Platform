import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { industries } from "@/lib/brand";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveTechDiscountLimitAction } from "@/server/actions/field";

export default async function SettingsPage() {
  const ctx = await requirePermission("company:settings");
  const company = ctx.company;
  const industryLabel =
    industries.find((i) => i.value === company.industry)?.label ?? company.industry;

  const fields = [
    { label: "Business name", value: company.businessName },
    { label: "Industry", value: industryLabel },
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
