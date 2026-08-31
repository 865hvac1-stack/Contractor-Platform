import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { LogoutButton } from "@/components/tech/logout-button";

export default async function TechMorePage() {
  const ctx = await requirePermission("jobs:view");
  const links = [
    can(ctx.role, "customers:view")
      ? { href: "/tech/customers", label: "Customers", detail: "People and properties on your assigned work" }
      : null,
    can(ctx.role, "receipts:view")
      ? { href: "/tech/receipts", label: "Receipts", detail: "Job, truck, and company expense photos" }
      : null,
    { href: "/tech/performance", label: "My performance", detail: "Scorecard and incentives" },
  ].filter(Boolean) as { href: string; label: string; detail: string }[];

  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl tracking-tight">More</h1>
      <Link href="/tech/more/profile" className="block rounded-2xl border border-[var(--border)] bg-white p-4">
        <p className="text-sm font-medium">
          {ctx.user.firstName} {ctx.user.lastName}
        </p>
        <p className="text-sm text-[var(--muted-foreground)]">{ctx.user.email}</p>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          {ctx.company.businessName} · {ctx.role.replaceAll("_", " ")}
        </p>
        <p className="mt-2 text-xs font-medium text-[var(--cy-orange)]">Account</p>
      </Link>
      <ul className="space-y-2">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="block rounded-2xl border border-[var(--border)] bg-white p-4">
              <p className="font-medium">{link.label}</p>
              <p className="text-sm text-[var(--muted-foreground)]">{link.detail}</p>
            </Link>
          </li>
        ))}
        <li className="rounded-2xl border border-[var(--border)] bg-white p-4">
          <p className="font-medium">Help</p>
          <ol className="mt-2 list-decimal space-y-1 pl-4 text-sm text-[var(--muted-foreground)]">
            <li>Open your next job</li>
            <li>Follow the Next Step</li>
            <li>Run the playbook</li>
            <li>Present options and collect payment</li>
            <li>Complete the job</li>
          </ol>
        </li>
      </ul>
      <LogoutButton />
    </div>
  );
}
