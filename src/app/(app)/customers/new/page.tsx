import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { createCustomerAction } from "@/server/actions/customers";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const selectClassName =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export default async function NewCustomerPage() {
  await requirePermission("customers:manage");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href="/customers"
          className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          ← Customers
        </Link>
        <h1 className="mt-2 font-display text-3xl tracking-tight">New customer</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Capture contact details so you can schedule work and send estimates.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Customer details</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm action={createCustomerAction} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="firstName">First name</Label>
                <Input id="firstName" name="firstName" required autoComplete="given-name" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last name</Label>
                <Input id="lastName" name="lastName" required autoComplete="family-name" />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="businessName">Business name</Label>
              <Input id="businessName" name="businessName" autoComplete="organization" />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" autoComplete="email" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" name="phone" type="tel" autoComplete="tel" />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="secondaryPhone">Secondary phone</Label>
                <Input id="secondaryPhone" name="secondaryPhone" type="tel" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="preferredContactMethod">Preferred contact</Label>
                <select
                  id="preferredContactMethod"
                  name="preferredContactMethod"
                  defaultValue="ANY"
                  className={selectClassName}
                >
                  <option value="ANY">Any</option>
                  <option value="PHONE">Phone</option>
                  <option value="TEXT">Text</option>
                  <option value="EMAIL">Email</option>
                </select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <select id="status" name="status" defaultValue="ACTIVE" className={selectClassName}>
                  <option value="ACTIVE">Active</option>
                  <option value="LEAD">Lead</option>
                  <option value="INACTIVE">Inactive</option>
                  <option value="ARCHIVED">Archived</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="source">Source</Label>
                <Input id="source" name="source" placeholder="Referral, Google, etc." />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tags">Tags</Label>
              <Input id="tags" name="tags" placeholder="Comma-separated" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" rows={4} />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Link href="/customers">
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </Link>
              <Button type="submit">Create customer</Button>
            </div>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
