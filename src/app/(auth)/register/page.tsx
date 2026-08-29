import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { registerAction } from "@/server/actions/auth";

export default function RegisterPage() {
  return (
    <div>
      <h1 className="font-display text-2xl tracking-tight text-[var(--foreground)]">Create account</h1>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">
        Start your contractor workspace in a few minutes.
      </p>

      <ActionForm action={registerAction} className="mt-8 space-y-5">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="firstName">First name</Label>
            <Input id="firstName" name="firstName" required autoComplete="given-name" className="h-10" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lastName">Last name</Label>
            <Input id="lastName" name="lastName" required autoComplete="family-name" className="h-10" />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@company.com"
            className="h-10"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            className="h-10"
          />
          <p className="text-xs text-[var(--muted-foreground)]">At least 10 characters.</p>
        </div>
        <Button type="submit" className="h-10 w-full">
          Create account
        </Button>
      </ActionForm>

      <p className="mt-6 text-center text-sm text-[var(--muted-foreground)]">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-[var(--primary)] underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
