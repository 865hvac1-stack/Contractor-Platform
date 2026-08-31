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
      body: "Finish business verification and payout setup inside ContractorYou. Payments stay off until Stripe confirms they are enabled.",
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

export const EMBEDDED_SETUP_COPY = {
  title: "Set up payments",
  body: "Complete the secure setup below. Stripe securely handles business verification and banking information.",
  preparing: "Preparing secure setup...",
  loading: "Loading payment setup...",
  failed: "Unable to start payment setup. Please try again.",
} as const;
