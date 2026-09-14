import {
  digitsOnly,
  normalizeEmail,
  normalizeText,
  splitFullName,
} from "@/lib/imports/normalize";
import type {
  InboundCustomerMatch,
  InboundCustomerProbe,
} from "@/lib/quickbooks/inbound-match";

export const AUTO_APPROVAL_BLOCKERS = [
  "PHONE_MISSING",
  "EMAIL_MISSING",
  "PHONE_NOT_UNIQUE",
  "EMAIL_NOT_UNIQUE",
  "PHONE_EMAIL_RESOLVE_DIFFERENT_CUSTOMERS",
  "STALE_FINGERPRINT",
  "CANDIDATE_CHANGED",
  "ADDRESS_CONFLICT",
  "NAME_CONFLICT",
  "MULTIPLE_CANDIDATES",
  "POSSIBLE_DUPLICATE",
  "IDENTITY_CONFLICT",
  "OTHER",
] as const;

export type AutoApprovalBlocker = (typeof AUTO_APPROVAL_BLOCKERS)[number];
export type AutoApprovalTier = "TIER_A" | "TIER_B" | "TIER_C" | "SAFE_NEW";

export type ReviewCustomer = {
  id: string;
  firstName: string;
  lastName: string;
  businessName?: string | null;
  email?: string | null;
  phone?: string | null;
  properties?: Array<{ address: string; city: string; zip: string }>;
};

export type AutoApprovalUniverse = {
  customers: Map<string, ReviewCustomer>;
  emailToIds: Map<string, string[]>;
  phoneToIds: Map<string, string[]>;
  externalToId: Map<string, string>;
};

function phoneKey(value?: string | null) {
  const digits = digitsOnly(value || "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

function push(map: Map<string, string[]>, key: string, id: string) {
  if (!key) return;
  const ids = map.get(key) ?? [];
  ids.push(id);
  map.set(key, ids);
}

export function buildAutoApprovalUniverse(
  customers: ReviewCustomer[],
  mappings: Array<{ quickbooksId: string; customerId: string }> = []
): AutoApprovalUniverse {
  const universe: AutoApprovalUniverse = {
    customers: new Map(customers.map((customer) => [customer.id, customer])),
    emailToIds: new Map(),
    phoneToIds: new Map(),
    externalToId: new Map(mappings.map((mapping) => [mapping.quickbooksId, mapping.customerId])),
  };
  for (const customer of customers) {
    push(universe.emailToIds, normalizeEmail(customer.email) || "", customer.id);
    push(universe.phoneToIds, phoneKey(customer.phone), customer.id);
  }
  return universe;
}

function unique(ids?: string[]) {
  return [...new Set(ids ?? [])];
}

function words(value?: string | null) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeReviewAddress(input: {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  zip?: string | null;
}) {
  const suffixes: Record<string, string> = {
    street: "st",
    avenue: "ave",
    road: "rd",
    lane: "ln",
    drive: "dr",
    boulevard: "blvd",
    court: "ct",
    circle: "cir",
    highway: "hwy",
    parkway: "pkwy",
    place: "pl",
    terrace: "ter",
    trail: "trl",
    apartment: "unit",
    apt: "unit",
    suite: "unit",
  };
  const street = words(`${input.line1 || ""} ${input.line2 || ""}`)
    .split(" ")
    .map((part) => suffixes[part] || part)
    .join(" ");
  const city = words(input.city);
  const zip = digitsOnly(input.zip || "").slice(0, 5);
  return [street, city, zip].filter(Boolean).join("|");
}

function qboAddressKeys(probe: InboundCustomerProbe) {
  return [probe.billAddr, probe.shipAddr]
    .map((address) => normalizeReviewAddress({
      line1: address?.Line1,
      line2: address?.Line2,
      city: address?.City,
      zip: address?.PostalCode,
    }))
    .filter(Boolean);
}

function customerAddressKeys(customer?: ReviewCustomer | null) {
  return (customer?.properties ?? [])
    .map((property) =>
      normalizeReviewAddress({
        line1: property.address,
        city: property.city,
        zip: property.zip,
      })
    )
    .filter(Boolean);
}

function fullNameMatches(probe: InboundCustomerProbe, candidate: ReviewCustomer) {
  const split = splitFullName(
    probe.displayName || `${probe.givenName || ""} ${probe.familyName || ""}`
  );
  const qboFirst = words(probe.givenName || split.firstName);
  const qboLast = words(probe.familyName || split.lastName);
  return Boolean(
    qboFirst &&
      qboLast &&
      qboFirst === words(candidate.firstName) &&
      qboLast === words(candidate.lastName)
  );
}

function companyMatches(probe: InboundCustomerProbe, candidate: ReviewCustomer) {
  const qbo = words(probe.companyName);
  const local = words(candidate.businessName);
  return Boolean(qbo && local && qbo === local);
}

function addressMatchesAnyProperty(probe: InboundCustomerProbe, candidate: ReviewCustomer) {
  const qbo = qboAddressKeys(probe);
  const local = new Set(customerAddressKeys(candidate));
  return qbo.some((address) => local.has(address));
}

function hasAddressConflict(probe: InboundCustomerProbe, candidate: ReviewCustomer) {
  return qboAddressKeys(probe).length > 0 &&
    customerAddressKeys(candidate).length > 0 &&
    !addressMatchesAnyProperty(probe, candidate);
}

export function evaluateCustomerAutoApproval(input: {
  probe: InboundCustomerProbe;
  match: InboundCustomerMatch;
  universe: AutoApprovalUniverse;
  fingerprintFresh: boolean;
  candidateUnchanged: boolean;
}) {
  const email = normalizeEmail(input.probe.email) || "";
  const phone = phoneKey(input.probe.phone);
  const emailIds = unique(email ? input.universe.emailToIds.get(email) : []);
  const phoneIds = unique(phone ? input.universe.phoneToIds.get(phone) : []);
  const candidate = input.match.customerId
    ? input.universe.customers.get(input.match.customerId)
    : null;

  if (!input.fingerprintFresh) return blocked("STALE_FINGERPRINT");
  if (!input.candidateUnchanged) return blocked("CANDIDATE_CHANGED");
  if (input.match.confidence === "POSSIBLE") {
    return blocked((input.match.candidateIds?.length ?? 0) > 1 ? "MULTIPLE_CANDIDATES" : "POSSIBLE_DUPLICATE");
  }
  if (phoneIds.length > 1) return blocked("PHONE_NOT_UNIQUE");
  if (emailIds.length > 1) return blocked("EMAIL_NOT_UNIQUE");
  if (emailIds[0] && phoneIds[0] && emailIds[0] !== phoneIds[0]) {
    return blocked("PHONE_EMAIL_RESOLVE_DIFFERENT_CUSTOMERS");
  }

  if (input.match.confidence === "NONE") {
    const externalCollision = input.universe.externalToId.has(input.probe.quickbooksId);
    const strongNameAddressCandidate = [...input.universe.customers.values()].some(
      (customer) =>
        fullNameMatches(input.probe, customer) &&
        addressMatchesAnyProperty(input.probe, customer)
    );
    if (
      !externalCollision &&
      emailIds.length === 0 &&
      phoneIds.length === 0 &&
      !strongNameAddressCandidate &&
      !(input.match.candidateIds?.length)
    ) {
      return eligible("SAFE_NEW", []);
    }
    return blocked(strongNameAddressCandidate ? "POSSIBLE_DUPLICATE" : "IDENTITY_CONFLICT");
  }

  if (!candidate) return blocked("MULTIPLE_CANDIDATES");
  const name = fullNameMatches(input.probe, candidate);
  const company = companyMatches(input.probe, candidate);
  const address = addressMatchesAnyProperty(input.probe, candidate);
  const support = [
    ...(name ? ["full name"] : []),
    ...(company ? ["company"] : []),
    ...(address ? ["property address"] : []),
  ];
  const candidateEmail = normalizeEmail(candidate.email) || "";
  const candidatePhone = phoneKey(candidate.phone);
  const emailConflict = Boolean(email && candidateEmail && email !== candidateEmail);
  const phoneConflict = Boolean(phone && candidatePhone && phone !== candidatePhone);

  if (emailConflict || phoneConflict) return blocked("IDENTITY_CONFLICT", support);
  if (!name && (input.probe.givenName || input.probe.familyName) && candidate.firstName && candidate.lastName) {
    return blocked("NAME_CONFLICT", support);
  }
  if (hasAddressConflict(input.probe, candidate)) return blocked("ADDRESS_CONFLICT", support);

  if (
    email &&
    phone &&
    emailIds.length === 1 &&
    phoneIds.length === 1 &&
    emailIds[0] === candidate.id &&
    phoneIds[0] === candidate.id
  ) {
    return eligible("TIER_A", ["unique email", "unique phone", ...support]);
  }
  if (phone && phoneIds.length === 1 && phoneIds[0] === candidate.id && support.length >= 2 && !emailConflict) {
    return eligible("TIER_B", ["unique phone", ...support]);
  }
  if (email && emailIds.length === 1 && emailIds[0] === candidate.id && support.length >= 2 && !phoneConflict) {
    return eligible("TIER_C", ["unique email", ...support]);
  }
  if (!email && phoneIds[0] === candidate.id) return blocked("EMAIL_MISSING", support);
  if (!phone && emailIds[0] === candidate.id) return blocked("PHONE_MISSING", support);
  return blocked("OTHER", support);
}

function eligible(tier: AutoApprovalTier, supportingSignals: string[]) {
  return {
    eligible: true as const,
    tier,
    blocker: null,
    supportingSignals,
  };
}

function blocked(blocker: AutoApprovalBlocker, supportingSignals: string[] = []) {
  return {
    eligible: false as const,
    tier: null,
    blocker,
    supportingSignals,
  };
}

export function blockerLabel(blocker?: string | null) {
  if (!blocker) return "Eligible for safe approval";
  const labels: Record<string, string> = {
    PHONE_MISSING: "Phone missing",
    EMAIL_MISSING: "Email missing",
    PHONE_NOT_UNIQUE: "Phone is shared by multiple customers",
    EMAIL_NOT_UNIQUE: "Email is shared by multiple customers",
    PHONE_EMAIL_RESOLVE_DIFFERENT_CUSTOMERS: "Phone and email resolve to different customers",
    STALE_FINGERPRINT: "Analysis fingerprint is stale",
    CANDIDATE_CHANGED: "ContractorYou candidate changed",
    ADDRESS_CONFLICT: "QuickBooks address does not match any candidate property",
    NAME_CONFLICT: "Customer name conflicts",
    MULTIPLE_CANDIDATES: "Multiple ContractorYou candidates",
    POSSIBLE_DUPLICATE: "Possible duplicate requires judgment",
    IDENTITY_CONFLICT: "Strong identity data conflicts",
    OTHER: "Not enough deterministic supporting identity",
  };
  return labels[blocker] || blocker.replaceAll("_", " ").toLowerCase();
}
