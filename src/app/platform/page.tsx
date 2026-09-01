import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetSummitDemoAction } from "@/server/actions/demo";
import { DemoModeBadge } from "@/components/demo-mode-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function PlatformPage() {
  await requirePlatformAdmin();

  const companies = await prisma.company.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { memberships: true } },
      memberships: { select: { userId: true } },
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl tracking-tight">Companies</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Platform overview. Suspend or reactivate tenants — no impersonation.
        </p>
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
        <h2 className="font-medium">Summit Home Services demo</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Create or reset the fictional sales tenant. This cannot target 865 HVAC.
        </p>
        <ActionForm action={resetSummitDemoAction} className="mt-3 max-w-md space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="confirm-demo">Type RESET SUMMIT DEMO</Label>
            <Input id="confirm-demo" name="confirm" autoComplete="off" />
          </div>
          <Button type="submit">Create or reset Summit demo</Button>
        </ActionForm>
      </div>

      {companies.length === 0 ? (
        <EmptyState
          title="No companies"
          description="Companies appear here after onboarding."
        />
      ) : (
        <div className="rounded-xl border border-[var(--border)] bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Business</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Memberships</TableHead>
                <TableHead className="text-right">Users</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map((c) => {
                const uniqueUsers = new Set(c.memberships.map((m) => m.userId)).size;
                return (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link
                        href={`/platform/companies/${c.id}`}
                        className="font-medium text-[var(--accent)] underline-offset-2 hover:underline"
                      >
                        {c.businessName}
                      </Link>
                      {c.isDemo ? <span className="ml-2 inline-block align-middle"><DemoModeBadge compact /></span> : null}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={c.status} />
                    </TableCell>
                    <TableCell className="text-[var(--muted-foreground)]">
                      {c.createdAt.toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c._count.memberships}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{uniqueUsers}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
