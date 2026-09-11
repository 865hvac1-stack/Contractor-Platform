import type {
  DuplicateMatch,
  DuplicatePolicy,
  ExistingCustomerIndex,
  MappedCustomer,
} from "@/lib/imports/types";
import { addressKey, digitsOnly, nameKey, normalizeEmail } from "@/lib/imports/normalize";
import { buildIdentityIndex, identityToImportVerdict, resolveCanonicalCustomer } from "@/lib/imports/identity";

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

const CUSTOMERS = new WeakMap<ExistingCustomerIndex, IndexedCustomer[]>();

export function buildCustomerIndex(customers: IndexedCustomer[]): ExistingCustomerIndex {
  const index: ExistingCustomerIndex = {
    byExternalId: new Map(),
    byEmail: new Map(),
    byPhone: new Map(),
    byName: new Map(),
    byAddress: new Map(),
  };
  CUSTOMERS.set(index, customers);
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
  const customers = CUSTOMERS.get(index) ?? [];
  const identity = buildIdentityIndex(customers);
  const primary = mapped.properties[0];
  const decision = resolveCanonicalCustomer(identity, {
    externalId: mapped.externalId,
    email: mapped.email,
    phone: mapped.phone,
    firstName: mapped.firstName,
    lastName: mapped.lastName,
    businessName: mapped.businessName,
    address: primary?.address,
    city: primary?.city,
    zip: primary?.zip,
  });
  const verdict = identityToImportVerdict(decision);
  return {
    verdict,
    match: decision.customerId ? { customerId: decision.customerId, reason: decision.reason } : null,
  };
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
