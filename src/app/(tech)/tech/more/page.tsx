import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { logoutAction } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";

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
      <section className="rounded-2xl border border-[var(--border)] bg-white p-4">
        <p className="text-sm font-medium">
          {ctx.user.firstName} {ctx.user.lastName}
        </p>
        <p className="text-sm text-[var(--muted-foreground)]">{ctx.user.email}</p>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          {ctx.company.businessName} · {ctx.role.replaceAll("_", " ")}
        </p>
      </section>
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
          <p className="text-sm text-[var(--muted-foreground)]">
            Open the next job, run the playbook, present options, collect, then complete. Ask the office if a job is
            missing.
          </p>
        </li>
      </ul>
      <form action={logoutAction}>
        <Button type="submit" variant="outline" className="h-12 w-full">
          Sign out
        </Button>
      </form>
    </div>
  );
}
