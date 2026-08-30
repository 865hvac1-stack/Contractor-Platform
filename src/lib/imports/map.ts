import type {
  ColumnMapping,
  ImportMapping,
  MappedCustomer,
  PropertyDraft,
  RowIssue,
  TargetField,
} from "@/lib/imports/types";
import { mappingCompatible } from "@/lib/imports/detect";
import {
  formatCents,
  normalizeEmail,
  normalizePhone,
  normalizePostal,
  normalizeState,
  normalizeText,
  parseBoolean,
  parseCurrencyToCents,
  parseDate,
  splitFullName,
  splitTags,
} from "@/lib/imports/normalize";

function valueFor(row: Record<string, string>, mapping: ImportMapping, target: TargetField): string {
  const column = mapping.columns.find((entry) => entry.target === target);
  if (!column) return "";
  return normalizeText(row[column.sourceColumn] ?? "");
}

function valuesFor(row: Record<string, string>, mapping: ImportMapping, target: TargetField): string[] {
  return mapping.columns
    .filter((entry) => entry.target === target)
    .map((entry) => normalizeText(row[entry.sourceColumn] ?? ""))
    .filter(Boolean);
}

function appendNote(notes: string[], label: string, value: string) {
  if (value) notes.push(`${label}: ${value}`);
}

function propertyFrom(
  address: string,
  city: string,
  state: string,
  zip: string,
  name: string | undefined,
  isPrimary: boolean
): PropertyDraft | null {
  const line = [address, city, state, zip].map((part) => normalizeText(part)).filter(Boolean);
  if (line.length === 0) return null;
  const stateInfo = normalizeState(state);
  return {
    name,
    address: normalizeText(address) || "Address not provided",
    city: normalizeText(city) || "Unknown",
    state: stateInfo.state || "NA",
    zip: normalizePostal(zip) || "00000",
    isPrimary,
  };
}

export function applyMapping(row: Record<string, string>, mapping: ImportMapping): {
  mapped: MappedCustomer;
  issues: RowIssue[];
} {
  const issues: RowIssue[] = [];
  const notes: string[] = [];
  const tags = new Set<string>(splitTags(valueFor(row, mapping, "tags")));

  let firstName = valueFor(row, mapping, "firstName");
  let lastName = valueFor(row, mapping, "lastName");
  const fullName = valueFor(row, mapping, "fullName");
  if ((!firstName || !lastName) && fullName) {
    const split = splitFullName(fullName);
    firstName = firstName || split.firstName;
    lastName = lastName || split.lastName;
  }
  const businessName = valueFor(row, mapping, "businessName") || null;
  if (!firstName && !lastName && businessName) {
    firstName = businessName;
    lastName = "(Company)";
  }

  const email = normalizeEmail(valueFor(row, mapping, "email"));
  const phones = [...valuesFor(row, mapping, "phone"), ...valuesFor(row, mapping, "secondaryPhone")];
  const uniquePhones = [...new Set(phones.map((phone) => normalizePhone(phone)).filter(Boolean))] as string[];

  const statusRaw = valueFor(row, mapping, "status").toUpperCase();
  let status: MappedCustomer["status"] = "ACTIVE";
  if (["INACTIVE", "LEAD", "ARCHIVED", "ACTIVE"].includes(statusRaw)) {
    status = statusRaw as MappedCustomer["status"];
  } else if (statusRaw) {
    issues.push({
      level: "WARNING",
      code: "status_unrecognized",
      message: "We kept this customer active because the status value was not recognized.",
      field: "status",
    });
  }

  const doNotService = parseBoolean(valueFor(row, mapping, "doNotService"));
  if (doNotService) {
    status = "INACTIVE";
    tags.add("do-not-service");
  }
  const marketing = parseBoolean(valueFor(row, mapping, "marketingConsent"));
  if (marketing === true) tags.add("marketing-ok");
  if (marketing === false) tags.add("no-marketing");

  const customerType = valueFor(row, mapping, "customerType");
  if (customerType) tags.add(customerType.slice(0, 50));

  const extras: Record<string, string> = {};
  const lifetime = parseCurrencyToCents(valueFor(row, mapping, "lifetimeValue"));
  if (lifetime != null) {
    extras.lifetimeValue = formatCents(lifetime);
    appendNote(notes, "Lifetime value", extras.lifetimeValue);
  }
  for (const [target, label] of [
    ["createdDate", "Created"],
    ["lastServiceDate", "Last service"],
    ["customerSince", "Customer since"],
  ] as const) {
    const raw = valueFor(row, mapping, target);
    if (!raw) continue;
    const parsed = parseDate(raw);
    if (parsed) {
      extras[target] = parsed.toISOString().slice(0, 10);
      appendNote(notes, label, extras[target]);
    } else {
      issues.push({
        level: "WARNING",
        code: "bad_date",
        message: `We could not read the ${label.toLowerCase()} date, so it was left out.`,
        field: target,
      });
    }
  }

  const sourceNote = valueFor(row, mapping, "notes");
  if (sourceNote) notes.unshift(sourceNote);

  const service = propertyFrom(
    valueFor(row, mapping, "serviceAddress") || valueFor(row, mapping, "address"),
    valueFor(row, mapping, "serviceCity") || valueFor(row, mapping, "city"),
    valueFor(row, mapping, "serviceState") || valueFor(row, mapping, "state"),
    valueFor(row, mapping, "serviceZip") || valueFor(row, mapping, "zip"),
    valueFor(row, mapping, "propertyName") || "Service location",
    true
  );
  const billingAddress = valueFor(row, mapping, "billingAddress");
  const billing = propertyFrom(
    billingAddress,
    valueFor(row, mapping, "billingCity"),
    valueFor(row, mapping, "billingState"),
    valueFor(row, mapping, "billingZip"),
    "Billing address",
    !service
  );
  const properties = [service, billing].filter(Boolean) as PropertyDraft[];
  if (properties.length > 1 && service && billing) {
    const same =
      service.address === billing.address && service.city === billing.city && service.zip === billing.zip;
    if (same) properties.pop();
  }
  if (valueFor(row, mapping, "address2") && properties[0]) {
    properties[0] = {
      ...properties[0]!,
      address: `${properties[0]!.address}, ${valueFor(row, mapping, "address2")}`.slice(0, 300),
    };
  }

  const mapped: MappedCustomer = {
    firstName: firstName.slice(0, 100),
    lastName: lastName.slice(0, 100),
    businessName: businessName ? businessName.slice(0, 200) : null,
    email,
    phone: uniquePhones[0] ?? null,
    secondaryPhone: uniquePhones[1] ?? null,
    notes: notes.join("\n").slice(0, 5000) || null,
    tags: [...tags].slice(0, 20),
    source: valueFor(row, mapping, "source").slice(0, 100) || null,
    status,
    externalId: valueFor(row, mapping, "externalId").slice(0, 120) || null,
    properties,
    extras,
  };

  return { mapped, issues };
}

export function customerGroupKey(mapped: MappedCustomer): string {
  if (mapped.externalId) return `ext:${mapped.externalId.toLowerCase()}`;
  if (mapped.email) return `email:${mapped.email}`;
  if (mapped.phone && mapped.lastName) {
    return `phone:${mapped.phone}|${mapped.lastName.toLowerCase()}|${mapped.firstName.toLowerCase()}`;
  }
  return `row:${mapped.firstName}|${mapped.lastName}|${mapped.businessName ?? ""}|${mapped.phone ?? ""}`;
}

export function mappingFromForm(
  headers: string[],
  selected: Record<string, string>,
  previous?: ImportMapping | null
): ImportMapping {
  return {
    columns: headers.map((header) => {
      const target = (selected[header] as TargetField | undefined) ?? "ignore";
      const prior = previous?.columns.find((column) => column.sourceColumn === header);
      return {
        sourceColumn: header,
        target,
        confidence: prior?.confidence ?? "none",
        suggestedBy: "user" as const,
      };
    }),
  };
}

export function incompatibleMappings(
  mapping: ImportMapping,
  kinds: Record<string, import("@/lib/imports/types").FieldKind>
): string[] {
  return mapping.columns.flatMap((column) => {
    const kind = kinds[column.sourceColumn];
    if (!kind) return [];
    return mappingCompatible(column.target, kind)
      ? []
      : [`“${column.sourceColumn}” does not look like that ContractorYou field.`];
  });
}

export function unmappedCount(mapping: ImportMapping): number {
  return mapping.columns.filter((column) => column.target === "ignore").length;
}

export function hasIdentityMapping(mapping: ImportMapping): boolean {
  const targets = new Set(mapping.columns.map((column) => column.target));
  return (
    targets.has("firstName") ||
    targets.has("lastName") ||
    targets.has("fullName") ||
    targets.has("businessName")
  );
}

export function columnMap(mapping: ImportMapping): ColumnMapping[] {
  return mapping.columns;
}
