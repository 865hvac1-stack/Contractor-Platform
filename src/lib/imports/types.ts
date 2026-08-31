export const IMPORT_RECORD_TYPES = [
  "CUSTOMERS",
  "PROPERTIES",
  "CONTACTS",
  "JOBS",
  "ESTIMATES",
  "INVOICES",
  "PAYMENTS",
  "EQUIPMENT",
  "MEMBERSHIPS",
  "NOTES",
  "TAGS",
  "LEAD_SOURCES",
  "EXPENSES",
  "PRICEBOOK",
  "COMMUNICATIONS",
  "OTHER",
] as const;

export type ImportRecordTypeId = (typeof IMPORT_RECORD_TYPES)[number];

export const LIVE_IMPORT_RECORD_TYPES: ImportRecordTypeId[] = [
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

export const IMPORT_SOURCE_TYPES = [
  "HOUSECALL_PRO",
  "SERVICETITAN",
  "JOBBER",
  "FIELDEDGE",
  "SERVICE_FUSION",
  "WORKIZ",
  "QUICKBOOKS",
  "HUBSPOT",
  "SALESFORCE",
  "SPREADSHEET",
  "OTHER",
  "UNKNOWN",
] as const;

export type ImportSourceTypeId = (typeof IMPORT_SOURCE_TYPES)[number];

export const TARGET_FIELDS = [
  "ignore",
  "firstName",
  "lastName",
  "fullName",
  "businessName",
  "email",
  "phone",
  "secondaryPhone",
  "notes",
  "tags",
  "source",
  "status",
  "externalId",
  "doNotService",
  "marketingConsent",
  "lifetimeValue",
  "createdDate",
  "lastServiceDate",
  "customerSince",
  "customerType",
  "propertyName",
  "address",
  "address2",
  "city",
  "state",
  "zip",
  "country",
  "billingAddress",
  "billingCity",
  "billingState",
  "billingZip",
  "serviceAddress",
  "serviceCity",
  "serviceState",
  "serviceZip",
  "customerExternalId",
  "customerEmail",
  "customerPhone",
  "customerName",
  "propertyExternalId",
  "jobNumber",
  "jobType",
  "description",
  "scheduledStart",
  "completedAt",
  "technicianName",
  "subtotal",
  "tax",
  "total",
  "documentNumber",
  "issueDate",
  "dueDate",
  "paidAmount",
  "balance",
  "paymentAmount",
  "paymentDate",
  "paymentMethod",
  "paymentReference",
  "invoiceExternalId",
  "jobExternalId",
  "equipmentName",
  "equipmentType",
  "manufacturer",
  "model",
  "serialNumber",
  "installDate",
  "warrantyDate",
  "expenseDate",
  "expenseVendor",
  "expenseCategory",
  "expenseAmount",
] as const;

export type TargetField = (typeof TARGET_FIELDS)[number];

export type FieldKind =
  | "ignore"
  | "name"
  | "contact_email"
  | "contact_phone"
  | "text"
  | "id"
  | "bool"
  | "money"
  | "date"
  | "address";

export type MappingConfidence = "high" | "medium" | "low" | "none";

export type ColumnMapping = {
  sourceColumn: string;
  target: TargetField;
  confidence: MappingConfidence;
  suggestedBy: "rule" | "preset" | "ai" | "user";
};

export type ImportMapping = {
  columns: ColumnMapping[];
};

export type SampleColumn = {
  header: string;
  normalizedHeader: string;
  samples: string[];
  blankCount: number;
  uniqueCount: number;
  inferredKind: FieldKind;
};

export type FileAnalysis = {
  headers: string[];
  duplicateHeaders: string[];
  blankHeaders: string[];
  rowCount: number;
  encoding: string;
  fileKind: "csv" | "xlsx" | "xls";
  columns: SampleColumn[];
  detectedSource: ImportSourceTypeId;
  detectedSourceLabel: string;
  detectedSourceConfidence: MappingConfidence;
  presetName: string | null;
  message: string;
};

export type RowIssue = {
  level: "WARNING" | "ERROR";
  code: string;
  message: string;
  field?: string;
};

export type PropertyDraft = {
  name?: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  isPrimary: boolean;
};

export type MappedCustomer = {
  firstName: string;
  lastName: string;
  businessName: string | null;
  email: string | null;
  phone: string | null;
  secondaryPhone: string | null;
  notes: string | null;
  tags: string[];
  source: string | null;
  status: "ACTIVE" | "INACTIVE" | "LEAD" | "ARCHIVED";
  externalId: string | null;
  properties: PropertyDraft[];
  extras: Record<string, string>;
};

export type DuplicateMatch = {
  customerId: string;
  reason: string;
};

export type ExistingCustomerIndex = {
  byExternalId: Map<string, { id: string; sourceSystem: string | null }>;
  byEmail: Map<string, string>;
  byPhone: Map<string, string>;
  byName: Map<string, string[]>;
  byAddress: Map<string, string>;
};

export type RowAccounting = {
  sourceRows: number;
  created: number;
  updated: number;
  merged: number;
  duplicates: number;
  skipped: number;
  warningImported: number;
  errors: number;
  other: number;
};

export type PreviewSummary = {
  totalRows: number;
  ready: number;
  warnings: number;
  errors: number;
  duplicates: number;
  newCustomers: number;
  existingCustomers: number;
  properties: number;
  tags: number;
  skippedByPolicy: number;
  unmatchedCustomers?: number;
  unmatchedProperties?: number;
  unmatchedRelations?: number;
  unknownTechnicians?: number;
  accounting?: RowAccounting;
};

export type ImportSummary = {
  customersCreated: number;
  customersUpdated: number;
  customersSkipped: number;
  propertiesCreated: number;
  recordsCreated?: number;
  duplicates: number;
  warnings: number;
  errors: number;
  failed: number;
  accounting?: RowAccounting;
};

export type DuplicatePolicy = "SKIP" | "CREATE_NEW" | "UPDATE_EXACT";

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 25000;
export const MAX_COLUMNS = 200;
export const SAMPLE_SIZE = 8;
export const IMPORT_BATCH_SIZE = 100;

export const SOURCE_LABELS: Record<ImportSourceTypeId, string> = {
  HOUSECALL_PRO: "Housecall Pro",
  SERVICETITAN: "ServiceTitan",
  JOBBER: "Jobber",
  FIELDEDGE: "FieldEdge",
  SERVICE_FUSION: "Service Fusion",
  WORKIZ: "Workiz",
  QUICKBOOKS: "QuickBooks",
  HUBSPOT: "HubSpot",
  SALESFORCE: "Salesforce",
  SPREADSHEET: "Spreadsheet / CSV",
  OTHER: "Other",
  UNKNOWN: "Unknown",
};

export const RECORD_TYPE_LABELS: Record<ImportRecordTypeId, string> = {
  CUSTOMERS: "Customers",
  PROPERTIES: "Properties / service locations",
  CONTACTS: "Contacts",
  JOBS: "Jobs",
  ESTIMATES: "Estimates",
  INVOICES: "Invoices",
  PAYMENTS: "Payments",
  EQUIPMENT: "Equipment / assets",
  MEMBERSHIPS: "Memberships",
  NOTES: "Notes",
  TAGS: "Tags",
  LEAD_SOURCES: "Lead sources",
  EXPENSES: "Expenses",
  PRICEBOOK: "Pricebook items",
  COMMUNICATIONS: "Communications",
  OTHER: "Other",
};

export const TARGET_FIELD_LABELS: Record<TargetField, string> = {
  ignore: "Ignore this column",
  firstName: "First name",
  lastName: "Last name",
  fullName: "Full name",
  businessName: "Company name",
  email: "Email",
  phone: "Phone",
  secondaryPhone: "Mobile / alternate phone",
  notes: "Notes",
  tags: "Tags",
  source: "Lead source",
  status: "Customer status",
  externalId: "External customer ID",
  doNotService: "Do not service",
  marketingConsent: "Marketing consent",
  lifetimeValue: "Lifetime value",
  createdDate: "Created date",
  lastServiceDate: "Last service date",
  customerSince: "Customer since",
  customerType: "Customer type",
  propertyName: "Property name",
  address: "Address line 1",
  address2: "Address line 2",
  city: "City",
  state: "State",
  zip: "Postal code",
  country: "Country",
  billingAddress: "Billing address",
  billingCity: "Billing city",
  billingState: "Billing state",
  billingZip: "Billing postal code",
  serviceAddress: "Service address",
  serviceCity: "Service city",
  serviceState: "Service state",
  serviceZip: "Service postal code",
  customerExternalId: "Customer’s source ID",
  customerEmail: "Customer email",
  customerPhone: "Customer phone",
  customerName: "Customer name",
  propertyExternalId: "Property source ID",
  jobNumber: "Job number",
  jobType: "Job type",
  description: "Description",
  scheduledStart: "Scheduled start",
  completedAt: "Completed date",
  technicianName: "Technician / employee name",
  subtotal: "Subtotal",
  tax: "Tax",
  total: "Total",
  documentNumber: "Document number",
  issueDate: "Issued date",
  dueDate: "Due / expiration date",
  paidAmount: "Amount paid",
  balance: "Balance",
  paymentAmount: "Payment amount",
  paymentDate: "Payment date",
  paymentMethod: "Payment method",
  paymentReference: "Payment reference",
  invoiceExternalId: "Invoice source ID or number",
  jobExternalId: "Related job source ID",
  equipmentName: "Equipment name",
  equipmentType: "Equipment type",
  manufacturer: "Manufacturer / brand",
  model: "Model",
  serialNumber: "Serial number",
  installDate: "Install date",
  warrantyDate: "Warranty date",
  expenseDate: "Expense date",
  expenseVendor: "Vendor",
  expenseCategory: "Expense category",
  expenseAmount: "Expense amount",
};

export const FIELD_KIND: Record<TargetField, FieldKind> = {
  ignore: "ignore",
  firstName: "name",
  lastName: "name",
  fullName: "name",
  businessName: "name",
  email: "contact_email",
  phone: "contact_phone",
  secondaryPhone: "contact_phone",
  notes: "text",
  tags: "text",
  source: "text",
  status: "text",
  externalId: "id",
  doNotService: "bool",
  marketingConsent: "bool",
  lifetimeValue: "money",
  createdDate: "date",
  lastServiceDate: "date",
  customerSince: "date",
  customerType: "text",
  propertyName: "name",
  address: "address",
  address2: "address",
  city: "address",
  state: "address",
  zip: "address",
  country: "address",
  billingAddress: "address",
  billingCity: "address",
  billingState: "address",
  billingZip: "address",
  serviceAddress: "address",
  serviceCity: "address",
  serviceState: "address",
  serviceZip: "address",
  customerExternalId: "id",
  customerEmail: "contact_email",
  customerPhone: "contact_phone",
  customerName: "name",
  propertyExternalId: "id",
  jobNumber: "id",
  jobType: "text",
  description: "text",
  scheduledStart: "date",
  completedAt: "date",
  technicianName: "name",
  subtotal: "money",
  tax: "money",
  total: "money",
  documentNumber: "id",
  issueDate: "date",
  dueDate: "date",
  paidAmount: "money",
  balance: "money",
  paymentAmount: "money",
  paymentDate: "date",
  paymentMethod: "text",
  paymentReference: "text",
  invoiceExternalId: "id",
  jobExternalId: "id",
  equipmentName: "name",
  equipmentType: "text",
  manufacturer: "text",
  model: "text",
  serialNumber: "id",
  installDate: "date",
  warrantyDate: "date",
  expenseDate: "date",
  expenseVendor: "name",
  expenseCategory: "text",
  expenseAmount: "money",
};
