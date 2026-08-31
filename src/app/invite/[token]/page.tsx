import Link from "next/link";
import { hashToken } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { inviteStatus } from "@/lib/team/invite-status";
import { ROLE_LABELS } from "@/lib/permissions";
import { BrandMark } from "@/components/brand-mark";
import { ActionForm } from "@/components/action-form";
import { acceptInviteAction } from "@/server/actions/invites";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default async function AcceptInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = await prisma.teamInvite.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { company: { select: { businessName: true } } },
  });
  const status = invite ? inviteStatus(invite) : null;

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center bg-[var(--cy-gray)] px-4 py-12">
      <div className="relative z-10 w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-flex justify-center">
            <BrandMark variant="stacked" tone="dark" priority />
          </Link>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-white p-6 shadow-sm md:p-8">
          {!invite || !status || status === "REVOKED" || status === "EXPIRED" || status === "ACCEPTED" ? (
            <div>
              <h1 className="font-display text-2xl tracking-tight">Invitation unavailable</h1>
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                {status === "ACCEPTED"
                  ? "This invitation was already used. Sign in with the account you set up."
                  : status === "EXPIRED"
                    ? "This invitation has expired. Ask your office to send a new one."
                    : status === "REVOKED"
                      ? "This invitation was revoked."
                      : "This invitation link is invalid."}
              </p>
              <p className="mt-6 text-center text-sm">
                <Link href="/login" className="font-medium text-[var(--primary)] underline">
                  Sign in
                </Link>
              </p>
            </div>
          ) : (
            <div>
              <h1 className="font-display text-2xl tracking-tight">Set up your account</h1>
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                You&apos;ve been invited to join {invite.company.businessName} on ContractorYou as a{" "}
                {ROLE_LABELS[invite.role]}.
              </p>
              <ActionForm action={acceptInviteAction} className="mt-8 space-y-5">
                <input type="hidden" name="token" value={token} />
                <div className="space-y-2">
                  <Label htmlFor="password">Create a password</Label>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={10}
                    className="h-11"
                  />
                  <p className="text-xs text-[var(--muted-foreground)]">At least 10 characters.</p>
                </div>
                <Button type="submit" className="h-11 w-full">
                  Set up my account
                </Button>
              </ActionForm>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
