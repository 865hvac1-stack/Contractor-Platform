import type { ConnectUxStatus } from "@/lib/payments/connect";

export const PAYMENTS_ORANGE = "#FF6A1A";
export const PAYMENTS_NAVY = "#111B2E";

export const PAYMENTS_EMBED_FRAME_CLASS = [
  "mt-4 w-full max-w-full",
  "min-h-[32rem] sm:min-h-[36rem]",
  "rounded-xl border border-[var(--border)] bg-white",
  "px-2 pt-2 sm:px-4 sm:pt-4",
  "pb-[max(1rem,env(safe-area-inset-bottom))]",
].join(" ");

export function paymentsStatusCopy(status: ConnectUxStatus) {
  if (status === "NOT_CONFIGURED") {
    return {
      title: "Payments not configured",
      body: "Stripe credentials are not on this server. Card collection stays off until they are set.",
      action: null,
    };
  }
  if (status === "NOT_CONNECTED") {
    return {
      title: "ContractorYou Payments",
      body: "Accept cards and bank payments and receive deposits directly to your business bank account.",
      action: "Set Up Payments",
    };
  }
  if (status === "ONBOARDING") {
    return {
      title: "Setup in progress",
      body: "Stripe is still enabling card payments or payouts. If you already finished the form, Stripe may be reviewing. This page stays off Payments Active until Stripe reports both as active.",
      action: "Continue Setup",
    };
  }
  if (status === "ACTION_REQUIRED" || status === "RESTRICTED") {
    return {
      title: "Payments need attention",
      body: "Stripe needs additional information before payments or payouts can continue. This is not shown as connected while charges or payouts are restricted.",
      action: "Complete Required Information",
    };
  }
  if (status === "DISABLED") {
    return {
      title: "Payments disabled",
      body: "Payment collection is turned off for this company. Historical payments and invoices are unchanged.",
      action: "Set Up Payments",
    };
  }
  return {
    title: "Payments Active",
    body: "Accepting payments. Payouts go to your business bank account.",
    action: "Update payment details",
  };
}

export function paymentsCapabilitySummary(account: {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  requirementsDue?: string | null;
}) {
  return {
    cards: account.chargesEnabled ? "Active" : capabilityWord(account.requirementsDue, "card_payments"),
    payouts: account.payoutsEnabled ? "Active" : capabilityWord(account.requirementsDue, "payouts"),
  };
}

function capabilityWord(requirementsDue: string | null | undefined, name: string) {
  const token = (requirementsDue || "")
    .split(",")
    .find((part) => part.startsWith(`${name}:`));
  const status = token?.split(":")[1];
  if (status === "pending") return "Pending Stripe review";
  if (status === "restricted") return "Restricted";
  if (status === "not_requested") return "Not enabled yet";
  return "Not active yet";
}

export const EMBEDDED_SETUP_COPY = {
  title: "Set up payments",
  body: "Complete the secure setup below. Stripe securely handles business verification and banking information.",
  preparing: "Preparing secure setup...",
  loading: "Loading payment setup...",
  failed: "Unable to start payment setup. Please try again.",
} as const;
