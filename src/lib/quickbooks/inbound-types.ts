export const INBOUND_OBJECT_TYPES = [
  "CUSTOMER",
  "VENDOR",
  "ITEM",
  "ACCOUNT",
  "INVOICE",
  "PAYMENT",
  "PURCHASE",
] as const;

export type InboundObjectType = (typeof INBOUND_OBJECT_TYPES)[number];

export const INBOUND_STAGES: InboundObjectType[][] = [
  ["CUSTOMER"],
  ["VENDOR", "ITEM", "ACCOUNT"],
  ["INVOICE"],
  ["PAYMENT"],
  ["PURCHASE"],
];

export const INBOUND_LABELS: Record<InboundObjectType, string> = {
  CUSTOMER: "Customers",
  VENDOR: "Vendors",
  ITEM: "Products / Services",
  ACCOUNT: "Chart of Accounts",
  INVOICE: "Invoices",
  PAYMENT: "Payments",
  PURCHASE: "Expenses / Purchases",
};

export const QBO_ENTITY: Record<InboundObjectType, string> = {
  CUSTOMER: "Customer",
  VENDOR: "Vendor",
  ITEM: "Item",
  ACCOUNT: "Account",
  INVOICE: "Invoice",
  PAYMENT: "Payment",
  PURCHASE: "Purchase",
};

export const MAPPING_ENTITY: Record<InboundObjectType, string> = {
  CUSTOMER: "CUSTOMER",
  VENDOR: "VENDOR",
  ITEM: "ITEM",
  ACCOUNT: "ACCOUNT",
  INVOICE: "INVOICE",
  PAYMENT: "PAYMENT",
  PURCHASE: "EXPENSE",
};

export type MatchConfidence = "EXACT" | "HIGH" | "POSSIBLE" | "NONE";

export const IMPORT_CONFIRMATION = "IMPORT APPROVED QUICKBOOKS RECORDS";
