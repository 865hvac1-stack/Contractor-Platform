import { normalizeEmail, normalizeText } from "@/lib/imports/normalize";
import { digitsOnly } from "@/lib/imports/normalize";

export const ANALYSIS_STATUS_DEFINITIONS = {
  AVAILABLE: "Total records found in QuickBooks.",
  ALREADY_LINKED: "A realm-scoped QuickBooks external ID maps to a ContractorYou record.",
  NEW: "No external-ID mapping or credible ContractorYou record candidate exists.",
  UPDATED: "An already-linked record exists and QuickBooks contains newer or different data.",
  POSSIBLE_DUPLICATE: "No external-ID link exists, but a real ContractorYou candidate requires review.",
  CONFLICT: "Import cannot safely proceed because required data or relationships are unresolved or disagree.",
  SKIPPED: "The record was intentionally excluded.",
  FAILED: "Analysis encountered a technical failure.",
} as const;

export function customerFieldComparison(
  quickbooks: {
    displayName?: string | null;
    givenName?: string | null;
    familyName?: string | null;
    companyName?: string | null;
    email?: string | null;
    phone?: string | null;
    billingAddress?: string | null;
    serviceAddress?: string | null;
  },
  contractorYou?: {
    firstName: string;
    lastName: string;
    businessName?: string | null;
    email?: string | null;
    phone?: string | null;
    properties?: Array<{ address: string; city: string; zip: string }>;
  } | null
) {
  if (!contractorYou) return { matched: [] as string[], differing: [] as string[] };
  const matched: string[] = [];
  const differing: string[] = [];
  const compare = (field: string, left?: string | null, right?: string | null) => {
    const a = normalizeText(left).toLowerCase().replace(/\s+/g, " ");
    const b = normalizeText(right).toLowerCase().replace(/\s+/g, " ");
    if (!a && !b) return;
    if (a && b && a === b) matched.push(field);
    else differing.push(field);
  };
  compare("first name", quickbooks.givenName, contractorYou.firstName);
  compare("last name", quickbooks.familyName, contractorYou.lastName);
  compare("company", quickbooks.companyName, contractorYou.businessName);

  const qboEmail = normalizeEmail(quickbooks.email);
  const cyEmail = normalizeEmail(contractorYou.email);
  if (qboEmail || cyEmail) {
    if (qboEmail && cyEmail && qboEmail === cyEmail) matched.push("email");
    else differing.push("email");
  }

  const qboPhone = digitsOnly(quickbooks.phone).slice(-10);
  const cyPhone = digitsOnly(contractorYou.phone).slice(-10);
  if (qboPhone || cyPhone) {
    if (qboPhone && cyPhone && qboPhone === cyPhone) matched.push("phone");
    else differing.push("phone");
  }

  const propertyText = contractorYou.properties
    ?.map((row) => `${row.address} ${row.city} ${row.zip}`.toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter(Boolean);
  for (const [field, address] of [
    ["billing address", quickbooks.billingAddress],
    ["service address", quickbooks.serviceAddress],
  ] as const) {
    if (!address) continue;
    const key = address.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (key && propertyText?.some((property) => property === key)) matched.push(field);
    else differing.push(field);
  }
  return { matched, differing };
}

export function isLinkedCustomerChanged(
  comparison: ReturnType<typeof customerFieldComparison>,
  quickbooksLastModified?: string | null,
  lastSyncedAt?: Date | null
) {
  const modified = quickbooksLastModified ? new Date(quickbooksLastModified) : null;
  const newer =
    modified && !Number.isNaN(modified.getTime()) && lastSyncedAt
      ? modified.getTime() > lastSyncedAt.getTime()
      : false;
  return newer || comparison.differing.length > 0;
}

export function invoiceDuplicateCandidate(
  quickbooks: {
    invoiceNumber?: string | null;
    date?: string | null;
    totalCents: number;
    resolvedCustomerId?: string | null;
  },
  local: Array<{
    id: string;
    invoiceNumber: string;
    issueDate: Date;
    totalCents: number;
    customerId: string;
  }>
) {
  const number = normalizeText(quickbooks.invoiceNumber).toLowerCase();
  if (!number) return null;
  const date = quickbooks.date ? new Date(quickbooks.date) : null;
  const candidates = local.filter((row) => row.invoiceNumber.trim().toLowerCase() === number);
  const scored = candidates
    .map((row) => {
      const signals = ["invoice number"];
      if (row.totalCents === quickbooks.totalCents) signals.push("amount");
      if (date && !Number.isNaN(date.getTime()) && row.issueDate.toISOString().slice(0, 10) === date.toISOString().slice(0, 10)) {
        signals.push("date");
      }
      if (quickbooks.resolvedCustomerId && row.customerId === quickbooks.resolvedCustomerId) signals.push("customer");
      return { row, signals };
    })
    .filter((candidate) => candidate.signals.length >= 2)
    .sort((a, b) => b.signals.length - a.signals.length);
  if (scored.length !== 1) return null;
  return { invoiceId: scored[0]!.row.id, signals: scored[0]!.signals };
}

export function paymentConflictReasons(input: {
  invoiceResolved: boolean;
  customerResolved: boolean;
}) {
  return [
    ...(input.invoiceResolved ? [] : ["Payment invoice not found"]),
    ...(input.customerResolved ? [] : ["Payment customer not found"]),
  ];
}
