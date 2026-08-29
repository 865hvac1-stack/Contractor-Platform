"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { forgotPasswordAction } from "@/server/actions/auth";

type ForgotState = Awaited<ReturnType<typeof forgotPasswordAction>> | null;

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState(
    forgotPasswordAction as (
      prev: ForgotState,
      formData: FormData
    ) => Promise<NonNullable<ForgotState>>,
    null as ForgotState
  );

  return (
    <div>
      <h1 className="font-display text-2xl tracking-tight text-[var(--foreground)]">
        Reset password
      </h1>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">
        Enter your email and we&apos;ll send a reset link.
      </p>

      <form action={formAction} className="mt-8 space-y-5">
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

        {state && !state.ok ? (
          <p className="text-sm text-rose-700" role="alert">
            {state.error}
          </p>
        ) : null}

        {state && state.ok ? (
          <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--muted)] p-3 text-sm">
            <p className="text-emerald-800">
              If an account exists for that email, a reset link is ready.
            </p>
            {"resetUrl" in state && state.resetUrl ? (
              <p className="break-all text-[var(--muted-foreground)]">
                Dev reset link:{" "}
                <a href={state.resetUrl} className="text-[var(--primary)] underline">
                  {state.resetUrl}
                </a>
              </p>
            ) : null}
          </div>
        ) : null}

        <Button type="submit" className="h-10 w-full" disabled={pending}>
          {pending ? "Sending…" : "Send reset link"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-[var(--muted-foreground)]">
        <Link href="/login" className="font-medium text-[var(--primary)] underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
