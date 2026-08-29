import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetPasswordAction } from "@/server/actions/auth";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const params = await searchParams;
  const tokenRaw = params.token;
  const token = Array.isArray(tokenRaw) ? tokenRaw[0] : tokenRaw;

  if (!token) {
    return (
      <div>
        <h1 className="font-display text-2xl tracking-tight text-[var(--foreground)]">
          Invalid reset link
        </h1>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          This password reset link is missing or incomplete.
        </p>
        <p className="mt-6 text-center text-sm">
          <Link href="/forgot-password" className="font-medium text-[var(--primary)] underline-offset-4 hover:underline">
            Request a new link
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-display text-2xl tracking-tight text-[var(--foreground)]">
        Choose a new password
      </h1>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">
        Enter a new password for your account.
      </p>

      <ActionForm action={resetPasswordAction} className="mt-8 space-y-5">
        <input type="hidden" name="token" value={token} />
        <div className="space-y-2">
          <Label htmlFor="password">New password</Label>
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
          Update password
        </Button>
      </ActionForm>

      <p className="mt-6 text-center text-sm text-[var(--muted-foreground)]">
        <Link href="/login" className="font-medium text-[var(--primary)] underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
