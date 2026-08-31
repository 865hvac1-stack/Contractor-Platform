import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createCustomerAction } from "@/server/actions/customers";
import { requirePermission } from "@/lib/tenant";
import { canAccessWorkspace, landingPath } from "@/lib/workspaces";

export default async function OfficeNewCustomerPage() {
  const ctx = await requirePermission("customers:manage");
  if (!canAccessWorkspace(ctx.role, "office")) {
    redirect(landingPath(ctx.role));
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <Link href="/office" className="text-sm text-[var(--muted-foreground)]">
          ← Customer Hub
        </Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--cy-navy)]">
          New customer
        </h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Capture the minimum to take the call. Add more details later.
        </p>
      </div>
      <div className="rounded-2xl border bg-white p-5">
        <ActionForm action={createCustomerAction} className="space-y-4">
          <input type="hidden" name="returnTo" value="office" />
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
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" name="phone" type="tel" autoComplete="tel" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="address">Property address</Label>
            <Input id="address" name="address" autoComplete="street-address" />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="city">City</Label>
              <Input id="city" name="city" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="state">State</Label>
              <Input id="state" name="state" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="zip">ZIP</Label>
              <Input id="zip" name="zip" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Link href="/office">
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit">Create customer</Button>
          </div>
        </ActionForm>
      </div>
    </div>
  );
}
