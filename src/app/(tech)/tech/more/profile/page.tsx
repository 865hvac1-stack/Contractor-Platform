import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";

export default async function TechProfilePage() {
  const ctx = await requirePermission("jobs:view");
  const user = await prisma.user.findUnique({
    where: { id: ctx.user.id },
    select: { firstName: true, lastName: true, email: true, phone: true },
  });

  return (
    <div className="space-y-4">
      <Link href="/tech/more" className="text-xs font-medium text-[var(--muted-foreground)]">
        ← More
      </Link>
      <h1 className="font-display text-3xl tracking-tight">Account</h1>
      <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-white p-4">
        <p>
          <span className="block text-xs text-[var(--muted-foreground)]">Name</span>
          {user?.firstName} {user?.lastName}
        </p>
        <p>
          <span className="block text-xs text-[var(--muted-foreground)]">Email</span>
          {user?.email}
        </p>
        <p>
          <span className="block text-xs text-[var(--muted-foreground)]">Phone</span>
          {user?.phone || "Not on file"}
        </p>
        <p className="text-sm text-[var(--muted-foreground)]">
          Password changes use the same account reset as the rest of ContractorYou.
        </p>
        <Link href="/forgot-password" className="inline-flex h-11 items-center text-sm font-medium text-[var(--cy-orange)]">
          Reset password
        </Link>
      </section>
    </div>
  );
}
