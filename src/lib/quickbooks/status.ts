import type { IntegrationStatus } from "@prisma/client";

export function publicQuickBooksStatus(connection: {
  status: IntegrationStatus;
  externalAccountId: string | null;
} | null): IntegrationStatus {
  if (!connection) return "NOT_CONNECTED";
  if (connection.status === "CONNECTED" && !connection.externalAccountId) return "ERROR";
  return connection.status;
}

export const QUICKBOOKS_STATUS_COPY: Record<string, string> = {
  NOT_CONNECTED: "Not connected",
  CONNECTING: "Connecting",
  SELECT_ACCOUNT: "Select company",
  CONNECTED: "Connected",
  SYNCING: "Syncing",
  REAUTH_REQUIRED: "Reauth required",
  ERROR: "Error",
  DISABLED: "Disabled",
};

export const INVOICE_TRIGGER_COPY: {
  value: "MANUAL_ONLY" | "WHEN_CREATED" | "WHEN_SENT" | "WHEN_JOB_COMPLETED" | "WHEN_PAYMENT_RECEIVED";
  label: string;
  help: string;
}[] = [
  {
    value: "MANUAL_ONLY",
    label: "Manual only",
    help: "Invoices stay in ContractorYou until someone presses Sync to QuickBooks. Safest default.",
  },
  {
    value: "WHEN_CREATED",
    label: "When invoice is created",
    help: "Push a new invoice as soon as it is saved. Historical imports still stay put.",
  },
  {
    value: "WHEN_SENT",
    label: "When invoice is sent",
    help: "Push when you mark the invoice sent. Drafts stay here until then.",
  },
  {
    value: "WHEN_JOB_COMPLETED",
    label: "When job is completed",
    help: "Push invoices on a job after that job is marked complete.",
  },
  {
    value: "WHEN_PAYMENT_RECEIVED",
    label: "When payment is received",
    help: "Push the invoice (and the recorded payment, if the invoice is already in QuickBooks) after you record a payment here. This never charges a card or moves money.",
  },
];
