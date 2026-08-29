import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  reactivateCompanyAction,
  suspendCompanyAction,
} from "@/server/actions/team";
import { StatusBadge } from "@/components/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export default async function PlatformCompanyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requirePlatformAdmin();

  const company = await prisma.company.findUnique({
    where: { id },
    include: {
      memberships: {
        include: { user: true },
        orderBy: { createdAt: "asc" },
      },
      auditLogs: {
        orderBy: { createdAt: "desc" },
        take: 25,
        include: { actor: true },
      },
      _count: {
        select: {
          memberships: true,
          customers: true,
          jobs: true,
        },
      },
    },
  });
  if (!company) notFound();

  const uniqueUsers = new Set(company.memberships.map((m) => m.userId)).size;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/platform"
            className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            ← Companies
          </Link>
          <h1 className="mt-2 font-display text-3xl tracking-tight">
            {company.businessName}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Created {company.createdAt.toLocaleString()} ·{" "}
            {company.industry.replaceAll("_", " ")}
          </p>
        </div>
        <StatusBadge status={company.status} className="text-sm" />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-[var(--border)] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
            Memberships
          </p>
          <p className="mt-1 text-2xl tabular-nums">{company._count.memberships}</p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Users</p>
          <p className="mt-1 text-2xl tabular-nums">{uniqueUsers}</p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
            Jobs / customers
          </p>
          <p className="mt-1 text-2xl tabular-nums">
            {company._count.jobs} / {company._count.customers}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-white p-4">
        <h2 className="font-medium">Members</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {company.memberships.map((m) => (
            <li key={m.id} className="flex flex-wrap justify-between gap-2">
              <span>
                {m.user.firstName} {m.user.lastName}{" "}
                <span className="text-[var(--muted-foreground)]">({m.user.email})</span>
              </span>
              <span className="text-[var(--muted-foreground)]">
                {m.role.replaceAll("_", " ")} · {m.status}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-white p-4">
        <h2 className="font-medium">Company status</h2>
        {company.status === "SUSPENDED" ? (
          <div className="mt-3 space-y-3">
            {company.suspendedReason ? (
              <p className="text-sm text-[var(--muted-foreground)]">
                Reason: {company.suspendedReason}
              </p>
            ) : null}
            <form
              action={async () => {
                "use server";
                await reactivateCompanyAction(id);
              }}
            >
              <Button type="submit">Reactivate company</Button>
            </form>
          </div>
        ) : (
          <form
            action={async (formData) => {
              "use server";
              const reason = String(formData.get("reason") || "");
              await suspendCompanyAction(id, reason);
            }}
            className="mt-3 space-y-3"
          >
            <div className="space-y-1.5">
              <Label htmlFor="reason">Suspension reason</Label>
              <Input
                id="reason"
                name="reason"
                required
                placeholder="Reason shown to the company"
              />
            </div>
            <Button type="submit" variant="destructive">
              Suspend company
            </Button>
          </form>
        )}
        <p className="mt-4 text-xs text-[var(--muted-foreground)]">
          Platform admins cannot impersonate users.
        </p>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-white p-4">
        <h2 className="font-medium">Recent audit logs</h2>
        {company.auditLogs.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--muted-foreground)]">No audit events yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--border)] text-sm">
            {company.auditLogs.map((log) => (
              <li key={log.id} className="flex flex-wrap justify-between gap-2 py-2">
                <div>
                  <span className="font-medium">{log.action}</span>
                  <span className="text-[var(--muted-foreground)]">
                    {" "}
                    · {log.entityType}
                    {log.entityId ? ` ${log.entityId.slice(0, 8)}…` : ""}
                  </span>
                  {log.actor ? (
                    <span className="block text-xs text-[var(--muted-foreground)]">
                      {log.actor.email}
                    </span>
                  ) : null}
                </div>
                <span className="text-[var(--muted-foreground)]">
                  {log.createdAt.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Link href="/platform" className={cn(buttonVariants({ variant: "outline" }))}>
        Back to companies
      </Link>
    </div>
  );
}
