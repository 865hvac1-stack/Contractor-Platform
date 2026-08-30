import type {
  DuplicateMatch,
  DuplicatePolicy,
  ExistingCustomerIndex,
  MappedCustomer,
} from "@/lib/imports/types";
import { addressKey, digitsOnly, nameKey, normalizeEmail, normalizeText } from "@/lib/imports/normalize";

export type IndexedCustomer = {
  id: string;
  firstName: string;
  lastName: string;
  businessName: string | null;
  email: string | null;
  phone: string | null;
  sourceSystem: string | null;
  externalId: string | null;
  properties: { address: string; city: string; zip: string }[];
};

export function buildCustomerIndex(customers: IndexedCustomer[]): ExistingCustomerIndex {
  const index: ExistingCustomerIndex = {
    byExternalId: new Map(),
    byEmail: new Map(),
    byPhone: new Map(),
    byName: new Map(),
    byAddress: new Map(),
  };
  for (const customer of customers) {
    if (customer.externalId) {
      index.byExternalId.set(customer.externalId.toLowerCase(), {
        id: customer.id,
        sourceSystem: customer.sourceSystem,
      });
    }
    const email = normalizeEmail(customer.email);
    if (email) index.byEmail.set(email, customer.id);
    const phone = digitsOnly(customer.phone);
    if (phone.length >= 10) index.byPhone.set(phone.slice(-10), customer.id);
    const key = nameKey(customer.firstName, customer.lastName, customer.businessName);
    const names = index.byName.get(key) ?? [];
    names.push(customer.id);
    index.byName.set(key, names);
    for (const property of customer.properties) {
      const addr = addressKey(property.address, property.city, property.zip);
      if (addr) index.byAddress.set(addr, customer.id);
    }
  }
  return index;
}

export function detectDuplicate(
  mapped: MappedCustomer,
  index: ExistingCustomerIndex
): { verdict: "NEW" | "LIKELY_DUPLICATE" | "EXACT_MATCH" | "NEEDS_REVIEW"; match: DuplicateMatch | null } {
  if (mapped.externalId) {
    const hit = index.byExternalId.get(mapped.externalId.toLowerCase());
    if (hit) {
      return {
        verdict: "EXACT_MATCH",
        match: { customerId: hit.id, reason: "Same external customer ID" },
      };
    }
  }
  const email = normalizeEmail(mapped.email);
  if (email && index.byEmail.has(email)) {
    return {
      verdict: "EXACT_MATCH",
      match: { customerId: index.byEmail.get(email)!, reason: "Same email address" },
    };
  }
  const phone = digitsOnly(mapped.phone);
  const phoneHit = phone.length >= 10 ? index.byPhone.get(phone.slice(-10)) : undefined;
  const name = nameKey(mapped.firstName, mapped.lastName, mapped.businessName);
  const nameHits = index.byName.get(name) ?? [];
  const addressHits = mapped.properties
    .map((property) => index.byAddress.get(addressKey(property.address, property.city, property.zip)))
    .filter(Boolean) as string[];

  if (phoneHit && nameHits.includes(phoneHit)) {
    return {
      verdict: "LIKELY_DUPLICATE",
      match: { customerId: phoneHit, reason: "Same phone number and name" },
    };
  }
  if (addressHits.length && nameHits.some((id) => addressHits.includes(id))) {
    return {
      verdict: "LIKELY_DUPLICATE",
      match: { customerId: addressHits[0]!, reason: "Same name and service address" },
    };
  }
  if (phoneHit) {
    return {
      verdict: "NEEDS_REVIEW",
      match: { customerId: phoneHit, reason: "Same phone number" },
    };
  }
  if (nameHits.length === 1 && normalizeText(mapped.lastName).length > 2) {
    return {
      verdict: "NEEDS_REVIEW",
      match: { customerId: nameHits[0]!, reason: "Same customer name" },
    };
  }
  return { verdict: "NEW", match: null };
}

export function actionForDuplicate(
  verdict: "NEW" | "LIKELY_DUPLICATE" | "EXACT_MATCH" | "NEEDS_REVIEW",
  policy: DuplicatePolicy
): "CREATE" | "UPDATE" | "SKIP" {
  if (verdict === "NEW") return "CREATE";
  if (policy === "CREATE_NEW") return "CREATE";
  if (policy === "UPDATE_EXACT" && verdict === "EXACT_MATCH") return "UPDATE";
  return "SKIP";
}
