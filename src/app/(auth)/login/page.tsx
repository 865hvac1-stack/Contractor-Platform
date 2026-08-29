import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginAction } from "@/server/actions/auth";

export default function LoginPage() {
  return (
    <div>
      <h1 className="font-display text-2xl tracking-tight text-[var(--foreground)]">Welcome back</h1>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">Sign in to your workspace.</p>

      <ActionForm action={loginAction} className="mt-8 space-y-5">
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
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="password">Password</Label>
            <Link
              href="/forgot-password"
              className="text-xs text-[var(--muted-foreground)] underline-offset-4 hover:text-[var(--foreground)] hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="h-10"
          />
        </div>
        <Button type="submit" className="h-10 w-full">
          Sign in
        </Button>
      </ActionForm>

      <p className="mt-6 text-center text-sm text-[var(--muted-foreground)]">
        No account?{" "}
        <Link href="/register" className="font-medium text-[var(--primary)] underline-offset-4 hover:underline">
          Create one
        </Link>
      </p>
    </div>
  );
}
