import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { industries } from "@/lib/brand";

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
