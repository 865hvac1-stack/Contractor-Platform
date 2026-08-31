import type { PrismaClient } from "@prisma/client";
import { getConnectAccount } from "@/lib/payments/connect";
import { stripeConfigured } from "@/lib/payments/config";
import { getStripe } from "@/lib/payments/stripe-client";

export async function loadPayoutSnapshot(prisma: PrismaClient, companyId: string) {
  if (!stripeConfigured()) return { ok: false as const, error: "Payments are not configured." };
  const account = await getConnectAccount(prisma, companyId);
  if (!account || account.disabledAt) {
    return { ok: false as const, error: "Payments are not connected." };
  }
  const stripe = getStripe();
  if (!stripe) return { ok: false as const, error: "Payments are not configured." };
  try {
    const [balance, payouts] = await Promise.all([
      stripe.balance.retrieve(undefined, { stripeAccount: account.stripeAccountId }),
      stripe.payouts.list({ limit: 8 }, { stripeAccount: account.stripeAccountId }),
    ]);
    const available = balance.available.reduce((sum, row) => sum + row.amount, 0);
    const pending = balance.pending.reduce((sum, row) => sum + row.amount, 0);
    return {
      ok: true as const,
      availableCents: available,
      pendingCents: pending,
      currency: balance.available[0]?.currency ?? "usd",
      payouts: payouts.data.map((payout) => ({
        id: payout.id,
        amountCents: payout.amount,
        status: payout.status,
        arrivalDate: payout.arrival_date ? new Date(payout.arrival_date * 1000) : null,
      })),
    };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Could not load payouts from Stripe.",
    };
  }
}
