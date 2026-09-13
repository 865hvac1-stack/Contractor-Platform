import {
  addressKey,
  digitsOnly,
  nameKey,
  normalizeEmail,
  normalizeText,
  splitFullName,
} from "@/lib/imports/normalize";
import {
  buildIdentityIndex,
  type CanonicalCustomerCandidate,
  type IdentityIndex,
} from "@/lib/imports/identity";
import type { MatchConfidence } from "@/lib/quickbooks/inbound-types";
import type { QboAddress } from "@/lib/quickbooks/read-only";

export type InboundCustomerProbe = {
  quickbooksId: string;
  displayName?: string | null;
  givenName?: string | null;
  familyName?: string | null;
  companyName?: string | null;
  email?: string | null;
  phone?: string | null;
  billAddr?: QboAddress | null;
  shipAddr?: QboAddress | null;
};

export type InboundCustomerMatch = {
  confidence: MatchConfidence;
  customerId: string | null;
  reason: string;
  proposedAction: "LINK" | "CREATE" | "REVIEW";
  signals: string[];
};

function last10(phone?: string | null) {
  const digits = digitsOnly(phone || "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

function uniqueIds(ids: string[] | undefined) {
  return [...new Set(ids ?? [])];
}

function addressFrom(addr?: QboAddress | null) {
  if (!addr?.Line1) return "";
  return addressKey(addr.Line1, addr.City || "", addr.PostalCode || "");
}

export function classifyInboundCustomer(
  index: IdentityIndex,
  probe: InboundCustomerProbe,
  mappedCustomerId?: string | null
): InboundCustomerMatch {
  const signals: string[] = [];
  if (mappedCustomerId && index.customers.has(mappedCustomerId)) {
    return {
      confidence: "EXACT",
      customerId: mappedCustomerId,
      reason: "Existing QuickBooks external ID already linked in this tenant and realm.",
      proposedAction: "LINK",
      signals: ["quickbooksId"],
    };
  }

  const mapped = index.byExternalId.get(probe.quickbooksId.toLowerCase());
  if (mapped) {
    return {
      confidence: "EXACT",
      customerId: mapped,
      reason: "Same QuickBooks customer ID is already stored on a ContractorYou customer.",
      proposedAction: "LINK",
      signals: ["quickbooksId"],
    };
  }

  const names = splitFullName(probe.displayName || `${probe.givenName || ""} ${probe.familyName || ""}`);
  const firstName = probe.givenName || names.firstName;
  const lastName = probe.familyName || names.lastName;
  const email = normalizeEmail(probe.email);
  const phone = last10(probe.phone);
  const personKey = nameKey(firstName, lastName, probe.companyName || probe.displayName);
  const billKey = addressFrom(probe.billAddr);
  const shipKey = addressFrom(probe.shipAddr);

  const emailHits = uniqueIds(email ? index.byEmail.get(email) : []);
  const phoneHits = uniqueIds(phone ? index.byPhone.get(phone) : []);
  const nameHits = uniqueIds(personKey ? index.byName.get(personKey) : []);
  const addressHits = uniqueIds([
    ...(billKey ? index.byAddress.get(billKey) ?? [] : []),
    ...(shipKey ? index.byAddress.get(shipKey) ?? [] : []),
  ]);

  if (email) signals.push("email");
  if (phone) signals.push("phone");
  if (personKey) signals.push("name");
  if (billKey || shipKey) signals.push("address");

  if (emailHits.length > 1 || phoneHits.length > 1) {
    return {
      confidence: "POSSIBLE",
      customerId: emailHits[0] || phoneHits[0] || null,
      reason: "More than one ContractorYou customer shares this email or phone. Manual review required.",
      proposedAction: "REVIEW",
      signals,
    };
  }

  const emailId = emailHits[0] ?? null;
  const phoneId = phoneHits[0] ?? null;

  if (emailId && phoneId && emailId === phoneId) {
    return {
      confidence: "EXACT",
      customerId: emailId,
      reason: "Normalized email and phone both match one existing customer.",
      proposedAction: "LINK",
      signals: [...signals, "email+phone"],
    };
  }
  if (emailId) {
    const nameConfirms = nameHits.includes(emailId) || addressHits.includes(emailId);
    return {
      confidence: nameConfirms ? "EXACT" : "HIGH",
      customerId: emailId,
      reason: nameConfirms
        ? "Normalized email matches, and name or address confirms the same customer."
        : "Normalized email matches one customer. High-confidence link if approved.",
      proposedAction: "LINK",
      signals,
    };
  }
  if (phoneId && (nameHits.includes(phoneId) || addressHits.includes(phoneId))) {
    return {
      confidence: "HIGH",
      customerId: phoneId,
      reason: nameHits.includes(phoneId)
        ? "Normalized phone and name match one customer."
        : "Normalized phone and address match one customer.",
      proposedAction: "LINK",
      signals,
    };
  }
  if (phoneId) {
    return {
      confidence: "POSSIBLE",
      customerId: phoneId,
      reason: "Phone matches, but name and address did not confirm it. Do not merge silently.",
      proposedAction: "REVIEW",
      signals,
    };
  }
  if (addressHits.length === 1 && nameHits.includes(addressHits[0]!)) {
    return {
      confidence: "POSSIBLE",
      customerId: addressHits[0]!,
      reason: "Same name and address — possible duplicate. Manual review required.",
      proposedAction: "REVIEW",
      signals,
    };
  }
  if (nameHits.length === 1 && normalizeText(lastName).length > 2) {
    return {
      confidence: "POSSIBLE",
      customerId: nameHits[0]!,
      reason: "Name-only match. Never auto-linked.",
      proposedAction: "REVIEW",
      signals,
    };
  }
  if (nameHits.length > 1) {
    return {
      confidence: "POSSIBLE",
      customerId: null,
      reason: "More than one customer has that name.",
      proposedAction: "REVIEW",
      signals,
    };
  }
  return {
    confidence: "NONE",
    customerId: null,
    reason: "No ContractorYou customer matched. Eligible to create after approval.",
    proposedAction: "CREATE",
    signals,
  };
}

export function buildInboundCustomerIndex(
  customers: CanonicalCustomerCandidate[],
  mappings: Array<{ quickbooksId: string; customerId: string }>
) {
  return buildIdentityIndex(
    customers,
    mappings.map((row) => ({
      customerId: row.customerId,
      externalId: row.quickbooksId,
      sourceSystem: "quickbooks_online",
    }))
  );
}

export function classifyPricebookItem(input: {
  quickbooksId: string;
  name: string;
  sku?: string | null;
  mappedItemId?: string | null;
  nameMatches: Array<{ id: string; name: string }>;
  skuMatches: Array<{ id: string; sku: string | null }>;
}) {
  if (input.mappedItemId) {
    return {
      confidence: "EXACT" as const,
      itemId: input.mappedItemId,
      reason: "Already linked by QuickBooks item ID.",
      proposedAction: "LINK" as const,
    };
  }
  if (input.sku && input.skuMatches.length === 1) {
    return {
      confidence: "HIGH" as const,
      itemId: input.skuMatches[0]!.id,
      reason: "SKU matches one pricebook item.",
      proposedAction: "LINK" as const,
    };
  }
  const exactName = input.nameMatches.filter(
    (row) => row.name.trim().toLowerCase() === input.name.trim().toLowerCase()
  );
  if (exactName.length === 1) {
    return {
      confidence: "POSSIBLE" as const,
      itemId: exactName[0]!.id,
      reason: "Name matches a pricebook item. Confirm before linking.",
      proposedAction: "REVIEW" as const,
    };
  }
  if (exactName.length > 1 || input.skuMatches.length > 1) {
    return {
      confidence: "POSSIBLE" as const,
      itemId: null,
      reason: "Multiple pricebook items could match. Manual review required.",
      proposedAction: "REVIEW" as const,
    };
  }
  return {
    confidence: "NONE" as const,
    itemId: null,
    reason: "No pricebook match. Eligible to create after approval.",
    proposedAction: "CREATE" as const,
  };
}

export function classifyAccountType(accountType?: string | null, accountSubType?: string | null) {
  const type = `${accountType || ""} ${accountSubType || ""}`.toLowerCase();
  if (type.includes("income") && !type.includes("other expense")) return "INCOME" as const;
  if (type.includes("cost of goods") || type.includes("cogs")) return "COGS" as const;
  if (type.includes("expense")) return "OPERATING_EXPENSE" as const;
  if (type.includes("bank") || type.includes("asset") || type.includes("accounts receivable")) return "ASSET" as const;
  if (type.includes("liability") || type.includes("credit card") || type.includes("accounts payable")) {
    return "LIABILITY" as const;
  }
  if (type.includes("equity")) return "EQUITY" as const;
  return "OTHER" as const;
}
