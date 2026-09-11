import { addressKey, digitsOnly, nameKey, normalizeEmail, normalizeText } from "@/lib/imports/normalize";

export type IdentityConfidence = "AUTO_MATCH" | "REVIEW" | "NEW";

export type CanonicalCustomerCandidate = {
  id: string;
  firstName: string;
  lastName: string;
  businessName?: string | null;
  email?: string | null;
  phone?: string | null;
  sourceSystem?: string | null;
  externalId?: string | null;
  properties?: Array<{ address: string; city: string; zip: string }>;
};

export type IdentityProbe = {
  externalId?: string | null;
  sourceSystem?: string | null;
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  businessName?: string | null;
  name?: string | null;
  address?: string | null;
  city?: string | null;
  zip?: string | null;
  mappedCustomerId?: string | null;
};

export type IdentityDecision = {
  confidence: IdentityConfidence;
  customerId: string | null;
  reason: string;
};

export type IdentityIndex = {
  byMappedId: Map<string, string>;
  byExternalId: Map<string, string>;
  byEmail: Map<string, string[]>;
  byPhone: Map<string, string[]>;
  byName: Map<string, string[]>;
  byAddress: Map<string, string[]>;
  customers: Map<string, CanonicalCustomerCandidate>;
};

function last10(phone?: string | null) {
  const digits = digitsOnly(phone || "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

function displayName(probe: IdentityProbe) {
  return normalizeText(probe.name || `${probe.firstName ?? ""} ${probe.lastName ?? ""}`.trim());
}

export function buildIdentityIndex(
  customers: CanonicalCustomerCandidate[],
  mappings: Array<{ externalId: string; customerId: string; sourceSystem?: string | null }> = []
): IdentityIndex {
  const index: IdentityIndex = {
    byMappedId: new Map(),
    byExternalId: new Map(),
    byEmail: new Map(),
    byPhone: new Map(),
    byName: new Map(),
    byAddress: new Map(),
    customers: new Map(),
  };

  for (const mapping of mappings) {
    if (!mapping.externalId || !mapping.customerId) continue;
    const key = `${normalizeText(mapping.sourceSystem || "")}:${mapping.externalId.toLowerCase()}`;
    index.byMappedId.set(key, mapping.customerId);
    index.byExternalId.set(mapping.externalId.toLowerCase(), mapping.customerId);
  }

  for (const customer of customers) {
    index.customers.set(customer.id, customer);
    if (customer.externalId) {
      index.byExternalId.set(customer.externalId.toLowerCase(), customer.id);
      if (customer.sourceSystem) {
        index.byMappedId.set(`${normalizeText(customer.sourceSystem)}:${customer.externalId.toLowerCase()}`, customer.id);
      }
    }
    const email = normalizeEmail(customer.email);
    if (email) {
      const list = index.byEmail.get(email) ?? [];
      list.push(customer.id);
      index.byEmail.set(email, list);
    }
    const phone = last10(customer.phone);
    if (phone) {
      const list = index.byPhone.get(phone) ?? [];
      list.push(customer.id);
      index.byPhone.set(phone, list);
    }
    const name = nameKey(customer.firstName, customer.lastName, customer.businessName);
    if (name) {
      const list = index.byName.get(name) ?? [];
      list.push(customer.id);
      index.byName.set(name, list);
    }
    for (const property of customer.properties ?? []) {
      const addr = addressKey(property.address, property.city, property.zip);
      if (!addr) continue;
      const list = index.byAddress.get(addr) ?? [];
      list.push(customer.id);
      index.byAddress.set(addr, list);
    }
  }
  return index;
}

function uniqueHit(ids: string[] | undefined): string | null {
  if (!ids?.length) return null;
  const unique = [...new Set(ids)];
  return unique.length === 1 ? unique[0]! : null;
}

function ambiguous(ids: string[] | undefined) {
  return Boolean(ids && new Set(ids).size > 1);
}

/**
 * Canonical customer resolver.
 * Strong evidence only for AUTO_MATCH: provider mapping, email, or phone plus
 * another verified signal. Name alone is never enough.
 */
export function resolveCanonicalCustomer(index: IdentityIndex, probe: IdentityProbe): IdentityDecision {
  if (probe.mappedCustomerId && index.customers.has(probe.mappedCustomerId)) {
    return { confidence: "AUTO_MATCH", customerId: probe.mappedCustomerId, reason: "Existing verified provider mapping" };
  }

  if (probe.externalId) {
    const mappedKey = `${normalizeText(probe.sourceSystem || "")}:${probe.externalId.toLowerCase()}`;
    const mapped = index.byMappedId.get(mappedKey) || index.byExternalId.get(probe.externalId.toLowerCase());
    if (mapped) {
      return { confidence: "AUTO_MATCH", customerId: mapped, reason: "Same verified external customer ID" };
    }
  }

  const email = normalizeEmail(probe.email);
  const emailHits = email ? index.byEmail.get(email) ?? [] : [];
  const phone = last10(probe.phone);
  const phoneHits = phone ? index.byPhone.get(phone) ?? [] : [];
  const name = nameKey(
    probe.firstName || displayName(probe).split(" ")[0] || "",
    probe.lastName || displayName(probe).split(" ").slice(1).join(" "),
    probe.businessName
  );
  const nameHits = name ? index.byName.get(name) ?? [] : [];
  const address = probe.address ? addressKey(probe.address, probe.city || "", probe.zip || "") : "";
  const addressHits = address ? index.byAddress.get(address) ?? [] : [];

  if (ambiguous(emailHits) || ambiguous(phoneHits)) {
    return { confidence: "REVIEW", customerId: null, reason: "More than one customer shares this contact identity" };
  }

  const emailId = uniqueHit(emailHits);
  const phoneId = uniqueHit(phoneHits);

  if (emailId && phoneId && emailId === phoneId) {
    return { confidence: "AUTO_MATCH", customerId: emailId, reason: "Normalized email and phone both match" };
  }
  if (emailId) {
    return { confidence: "AUTO_MATCH", customerId: emailId, reason: "Normalized email matches an existing customer" };
  }
  if (phoneId && (nameHits.includes(phoneId) || addressHits.includes(phoneId))) {
    return {
      confidence: "AUTO_MATCH",
      customerId: phoneId,
      reason: nameHits.includes(phoneId)
        ? "Normalized phone and name match"
        : "Normalized phone and service address match",
    };
  }
  if (phoneId) {
    return { confidence: "REVIEW", customerId: phoneId, reason: "Normalized phone matches, but name or address did not confirm it" };
  }
  if (addressHits.length === 1 && nameHits.includes(addressHits[0]!)) {
    return { confidence: "REVIEW", customerId: addressHits[0]!, reason: "Same name and service address — confirm before merging" };
  }
  if (nameHits.length === 1 && normalizeText(probe.lastName || displayName(probe).split(" ").slice(1).join(" ")).length > 2) {
    return { confidence: "REVIEW", customerId: nameHits[0]!, reason: "Name-only match requires review" };
  }
  if (nameHits.length > 1) {
    return { confidence: "REVIEW", customerId: null, reason: "More than one customer has that name" };
  }
  return { confidence: "NEW", customerId: null, reason: "No strong identity match" };
}

export function identityToImportVerdict(decision: IdentityDecision): "EXACT_MATCH" | "LIKELY_DUPLICATE" | "NEEDS_REVIEW" | "NEW" {
  if (decision.confidence === "AUTO_MATCH") return "EXACT_MATCH";
  if (decision.confidence === "REVIEW") return "NEEDS_REVIEW";
  return "NEW";
}
