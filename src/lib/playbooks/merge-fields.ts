const ALLOWED = [
  "customer.firstName",
  "customer.lastName",
  "customer.fullName",
  "company.name",
  "company.phone",
  "technician.firstName",
  "technician.fullName",
  "job.date",
  "job.time",
  "job.arrivalWindow",
  "property.address",
  "estimate.number",
  "invoice.number",
  "invoice.balance",
] as const;

export type MergeContext = Partial<Record<(typeof ALLOWED)[number], string>>;

const TOKEN = /\{\{\s*([a-zA-Z0-9.]+)\s*\}\}/g;

export const MERGE_FIELD_HELP = ALLOWED.map((key) => `{{${key}}}`);

export const PREVIEW_SAMPLE: MergeContext = {
  "customer.firstName": "Alex",
  "customer.lastName": "Rivera",
  "customer.fullName": "Alex Rivera",
  "company.name": "865 HVAC",
  "company.phone": "(865) 555-0100",
  "technician.firstName": "Jordan",
  "technician.fullName": "Jordan Hale",
  "job.date": "Tue, Sep 2",
  "job.time": "10:30 AM",
  "job.arrivalWindow": "10:30–11:30 AM",
  "property.address": "123 Main Street",
  "estimate.number": "EST-1042",
  "invoice.number": "INV-2201",
  "invoice.balance": "$240.00",
};

/** Safe merge only. Unknown tokens stay visible. No code execution. */
export function renderMergeFields(body: string, context: MergeContext) {
  return body.replace(TOKEN, (full, key: string) => {
    if (!(ALLOWED as readonly string[]).includes(key)) return full;
    return context[key as keyof MergeContext] ?? full;
  });
}

export function listUnknownFields(body: string) {
  const unknown: string[] = [];
  for (const match of body.matchAll(TOKEN)) {
    const key = match[1] ?? "";
    if (!(ALLOWED as readonly string[]).includes(key)) unknown.push(key);
  }
  return unknown;
}
