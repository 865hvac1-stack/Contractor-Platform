export type PropertyFactSource =
  | "CUSTOMER_PROVIDED"
  | "COMPANY_ENTERED"
  | "PUBLIC_RECORD"
  | "EXTERNAL_PROVIDER"
  | "DEMO";

export type PropertyFact<T> = {
  value: T | null;
  source: PropertyFactSource | null;
  retrievedAt: string | null;
  confidence: "verified" | "approximate" | "unknown";
};

export type PropertyLookup = {
  street: string;
  city: string;
  state: string;
  zip: string;
};

export type PropertyEnrichmentResult = {
  yearBuilt: PropertyFact<number>;
  squareFeet: PropertyFact<number>;
  bedrooms: PropertyFact<number>;
  bathrooms: PropertyFact<number>;
  lotSizeSqFt: PropertyFact<number>;
  lastSaleDate: PropertyFact<string>;
  lastSalePriceCents: PropertyFact<number>;
  assessedValueCents: PropertyFact<number>;
  latitude: PropertyFact<number>;
  longitude: PropertyFact<number>;
  image: PropertyFact<{ path: string; source: string }>;
  provider: string;
  status: "NONE" | "UNAVAILABLE" | "DEMO" | "READY";
  retrievedAt: string | null;
  externalId: string | null;
};

export interface PropertyEnrichmentProvider {
  id: string;
  label: string;
  configured: boolean;
  lookupProperty(address: PropertyLookup): Promise<PropertyEnrichmentResult>;
  getPropertyFacts(address: PropertyLookup): Promise<PropertyEnrichmentResult>;
  getSaleHistory(address: PropertyLookup): Promise<PropertyEnrichmentResult>;
  getPropertyImage(address: PropertyLookup): Promise<PropertyEnrichmentResult>;
  getPublicRecordValue(address: PropertyLookup): Promise<PropertyEnrichmentResult>;
  getCoordinates(address: PropertyLookup): Promise<PropertyEnrichmentResult>;
}

function emptyFact<T>(): PropertyFact<T> {
  return { value: null, source: null, retrievedAt: null, confidence: "unknown" };
}

export function emptyEnrichment(provider = "none"): PropertyEnrichmentResult {
  return {
    yearBuilt: emptyFact(),
    squareFeet: emptyFact(),
    bedrooms: emptyFact(),
    bathrooms: emptyFact(),
    lotSizeSqFt: emptyFact(),
    lastSaleDate: emptyFact(),
    lastSalePriceCents: emptyFact(),
    assessedValueCents: emptyFact(),
    latitude: emptyFact(),
    longitude: emptyFact(),
    image: emptyFact(),
    provider,
    status: "UNAVAILABLE",
    retrievedAt: null,
    externalId: null,
  };
}

/** Honest default: no paid property provider is connected. */
export class UnconfiguredPropertyEnrichmentProvider implements PropertyEnrichmentProvider {
  id = "none";
  label = "No property data provider connected";
  configured = false;

  async lookupProperty() {
    return emptyEnrichment(this.id);
  }
  async getPropertyFacts() {
    return emptyEnrichment(this.id);
  }
  async getSaleHistory() {
    return emptyEnrichment(this.id);
  }
  async getPropertyImage() {
    return emptyEnrichment(this.id);
  }
  async getPublicRecordValue() {
    return emptyEnrichment(this.id);
  }
  async getCoordinates() {
    return emptyEnrichment(this.id);
  }
}

export function getPropertyEnrichmentProvider(): PropertyEnrichmentProvider {
  return new UnconfiguredPropertyEnrichmentProvider();
}

export function propertyImagePriority(property: {
  photoPath: string | null;
  photoSource: string | null;
}) {
  if (property.photoPath && property.photoSource === "UPLOADED") {
    return { path: property.photoPath, source: "UPLOADED" as const, label: "Company uploaded" };
  }
  if (property.photoPath && property.photoSource === "PROVIDER") {
    return { path: property.photoPath, source: "PROVIDER" as const, label: "Authorized property imagery" };
  }
  if (property.photoPath && property.photoSource === "STREET") {
    return { path: property.photoPath, source: "STREET" as const, label: "Authorized street imagery" };
  }
  if (property.photoPath && property.photoSource === "MAP") {
    return { path: property.photoPath, source: "MAP" as const, label: "Map imagery" };
  }
  if (property.photoPath && property.photoSource === "PLACEHOLDER") {
    return { path: property.photoPath, source: "PLACEHOLDER" as const, label: "Demo placeholder — not this customer's actual home" };
  }
  return { path: null, source: "NONE" as const, label: "No property photo on file" };
}

export function factLabel(source: string | null) {
  if (source === "CUSTOMER_PROVIDED") return "Customer provided";
  if (source === "COMPANY_ENTERED") return "Company entered";
  if (source === "PUBLIC_RECORD") return "Public record";
  if (source === "EXTERNAL_PROVIDER") return "External provider";
  if (source === "DEMO") return "Synthetic demo data";
  return "Unknown source";
}
