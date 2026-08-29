import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { createPropertyAction } from "@/server/actions/customers";
import { ActionForm } from "@/components/action-form";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const selectClassName =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function formatDate(d: Date | null | undefined) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requirePermission("customers:view");
  const { id } = await params;

  const customer = await prisma.customer.findFirst({
    where: { id, companyId: ctx.company.id },
    include: {
      properties: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      jobs: {
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { property: true },
      },
      estimates: { orderBy: { createdAt: "desc" }, take: 50 },
      invoices: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });

  if (!customer) notFound();

  const outstandingBalance = customer.invoices.reduce(
    (sum, inv) => sum + (inv.balanceCents > 0 ? inv.balanceCents : 0),
    0
  );
  const displayName =
    customer.businessName?.trim() ||
    `${customer.firstName} ${customer.lastName}`.trim();

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            href="/customers"
            className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            ← Customers
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl tracking-tight">{displayName}</h1>
            <StatusBadge status={customer.status} />
          </div>
          {customer.businessName ? (
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {customer.firstName} {customer.lastName}
            </p>
          ) : null}
        </div>
        <Link href={`/jobs/new?customerId=${customer.id}`} className={cn(buttonVariants())}>
          New job
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Contact</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                Email
              </p>
              <p className="mt-1 text-sm">{customer.email || "—"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                Phone
              </p>
              <p className="mt-1 text-sm">{customer.phone || "—"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                Secondary phone
              </p>
              <p className="mt-1 text-sm">{customer.secondaryPhone || "—"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                Preferred contact
              </p>
              <p className="mt-1 text-sm">{customer.preferredContactMethod}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                Source
              </p>
              <p className="mt-1 text-sm">{customer.source || "—"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                Tags
              </p>
              <p className="mt-1 text-sm">
                {customer.tags.length ? customer.tags.join(", ") : "—"}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Outstanding balance</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums">
              {formatMoney(outstandingBalance)}
            </p>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              Sum of open invoice balances for this customer.
            </p>
          </CardContent>
        </Card>
      </div>

      {customer.notes ? (
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm text-[var(--foreground)]">
              {customer.notes}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <section className="space-y-4">
        <h2 className="font-display text-xl">Properties</h2>
        {customer.properties.length === 0 ? (
          <EmptyState
            title="No properties yet"
            description="Add a service address so you can create jobs for this customer."
          />
        ) : (
          <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Address</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="hidden md:table-cell">Access</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customer.properties.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <div className="font-medium">
                        {p.name ? `${p.name} · ` : ""}
                        {p.address}
                        {p.isPrimary ? (
                          <span className="ml-2 text-xs text-[var(--muted-foreground)]">
                            Primary
                          </span>
                        ) : null}
                      </div>
                      <div className="text-sm text-[var(--muted-foreground)]">
                        {p.city}, {p.state} {p.zip}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={p.propertyType} />
                    </TableCell>
                    <TableCell className="hidden max-w-xs truncate text-sm text-[var(--muted-foreground)] md:table-cell">
                      {p.accessNotes || p.gateCodeNotes || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Add property</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm action={createPropertyAction} className="space-y-4">
              <input type="hidden" name="customerId" value={customer.id} />
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" placeholder="Main house, Office, etc." />
              </div>
              <div className="space-y-2">
                <Label htmlFor="address">Street address</Label>
                <Input id="address" name="address" required />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="city">City</Label>
                  <Input id="city" name="city" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="state">State</Label>
                  <Input id="state" name="state" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="zip">ZIP</Label>
                  <Input id="zip" name="zip" required />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="propertyType">Property type</Label>
                <select
                  id="propertyType"
                  name="propertyType"
                  defaultValue="RESIDENTIAL"
                  className={selectClassName}
                >
                  <option value="RESIDENTIAL">Residential</option>
                  <option value="COMMERCIAL">Commercial</option>
                  <option value="MULTI_FAMILY">Multi-family</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="accessNotes">Access notes</Label>
                  <Textarea id="accessNotes" name="accessNotes" rows={2} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="gateCodeNotes">Gate / code notes</Label>
                  <Textarea id="gateCodeNotes" name="gateCodeNotes" rows={2} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="isPrimary" value="true" className="rounded border" />
                Primary property
              </label>
              <Button type="submit">Add property</Button>
            </ActionForm>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl">Jobs</h2>
          <Link
            href={`/jobs/new?customerId=${customer.id}`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            New job
          </Link>
        </div>
        {customer.jobs.length === 0 ? (
          <EmptyState
            title="No jobs yet"
            description="Create a job when you are ready to schedule work."
            actionLabel="Create job"
            actionHref={`/jobs/new?customerId=${customer.id}`}
          />
        ) : (
          <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Schedule</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customer.jobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell>
                      <Link href={`/jobs/${job.id}`} className="font-medium hover:underline">
                        {job.jobNumber}
                      </Link>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        {job.jobType || job.property.address}
                      </p>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={job.status} />
                    </TableCell>
                    <TableCell className="hidden text-sm text-[var(--muted-foreground)] md:table-cell">
                      {formatDate(job.scheduledStart)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section className="space-y-4">
          <h2 className="font-display text-xl">Estimates</h2>
          {customer.estimates.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No estimates yet.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-white">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Estimate</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customer.estimates.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>
                        <Link href={`/estimates/${e.id}`} className="font-medium hover:underline">
                          {e.estimateNumber}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={e.status} />
                      </TableCell>
                      <TableCell className="tabular-nums">{formatMoney(e.totalCents)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        <section className="space-y-4">
          <h2 className="font-display text-xl">Invoices</h2>
          {customer.invoices.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No invoices yet.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-white">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customer.invoices.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell>
                        <Link href={`/invoices/${inv.id}`} className="font-medium hover:underline">
                          {inv.invoiceNumber}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={inv.status} />
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatMoney(inv.balanceCents)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
