import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { redirect } from "next/navigation";
import { loginAction } from "@/server/actions/auth";
import { getSessionUser, getTenantContext } from "@/lib/auth";
import { landingPath } from "@/lib/workspaces";
import { SummitDemoLoginButton } from "@/components/summit-demo-login-button";

export const maxDuration = 180;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; signedOut?: string }>;
}) {
  const params = await searchParams;
  const signedOut = params.signedOut === "1";
  if (!signedOut) {
    const user = await getSessionUser();
    if (user) {
      const tenant = await getTenantContext();
      if (tenant) redirect(landingPath(tenant.role));
      redirect("/dashboard");
    }
  }
  const next = params.next;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;

  return (
    <div>
      <h1 className="font-display text-2xl tracking-tight text-[var(--foreground)]">Welcome back</h1>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">Sign in to your workspace.</p>

      <ActionForm action={loginAction} className="mt-8 space-y-5">
        {safeNext ? <input type="hidden" name="next" value={safeNext} /> : null}
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

      <div className="mt-6 space-y-3">
        <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
          <span className="h-px flex-1 bg-[var(--border)]" />
          Sales demo
          <span className="h-px flex-1 bg-[var(--border)]" />
        </div>
        <SummitDemoLoginButton />
        <p className="text-center text-xs text-[var(--muted-foreground)]">
          Opens fictional Summit Home Services. No real customers, payments, or outbound messages.
        </p>
      </div>

      <p className="mt-6 text-center text-sm text-[var(--muted-foreground)]">
        No account?{" "}
        <Link href="/register" className="font-medium text-[var(--primary)] underline-offset-4 hover:underline">
          Create one
        </Link>
      </p>
    </div>
  );
}
