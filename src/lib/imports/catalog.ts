import type { FieldKind, ImportRecordTypeId, MappingConfidence, TargetField } from "@/lib/imports/types";

export type CatalogField = {
  id: string;
  label: string;
  kind: FieldKind;
  tokens: string[];
  confidence?: MappingConfidence;
};

export const LIVE_ENTITY_TYPES: ImportRecordTypeId[] = [
  "CUSTOMERS",
  "PROPERTIES",
  "JOBS",
  "ESTIMATES",
  "INVOICES",
  "PAYMENTS",
  "EQUIPMENT",
  "EXPENSES",
  "NOTES",
  "TAGS",
  "LEAD_SOURCES",
];

export const FOUNDATION_ENTITY_TYPES: ImportRecordTypeId[] = [
  "MEMBERSHIPS",
  "PRICEBOOK",
  "CONTACTS",
  "COMMUNICATIONS",
  "OTHER",
];

export const FOUNDATION_REASON: Record<string, string> = {
  MEMBERSHIPS:
    "Service agreements are managed in Operations → Memberships. Historical membership import does not activate billing, send notices, or generate compensation.",
  PRICEBOOK:
    "Pricebook items are managed in Operations → Pricebook. Historical pricebook import does not create compensation or customer notices.",
  CONTACTS: "People are customers today. A separate contact book is not in the data model.",
  COMMUNICATIONS: "Historical SMS/email logs are not a first-class record yet.",
  OTHER: "Use a supported type, or Customers if this is a mixed contact list.",
};

export const RECOMMENDED_ORDER: ImportRecordTypeId[] = [
  "CUSTOMERS",
  "PROPERTIES",
  "EQUIPMENT",
  "JOBS",
  "ESTIMATES",
  "INVOICES",
  "PAYMENTS",
  "NOTES",
  "TAGS",
  "LEAD_SOURCES",
  "EXPENSES",
];

const SHARED_CUSTOMER: CatalogField[] = [
  { id: "customerExternalId", label: "Customer’s source ID", kind: "id", tokens: ["customer id", "client id", "external customer id", "cust id"], confidence: "high" },
  { id: "customerEmail", label: "Customer email", kind: "contact_email", tokens: ["email", "customer email", "client email"], confidence: "high" },
  { id: "customerPhone", label: "Customer phone", kind: "contact_phone", tokens: ["phone", "customer phone", "client phone", "mobile"], confidence: "medium" },
  { id: "customerName", label: "Customer name", kind: "name", tokens: ["customer", "customer name", "client name", "account name"], confidence: "medium" },
  { id: "firstName", label: "First name", kind: "name", tokens: ["first name", "firstname", "fname"], confidence: "high" },
  { id: "lastName", label: "Last name", kind: "name", tokens: ["last name", "lastname", "lname"], confidence: "high" },
  { id: "businessName", label: "Company name", kind: "name", tokens: ["company", "company name", "business name"], confidence: "high" },
];

const SHARED_PROPERTY: CatalogField[] = [
  { id: "propertyExternalId", label: "Property source ID", kind: "id", tokens: ["property id", "location id", "service location id"], confidence: "high" },
  { id: "propertyName", label: "Property name", kind: "name", tokens: ["property name", "location name"], confidence: "medium" },
  { id: "address", label: "Address", kind: "address", tokens: ["address", "street", "service address"], confidence: "high" },
  { id: "city", label: "City", kind: "address", tokens: ["city"], confidence: "high" },
  { id: "state", label: "State", kind: "address", tokens: ["state", "province"], confidence: "high" },
  { id: "zip", label: "Postal code", kind: "address", tokens: ["zip", "postal code", "zip code"], confidence: "high" },
];

export const ENTITY_FIELDS: Record<ImportRecordTypeId, CatalogField[]> = {
  CUSTOMERS: [],
  PROPERTIES: [
    { id: "externalId", label: "Property source ID", kind: "id", tokens: ["property id", "location id", "id"], confidence: "medium" },
    ...SHARED_CUSTOMER,
    ...SHARED_PROPERTY,
    { id: "notes", label: "Notes", kind: "text", tokens: ["notes", "access notes"], confidence: "medium" },
  ],
  JOBS: [
    { id: "externalId", label: "Job source ID", kind: "id", tokens: ["job id", "work order id", "external job id"], confidence: "high" },
    { id: "jobNumber", label: "Job number", kind: "id", tokens: ["job number", "wo number", "work order"], confidence: "high" },
    { id: "jobType", label: "Job type", kind: "text", tokens: ["job type", "type", "service type"], confidence: "medium" },
    { id: "status", label: "Job status", kind: "text", tokens: ["status", "job status"], confidence: "high" },
    { id: "description", label: "Description", kind: "text", tokens: ["description", "job description", "summary"], confidence: "medium" },
    { id: "notes", label: "Notes", kind: "text", tokens: ["notes", "internal notes", "comments"], confidence: "medium" },
    { id: "source", label: "Lead source", kind: "text", tokens: ["lead source", "source"], confidence: "medium" },
    { id: "tags", label: "Tags", kind: "text", tokens: ["tags", "tag"], confidence: "medium" },
    { id: "createdDate", label: "Original job date", kind: "date", tokens: ["created", "created date", "job created", "date created"], confidence: "medium" },
    { id: "scheduledStart", label: "Scheduled start", kind: "date", tokens: ["scheduled", "scheduled start", "start date", "appointment"], confidence: "medium" },
    { id: "completedAt", label: "Completed date", kind: "date", tokens: ["completed", "completed date", "finished"], confidence: "medium" },
    { id: "technicianName", label: "Technician / employee name", kind: "name", tokens: ["technician", "tech", "employee", "assigned to"], confidence: "medium" },
    { id: "subtotal", label: "Subtotal", kind: "money", tokens: ["subtotal"], confidence: "low" },
    { id: "tax", label: "Tax", kind: "money", tokens: ["tax"], confidence: "low" },
    { id: "total", label: "Total", kind: "money", tokens: ["total", "job total", "amount"], confidence: "medium" },
    ...SHARED_CUSTOMER,
    ...SHARED_PROPERTY,
    { id: "jobExternalId", label: "Related job source ID", kind: "id", tokens: [], confidence: "none" },
  ],
  ESTIMATES: [
    { id: "externalId", label: "Estimate source ID", kind: "id", tokens: ["estimate id", "quote id"], confidence: "high" },
    { id: "documentNumber", label: "Estimate number", kind: "id", tokens: ["estimate number", "quote number"], confidence: "high" },
    { id: "status", label: "Estimate status", kind: "text", tokens: ["status", "estimate status"], confidence: "high" },
    { id: "issueDate", label: "Created / issued date", kind: "date", tokens: ["created", "issue date", "sent date"], confidence: "medium" },
    { id: "dueDate", label: "Expiration date", kind: "date", tokens: ["expiration", "expires", "valid until"], confidence: "medium" },
    { id: "subtotal", label: "Subtotal", kind: "money", tokens: ["subtotal"], confidence: "medium" },
    { id: "tax", label: "Tax", kind: "money", tokens: ["tax"], confidence: "medium" },
    { id: "total", label: "Total", kind: "money", tokens: ["total", "estimate total"], confidence: "high" },
    { id: "notes", label: "Notes", kind: "text", tokens: ["notes", "comments"], confidence: "medium" },
    { id: "jobExternalId", label: "Related job source ID", kind: "id", tokens: ["job id", "job number"], confidence: "medium" },
    ...SHARED_CUSTOMER,
    ...SHARED_PROPERTY,
  ],
  INVOICES: [
    { id: "externalId", label: "Invoice source ID", kind: "id", tokens: ["invoice id"], confidence: "high" },
    { id: "documentNumber", label: "Invoice number", kind: "id", tokens: ["invoice number", "invoice #"], confidence: "high" },
    { id: "status", label: "Invoice status", kind: "text", tokens: ["status", "invoice status"], confidence: "high" },
    { id: "issueDate", label: "Issued date", kind: "date", tokens: ["issue date", "invoice date", "created"], confidence: "medium" },
    { id: "dueDate", label: "Due date", kind: "date", tokens: ["due date", "due"], confidence: "high" },
    { id: "subtotal", label: "Subtotal", kind: "money", tokens: ["subtotal"], confidence: "medium" },
    { id: "tax", label: "Tax", kind: "money", tokens: ["tax"], confidence: "medium" },
    { id: "total", label: "Total", kind: "money", tokens: ["total", "invoice total", "amount"], confidence: "high" },
    { id: "paidAmount", label: "Amount paid", kind: "money", tokens: ["paid", "amount paid", "payments"], confidence: "medium" },
    { id: "balance", label: "Balance", kind: "money", tokens: ["balance", "amount due"], confidence: "medium" },
    { id: "notes", label: "Notes", kind: "text", tokens: ["notes"], confidence: "medium" },
    { id: "jobExternalId", label: "Related job source ID", kind: "id", tokens: ["job id", "job number"], confidence: "medium" },
    ...SHARED_CUSTOMER,
    ...SHARED_PROPERTY,
  ],
  PAYMENTS: [
    { id: "externalId", label: "Payment source ID", kind: "id", tokens: ["payment id", "transaction id"], confidence: "high" },
    { id: "paymentAmount", label: "Amount", kind: "money", tokens: ["amount", "payment amount", "paid"], confidence: "high" },
    { id: "paymentDate", label: "Payment date", kind: "date", tokens: ["date", "payment date", "paid at"], confidence: "high" },
    { id: "paymentMethod", label: "Payment method", kind: "text", tokens: ["method", "payment method", "type"], confidence: "medium" },
    { id: "paymentReference", label: "Reference", kind: "text", tokens: ["reference", "check number", "ref"], confidence: "medium" },
    { id: "notes", label: "Notes", kind: "text", tokens: ["notes"], confidence: "low" },
    { id: "invoiceExternalId", label: "Invoice source ID or number", kind: "id", tokens: ["invoice id", "invoice number", "invoice"], confidence: "high" },
    ...SHARED_CUSTOMER,
  ],
  EQUIPMENT: [
    { id: "externalId", label: "Equipment source ID", kind: "id", tokens: ["equipment id", "asset id"], confidence: "high" },
    { id: "equipmentName", label: "Name", kind: "name", tokens: ["name", "equipment", "asset"], confidence: "high" },
    { id: "equipmentType", label: "Type", kind: "text", tokens: ["type", "equipment type", "category"], confidence: "medium" },
    { id: "manufacturer", label: "Manufacturer / brand", kind: "text", tokens: ["manufacturer", "brand", "make"], confidence: "high" },
    { id: "model", label: "Model", kind: "text", tokens: ["model"], confidence: "high" },
    { id: "serialNumber", label: "Serial number", kind: "id", tokens: ["serial", "serial number"], confidence: "high" },
    { id: "installDate", label: "Install date", kind: "date", tokens: ["install date", "installed"], confidence: "medium" },
    { id: "warrantyDate", label: "Warranty date", kind: "date", tokens: ["warranty", "warranty expires"], confidence: "medium" },
    { id: "notes", label: "Notes", kind: "text", tokens: ["notes"], confidence: "medium" },
    ...SHARED_CUSTOMER,
    ...SHARED_PROPERTY,
  ],
  EXPENSES: [
    { id: "externalId", label: "Expense source ID", kind: "id", tokens: ["expense id", "id"], confidence: "medium" },
    { id: "expenseDate", label: "Date", kind: "date", tokens: ["date", "expense date"], confidence: "high" },
    { id: "expenseVendor", label: "Vendor", kind: "name", tokens: ["vendor", "merchant", "payee"], confidence: "high" },
    { id: "expenseCategory", label: "Category", kind: "text", tokens: ["category", "type"], confidence: "medium" },
    { id: "expenseAmount", label: "Amount", kind: "money", tokens: ["amount", "total", "cost"], confidence: "high" },
    { id: "description", label: "Description", kind: "text", tokens: ["description", "memo", "notes"], confidence: "medium" },
    { id: "paymentMethod", label: "Payment method", kind: "text", tokens: ["payment method", "method"], confidence: "medium" },
    { id: "jobExternalId", label: "Related job source ID", kind: "id", tokens: ["job id", "job number"], confidence: "medium" },
    ...SHARED_CUSTOMER,
  ],
  NOTES: [
    { id: "notes", label: "Note", kind: "text", tokens: ["note", "notes", "comment", "body"], confidence: "high" },
    { id: "createdDate", label: "Original date", kind: "date", tokens: ["date", "created"], confidence: "medium" },
    { id: "technicianName", label: "Original author", kind: "name", tokens: ["author", "created by", "employee"], confidence: "medium" },
    { id: "jobExternalId", label: "Related job source ID", kind: "id", tokens: ["job id"], confidence: "medium" },
    ...SHARED_CUSTOMER,
  ],
  TAGS: [
    { id: "tags", label: "Tag", kind: "text", tokens: ["tag", "tags", "label"], confidence: "high" },
    ...SHARED_CUSTOMER,
  ],
  LEAD_SOURCES: [
    { id: "source", label: "Lead source", kind: "text", tokens: ["lead source", "source"], confidence: "high" },
    ...SHARED_CUSTOMER,
  ],
  CONTACTS: [],
  MEMBERSHIPS: [],
  PRICEBOOK: [],
  COMMUNICATIONS: [],
  OTHER: [],
};

export const RECORD_TYPE_HINTS: { type: ImportRecordTypeId; tokens: string[] }[] = [
  { type: "JOBS", tokens: ["job number", "job id", "work order", "scheduled", "technician", "job status", "job type"] },
  { type: "INVOICES", tokens: ["invoice number", "invoice id", "due date", "amount paid", "balance", "invoice total"] },
  { type: "ESTIMATES", tokens: ["estimate number", "quote number", "estimate total", "expiration"] },
  { type: "PAYMENTS", tokens: ["payment amount", "payment date", "payment method", "transaction id", "check number"] },
  { type: "EQUIPMENT", tokens: ["serial number", "manufacturer", "model", "install date", "warranty"] },
  { type: "EXPENSES", tokens: ["vendor", "expense", "category", "merchant"] },
  { type: "PROPERTIES", tokens: ["property id", "location id", "service address"] },
  { type: "CUSTOMERS", tokens: ["first name", "last name", "email", "customer id", "mobile number"] },
];

export function fieldsFor(type: ImportRecordTypeId): CatalogField[] {
  return ENTITY_FIELDS[type] ?? [];
}

export function fieldLabels(type: ImportRecordTypeId): Record<string, string> {
  return Object.fromEntries([["ignore", "Ignore this column"], ...fieldsFor(type).map((field) => [field.id, field.label])]);
}

export function isLiveImportType(type: string): type is ImportRecordTypeId {
  return LIVE_ENTITY_TYPES.includes(type as ImportRecordTypeId);
}

export function catalogAliases(type: ImportRecordTypeId): { target: TargetField; tokens: string[]; confidence: MappingConfidence }[] {
  return fieldsFor(type).map((field) => ({
    target: field.id as TargetField,
    tokens: field.tokens,
    confidence: field.confidence ?? "medium",
  }));
}
