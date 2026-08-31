import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import {
  missingStripeEnvVars,
  stripeConfigured,
  stripeModeLabel,
  stripePublishableKey,
  stripeWebhookConfigured,
} from "@/lib/payments/config";
import { refreshConnectAccount, uxStatus } from "@/lib/payments/connect";
import { PaymentsSettingsActions } from "@/app/(app)/settings/payments/payments-actions";

export default async function PaymentsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ returned?: string }>;
}) {
  const ctx = await requirePermission("company:settings");
  const query = await searchParams;
  const canManage = can(ctx.role, "payments:manage");
  let account = await prisma.stripeConnectAccount.findUnique({ where: { companyId: ctx.company.id } });
  let refreshError: string | null = null;
  if (stripeConfigured() && account && !account.disabledAt) {
    try {
      account = await refreshConnectAccount(prisma, ctx.company.id);
    } catch (error) {
      refreshError = error instanceof Error ? error.message : "Could not refresh payment status from Stripe.";
    }
  }
  const missing = missingStripeEnvVars();
  const status = uxStatus({
    platformConfigured: stripeConfigured() && Boolean(stripePublishableKey()) && stripeWebhookConfigured(),
    account,
  });
  const returned = query.returned === "1";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href="/settings" className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
          ← Settings
        </Link>
        <h1 className="mt-2 font-display text-3xl tracking-tight">Payments</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Accept customer payments and receive deposits directly to your business bank account.
        </p>
      </div>

      {returned ? (
        <p className="rounded-xl border border-[var(--border)] bg-white px-4 py-3 text-sm">
          Returned from payment setup. Status below is verified with Stripe, not from the return link.
        </p>
      ) : null}
      {refreshError ? (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">{refreshError}</p>
      ) : null}

      <section className="rounded-2xl border border-[var(--border)] bg-white p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
          ContractorYou Payments
        </p>
        <StatusCopy status={status} missing={missing} mode={stripeModeLabel()} />

        {status === "CONNECTED" && account ? (
          <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[var(--muted-foreground)]">Payments</dt>
              <dd className="mt-0.5 font-medium">{account.chargesEnabled ? "Enabled" : "Not enabled"}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted-foreground)]">Payouts</dt>
              <dd className="mt-0.5 font-medium">{account.payoutsEnabled ? "Enabled" : "Not enabled"}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted-foreground)]">Bank</dt>
              <dd className="mt-0.5 font-medium">
                {account.bankLast4 ? `${account.bankName ? `${account.bankName} ` : ""}•••• ${account.bankLast4}` : "On file with Stripe"}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted-foreground)]">Payout schedule</dt>
              <dd className="mt-0.5 font-medium">{account.payoutSchedule || "Set in Stripe"}</dd>
            </div>
          </dl>
        ) : null}

        {canManage ? <PaymentsSettingsActions status={status} /> : (
          <p className="mt-4 text-sm text-[var(--muted-foreground)]">
            An owner or admin can set up or manage ContractorYou Payments.
          </p>
        )}
      </section>

      <p className="text-xs text-[var(--muted-foreground)]">
        Secure payment processing powered by Stripe. ContractorYou never stores card numbers, CVV, or bank
        credentials. Each company has its own Stripe connected account. Platform mode: {stripeModeLabel()}.
      </p>
    </div>
  );
}

function StatusCopy({
  status,
  missing,
  mode,
}: {
  status: ReturnType<typeof uxStatus>;
  missing: string[];
  mode: string;
}) {
  if (status === "NOT_CONFIGURED") {
    return (
      <div className="mt-3 space-y-2">
        <h2 className="text-xl font-semibold">Payments not configured</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          Stripe credentials are not on this server. The app is running. Card collection stays off until these
          environment variables are set ({mode}):
        </p>
        <ul className="list-disc pl-5 text-sm">
          {missing.map((name) => (
            <li key={name} className="font-mono">
              {name}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (status === "NOT_CONNECTED") {
    return (
      <div className="mt-3 space-y-2">
        <h2 className="text-xl font-semibold">Not set up</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          Set up payments to accept cards and bank payments. You do not need a Stripe account first — setup
          walks you through business verification and payout bank details securely.
        </p>
      </div>
    );
  }
  if (status === "ONBOARDING") {
    return (
      <div className="mt-3 space-y-2">
        <h2 className="text-xl font-semibold">Setup in progress</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          Finish business verification and payout setup. Payments stay off until Stripe confirms they are enabled.
        </p>
      </div>
    );
  }
  if (status === "ACTION_REQUIRED" || status === "RESTRICTED") {
    return (
      <div className="mt-3 space-y-2">
        <h2 className="text-xl font-semibold text-amber-800">Action required</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          Stripe needs additional information before payments or payouts can continue. This is not shown as
          connected while charges or payouts are restricted.
        </p>
      </div>
    );
  }
  if (status === "DISABLED") {
    return (
      <div className="mt-3 space-y-2">
        <h2 className="text-xl font-semibold">Payments disabled</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          Payment collection is turned off for this company. Historical payments and invoices are unchanged.
        </p>
      </div>
    );
  }
  return (
    <div className="mt-3 space-y-2">
      <h2 className="text-xl font-semibold">Connected ✓</h2>
      <p className="text-sm text-[var(--muted-foreground)]">
        Customers can pay invoices. Payouts go to your business bank account.
      </p>
    </div>
  );
}
