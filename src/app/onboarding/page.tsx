import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { industries, companySizes } from "@/lib/brand";
import { BrandMark } from "@/components/brand-mark";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { completeOnboardingAction } from "@/server/actions/auth";

export default async function OnboardingPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const membership = await prisma.membership.findFirst({
    where: { userId: user.id, status: "ACTIVE" },
  });

  if (membership) {
    redirect("/dashboard");
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-4 py-12">
      <div className="mb-8">
        <BrandMark variant="full" tone="dark" />
        <h1 className="mt-4 font-display text-3xl tracking-tight text-[var(--foreground)]">
          Set up your company
        </h1>
        <p className="mt-2 text-[var(--muted-foreground)]">
          Tell us about your business so we can tailor your workspace.
        </p>
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm md:p-8">
        <ActionForm action={completeOnboardingAction} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="businessName">Business name</Label>
            <Input id="businessName" name="businessName" required className="h-10" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="industry">Industry</Label>
            <select
              id="industry"
              name="industry"
              required
              defaultValue=""
              className="flex h-10 w-full rounded-lg border border-[var(--input)] bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="" disabled>
                Select industry
              </option>
              {industries.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="companySize">Company size</Label>
            <select
              id="companySize"
              name="companySize"
              defaultValue=""
              className="flex h-10 w-full rounded-lg border border-[var(--input)] bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="">Select size</option>
              {companySizes.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="serviceArea">Service area</Label>
            <Input
              id="serviceArea"
              name="serviceArea"
              placeholder="e.g. Metro Atlanta"
              className="h-10"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" name="phone" type="tel" autoComplete="tel" className="h-10" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="address">Street address</Label>
            <Input id="address" name="address" autoComplete="street-address" className="h-10" />
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            <div className="space-y-2 sm:col-span-1">
              <Label htmlFor="city">City</Label>
              <Input id="city" name="city" autoComplete="address-level2" className="h-10" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="state">State</Label>
              <Input id="state" name="state" autoComplete="address-level1" className="h-10" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="zip">ZIP</Label>
              <Input id="zip" name="zip" autoComplete="postal-code" className="h-10" />
            </div>
          </div>

          <input type="hidden" name="email" value={user.email} />
          <input type="hidden" name="timezone" value="America/New_York" />

          <Button type="submit" className="mt-2 h-10 w-full">
            Continue to dashboard
          </Button>
        </ActionForm>
      </div>
    </div>
  );
}
