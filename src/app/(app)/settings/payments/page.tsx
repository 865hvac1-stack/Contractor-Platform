import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import {
  appUrl,
  missingStripeEnvVars,
  stripeConfigured,
  stripeModeLabel,
  stripePublishableKey,
  stripeWebhookConfigured,
} from "@/lib/payments/config";
import {
  STRIPE_PAYMENT_WEBHOOK_EVENTS,
  STRIPE_WEBHOOK_LISTEN_MODE,
  STRIPE_WEBHOOK_PATH,
  STRIPE_WEBHOOK_SECRET_ENV,
} from "@/lib/payments/webhook-events";
import { refreshConnectAccount, uxStatus } from "@/lib/payments/connect";
import { paymentsCapabilitySummary, paymentsStatusCopy } from "@/lib/payments/payments-ux";
import { PaymentsSettingsActions } from "@/app/(app)/settings/payments/payments-actions";

export default async function PaymentsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ returned?: string; onboard?: string }>;
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
  const startOpen = query.onboard === "1";
  const publishableKey = stripePublishableKey();

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
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
          Setup progress was saved. Status below is verified with Stripe, not assumed from this page.
        </p>
      ) : null}
      {refreshError ? (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Payment status could not be refreshed from Stripe. Try again in a moment.
        </p>
      ) : null}

      <section className="rounded-2xl border border-[var(--border)] bg-white p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
          ContractorYou Payments
        </p>
        <StatusCopy status={status} missing={missing} mode={stripeModeLabel()} />

        {account && status !== "NOT_CONFIGURED" && status !== "NOT_CONNECTED" ? (
          <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[var(--muted-foreground)]">Accepting payments</dt>
              <dd className="mt-0.5 font-medium">
                {status === "CONNECTED" ? (account.chargesEnabled ? "Yes" : "No") : paymentsCapabilitySummary(account).cards}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted-foreground)]">Payouts enabled</dt>
              <dd className="mt-0.5 font-medium">
                {status === "CONNECTED" ? (account.payoutsEnabled ? "Yes" : "No") : paymentsCapabilitySummary(account).payouts}
              </dd>
            </div>
            {status === "CONNECTED" ? (
              <>
                <div>
                  <dt className="text-[var(--muted-foreground)]">Account status</dt>
                  <dd className="mt-0.5 font-medium">Active</dd>
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
              </>
            ) : null}
          </dl>
        ) : null}

        {canManage ? (
          <PaymentsSettingsActions status={status} publishableKey={publishableKey} startOpen={startOpen} />
        ) : (
          <p className="mt-4 text-sm text-[var(--muted-foreground)]">
            An owner or admin can set up or manage ContractorYou Payments.
          </p>
        )}
      </section>

      {canManage ? (
        <section className="rounded-2xl border border-[var(--border)] bg-white p-6 text-sm">
          <h2 className="font-medium">Webhook configuration</h2>
          <p className="mt-1 text-[var(--muted-foreground)]">
            Direct charges emit on the connected account. The Stripe Dashboard endpoint must listen to
            Events on Connected accounts ({STRIPE_WEBHOOK_LISTEN_MODE.replaceAll("_", " ")}).
          </p>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
            <div>
              <dt className="text-[var(--muted-foreground)]">Endpoint</dt>
              <dd className="mt-0.5 break-all font-mono text-xs">
                {appUrl()}
                {STRIPE_WEBHOOK_PATH}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted-foreground)]">{STRIPE_WEBHOOK_SECRET_ENV}</dt>
              <dd className="mt-0.5 font-medium">
                {stripeWebhookConfigured() ? "Configured" : "Missing — invoice balances will not update from Stripe"}
              </dd>
            </div>
          </dl>
          {!stripeWebhookConfigured() ? (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-amber-950">
              Add {STRIPE_WEBHOOK_SECRET_ENV} on Railway from the Stripe Dashboard signing secret. Subscribe
              to {STRIPE_PAYMENT_WEBHOOK_EVENTS.join(", ")} on connected accounts.
            </p>
          ) : null}
        </section>
      ) : null}

      <p className="text-xs text-[var(--muted-foreground)]">
        Secure payment processing powered by Stripe. ContractorYou never stores card numbers, CVV, bank
        credentials, routing or account numbers, identity documents, or SSNs and tax IDs. Stripe collects
        those inside the embedded setup form. Each company has its own Stripe connected account. Platform
        mode: {stripeModeLabel()}.
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
  const copy = paymentsStatusCopy(status);
  if (status === "NOT_CONFIGURED") {
    return (
      <div className="mt-3 space-y-2">
        <h2 className="text-xl font-semibold">{copy.title}</h2>
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
  return (
    <div className="mt-3 space-y-2">
      {copy.title !== "ContractorYou Payments" ? (
        <h2
          className={`text-xl font-semibold${status === "ACTION_REQUIRED" || status === "RESTRICTED" ? " text-amber-800" : ""}`}
        >
          {copy.title}
        </h2>
      ) : null}
      <p className="text-sm text-[var(--muted-foreground)]">{copy.body}</p>
    </div>
  );
}
