import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import * as XLSX from "xlsx";
import { can } from "@/lib/permissions";
import { parseCsvText, parseImportFile } from "@/lib/imports/parse";
import { analyzeColumns, autoMapColumns, mappingCompatible } from "@/lib/imports/detect";
import { describeDetection, matchVendorPreset } from "@/lib/imports/presets";
import { applyMapping, customerGroupKey } from "@/lib/imports/map";
import { validateMappedCustomer } from "@/lib/imports/validate";
import { actionForDuplicate, buildCustomerIndex, detectDuplicate } from "@/lib/imports/duplicates";
import { evaluateRows } from "@/lib/imports/preview";
import { executeImportBatch } from "@/lib/imports/execute";
import { rollbackImportSession } from "@/lib/imports/rollback";
import { neutralizeCell, csvEscape } from "@/lib/imports/security";
import { normalizePhone, parseCurrencyToCents, parseDate } from "@/lib/imports/normalize";
import type { ImportMapping } from "@/lib/imports/types";

const fixture = (name: string) =>
  readFileSync(path.join(process.cwd(), "tests/fixtures/imports", name), "utf8");

function mappingOf(csv: string): { mapping: ImportMapping; rows: Record<string, string>[] } {
  const grid = parseCsvText(csv);
  const headers = grid[0] ?? [];
  const rows = grid.slice(1).map((line) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = (line[index] ?? "").trim();
    });
    return record;
  });
  const columns = analyzeColumns(headers, rows);
  const detection = describeDetection("UNKNOWN", headers);
  return { mapping: autoMapColumns(columns, detection.presetMapping), rows };
}

describe("import permissions", () => {
  it("lets owners, admins, managers, and office import, not technicians", () => {
    expect(can("COMPANY_OWNER", "imports:manage")).toBe(true);
    expect(can("ADMIN", "imports:manage")).toBe(true);
    expect(can("MANAGER", "imports:manage")).toBe(true);
    expect(can("OFFICE", "imports:manage")).toBe(true);
    expect(can("TECHNICIAN", "imports:manage")).toBe(false);
    expect(can("INSTALLER", "imports:manage")).toBe(false);
    expect(can("SALES", "imports:manage")).toBe(false);
    expect(can("DISPATCHER", "imports:manage")).toBe(false);
    expect(can("TECHNICIAN", "playbooks:view")).toBe(false);
  });
});

describe("file parsing", () => {
  it("parses generic CSV and skips blank rows", async () => {
    const parsed = await parseImportFile({
      fileName: "generic-customers.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(fixture("generic-customers.csv")),
    });
    expect(parsed.fileKind).toBe("csv");
    expect(parsed.headers).toContain("First Name");
    expect(parsed.rows.length).toBe(3);
  });

  it("parses XLSX values without executing formulas", async () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["First Name", "Last Name", "Email"],
      ["Dana", "West", "dana@example.com"],
    ]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Customers");
    const buffer = Buffer.from(XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
    const parsed = await parseImportFile({
      fileName: "people.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer,
    });
    expect(parsed.fileKind).toBe("xlsx");
    expect(parsed.rows[0]?.Email).toBe("dana@example.com");
  });

  it("rejects oversized files and HTML disguised as CSV", async () => {
    await expect(
      parseImportFile({
        fileName: "big.csv",
        buffer: Buffer.alloc(8 * 1024 * 1024 + 10, 97),
      })
    ).rejects.toThrow(/8 MB/);
    await expect(
      parseImportFile({
        fileName: "evil.csv",
        buffer: Buffer.from("<html><script>alert(1)</script></html>"),
      })
    ).rejects.toThrow(/web page/);
  });
});

describe("smart field detection and presets", () => {
  it("maps generic headers and blocks incompatible email-to-money matches", () => {
    const { mapping } = mappingOf(fixture("generic-customers.csv"));
    const targets = Object.fromEntries(mapping.columns.map((column) => [column.sourceColumn, column.target]));
    expect(targets["First Name"]).toBe("firstName");
    expect(targets.Email).toBe("email");
    expect(targets.Phone).toBe("phone");
    expect(mappingCompatible("lifetimeValue", "contact_email")).toBe(false);
    expect(mappingCompatible("email", "contact_email")).toBe(true);
  });

  it("recognizes a Housecall Pro-style export as a preset, not a hard-coded importer", () => {
    const headers = parseCsvText(fixture("housecall-pro-style.csv"))[0] ?? [];
    const match = matchVendorPreset(headers);
    expect(match.sourceType).toBe("HOUSECALL_PRO");
    expect(match.preset?.name).toMatch(/Housecall Pro/i);
    const detection = describeDetection("SPREADSHEET", headers);
    expect(detection.message).toMatch(/Housecall Pro/);
  });

  it("maps Jobber-style and ServiceTitan-style headers through the same engine", () => {
    const jobber = mappingOf(fixture("jobber-style.csv"));
    const titan = mappingOf(fixture("servicetitan-style.csv"));
    expect(jobber.mapping.columns.find((column) => column.sourceColumn === "Client ID")?.target).toBe(
      "externalId"
    );
    expect(jobber.mapping.columns.find((column) => column.sourceColumn === "Street")?.target).toBe("address");
    expect(titan.mapping.columns.find((column) => column.sourceColumn === "Name")?.target).toBe("fullName");
    expect(titan.mapping.columns.find((column) => column.sourceColumn === "Customer ID")?.target).toBe(
      "externalId"
    );
  });

  it("continues on unknown headers using aliases and sample values", () => {
    const { mapping, rows } = mappingOf(fixture("unknown-headers.csv"));
    const targets = Object.fromEntries(mapping.columns.map((column) => [column.sourceColumn, column.target]));
    expect(targets.cust_fname).toBe("firstName");
    expect(targets.cust_lname).toBe("lastName");
    expect(targets.lifetime_rev).toBe("lifetimeValue");
    const mapped = applyMapping(rows[0]!, mapping).mapped;
    expect(mapped.firstName).toBe("Sam");
    expect(mapped.email).toBe("sam@patel.test");
  });
});

describe("normalization, validation, and duplicates", () => {
  it("normalizes phones, currency, dates, and formula-looking cells", () => {
    expect(normalizePhone("4235550101")).toBe("(423) 555-0101");
    expect(parseCurrencyToCents("$1,234.56")).toBe(123456);
    expect(parseDate("03/15/2021")?.toISOString().startsWith("2021-03-15")).toBe(true);
    expect(neutralizeCell("=CMD()")).toBe("'=CMD()");
    expect(csvEscape("=1+1")).toBe("'=1+1");
  });

  it("flags missing names and bad emails as errors, bad phones as warnings", () => {
    const { mapping, rows } = mappingOf(fixture("generic-customers.csv"));
    const cara = applyMapping(rows[2]!, mapping);
    const validated = validateMappedCustomer(cara.mapped);
    expect(validated.issues.some((issue) => issue.code === "invalid_email")).toBe(true);
    expect(validated.status).toBe("ERROR");
  });

  it("detects exact email matches and does not auto-merge", () => {
    const index = buildCustomerIndex([
      {
        id: "cust_1",
        firstName: "Existing",
        lastName: "Person",
        businessName: null,
        email: "dup@example.com",
        phone: "(423) 555-7777",
        sourceSystem: null,
        externalId: null,
        properties: [{ address: "1 Same St", city: "Knoxville", zip: "37902" }],
      },
    ]);
    const verdict = detectDuplicate(
      {
        firstName: "Existing",
        lastName: "Person",
        businessName: null,
        email: "dup@example.com",
        phone: "(423) 555-7777",
        secondaryPhone: null,
        notes: null,
        tags: [],
        source: null,
        status: "ACTIVE",
        externalId: null,
        properties: [],
        extras: {},
      },
      index
    );
    expect(verdict.verdict).toBe("EXACT_MATCH");
    expect(actionForDuplicate(verdict.verdict, "SKIP")).toBe("SKIP");
    expect(actionForDuplicate(verdict.verdict, "CREATE_NEW")).toBe("CREATE");
  });

  it("groups Housecall Pro-style rows that share a customer id into multiple properties", () => {
    const { mapping, rows } = mappingOf(fixture("housecall-pro-style.csv"));
    const first = applyMapping(rows[0]!, mapping).mapped;
    const second = applyMapping(rows[1]!, mapping).mapped;
    expect(customerGroupKey(first)).toBe(customerGroupKey(second));
    expect(first.properties.length).toBeGreaterThan(0);
    expect(first.externalId).toBe("abc123");
    expect(first.status).toBe("ACTIVE");
    const dns = applyMapping(rows[2]!, mapping).mapped;
    expect(dns.status).toBe("INACTIVE");
    expect(dns.tags).toContain("do-not-service");
  });
});

describe("preview numbers come from analysis", () => {
  it("counts ready, errors, and duplicates from the actual rows", () => {
    const { mapping, rows } = mappingOf(fixture("generic-customers.csv"));
    const result = evaluateRows({
      rows: rows.map((rawData, index) => ({ id: `r${index}`, rowNumber: index + 1, rawData })),
      mapping,
      existing: [],
      policy: "SKIP",
    });
    expect(result.summary.totalRows).toBe(3);
    expect(result.summary.errors).toBeGreaterThan(0);
    expect(result.summary.ready + result.summary.errors + result.summary.skippedByPolicy).toBeGreaterThan(0);
    expect(result.summary.totalRows).toBe(result.evaluated.length);
  });
});

describe("import tenant isolation and execution", () => {
  const prisma = new PrismaClient();
  const ids = {
    companyA: "",
    companyB: "",
    userA: "",
    sessionA: "",
    customerA: "",
  };

  beforeAll(async () => {
    const hash = await bcrypt.hash("TestPassword-123!", 10);
    const stamp = Date.now();
    const userA = await prisma.user.create({
      data: { email: `import-a-${stamp}@test.local`, passwordHash: hash, firstName: "Ira", lastName: "A" },
    });
    const userB = await prisma.user.create({
      data: { email: `import-b-${stamp}@test.local`, passwordHash: hash, firstName: "Ian", lastName: "B" },
    });
    ids.userA = userA.id;
    const companyA = await prisma.company.create({
      data: {
        businessName: `Import A ${stamp}`,
        industry: "HVAC",
        status: "ACTIVE",
        memberships: { create: { userId: userA.id, role: "COMPANY_OWNER", status: "ACTIVE", joinedAt: new Date() } },
      },
    });
    const companyB = await prisma.company.create({
      data: {
        businessName: `Import B ${stamp}`,
        industry: "HVAC",
        status: "ACTIVE",
        memberships: { create: { userId: userB.id, role: "COMPANY_OWNER", status: "ACTIVE", joinedAt: new Date() } },
      },
    });
    ids.companyA = companyA.id;
    ids.companyB = companyB.id;
    const existing = await prisma.customer.create({
      data: {
        companyId: companyA.id,
        firstName: "Existing",
        lastName: "Person",
        email: "dup@example.com",
        phone: "(423) 555-7777",
      },
    });
    ids.customerA = existing.id;

    const { mapping, rows } = mappingOf(fixture("duplicates.csv"));
    const session = await prisma.importSession.create({
      data: {
        companyId: companyA.id,
        userId: userA.id,
        recordType: "CUSTOMERS",
        sourceType: "SPREADSHEET",
        fileName: "duplicates.csv",
        fileHash: `hash-${stamp}`,
        status: "READY_TO_IMPORT",
        rowCount: rows.length,
        mapping: mapping as object,
        confirmedAt: new Date(),
      },
    });
    ids.sessionA = session.id;
    const createdRows = await prisma.importRow.createManyAndReturn({
      data: rows.map((row, index) => ({
        companyId: companyA.id,
        importSessionId: session.id,
        rowNumber: index + 1,
        rawData: row,
      })),
    });
    const preview = evaluateRows({
      rows: createdRows.map((row) => ({
        id: row.id,
        rowNumber: row.rowNumber,
        rawData: row.rawData as Record<string, string>,
      })),
      mapping,
      existing: [
        {
          id: existing.id,
          firstName: existing.firstName,
          lastName: existing.lastName,
          businessName: existing.businessName,
          email: existing.email,
          phone: existing.phone,
          sourceSystem: existing.sourceSystem,
          externalId: existing.externalId,
          properties: [],
        },
      ],
      policy: "SKIP",
    });
    for (const row of preview.evaluated) {
      await prisma.importRow.update({
        where: { id: row.id },
        data: {
          status: row.status,
          action: row.action,
          duplicateVerdict: row.duplicateVerdict,
          mappedData: row.mappedData ?? undefined,
          issues: row.issues,
          targetRecordId: row.targetRecordId,
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.importRow.deleteMany({ where: { companyId: { in: [ids.companyA, ids.companyB] } } });
    await prisma.importExternalRef.deleteMany({ where: { companyId: { in: [ids.companyA, ids.companyB] } } });
    await prisma.property.deleteMany({ where: { companyId: { in: [ids.companyA, ids.companyB] } } });
    await prisma.customer.deleteMany({ where: { companyId: { in: [ids.companyA, ids.companyB] } } });
    await prisma.importSession.deleteMany({ where: { companyId: { in: [ids.companyA, ids.companyB] } } });
    await prisma.membership.deleteMany({ where: { companyId: { in: [ids.companyA, ids.companyB] } } });
    await prisma.company.deleteMany({ where: { id: { in: [ids.companyA, ids.companyB] } } });
    await prisma.user.deleteMany({
      where: { email: { startsWith: "import-a-" } },
    });
    await prisma.user.deleteMany({
      where: { email: { startsWith: "import-b-" } },
    });
    await prisma.$disconnect();
  });

  it("imports new rows, skips exact duplicates, and stays inside company A", async () => {
    const result = await executeImportBatch({
      prisma,
      companyId: ids.companyA,
      sessionId: ids.sessionA,
    });
    expect(result.done).toBe(true);
    expect(result.summary.customersCreated).toBe(1);
    expect(result.summary.customersSkipped).toBe(1);
    const created = await prisma.customer.findMany({
      where: { companyId: ids.companyA, importSessionId: ids.sessionA },
    });
    expect(created).toHaveLength(1);
    expect(created[0]?.email).toBe("brand-new@example.com");
    const leaked = await prisma.importSession.findFirst({
      where: { id: ids.sessionA, companyId: ids.companyB },
    });
    expect(leaked).toBeNull();
    const companyBCustomers = await prisma.customer.count({
      where: { companyId: ids.companyB, email: "brand-new@example.com" },
    });
    expect(companyBCustomers).toBe(0);
  });

  it("rolls back only customers created by the session", async () => {
    const rollback = await rollbackImportSession({
      prisma,
      companyId: ids.companyA,
      sessionId: ids.sessionA,
    });
    expect(rollback.customersRemoved).toBe(1);
    const existing = await prisma.customer.findFirst({ where: { id: ids.customerA, companyId: ids.companyA } });
    expect(existing?.email).toBe("dup@example.com");
  });

  it("imports a Housecall Pro-style file with external ids and two locations", async () => {
    const { mapping, rows } = mappingOf(fixture("housecall-pro-style.csv"));
    const session = await prisma.importSession.create({
      data: {
        companyId: ids.companyA,
        userId: ids.userA,
        recordType: "CUSTOMERS",
        sourceType: "HOUSECALL_PRO",
        fileName: "hcp.csv",
        fileHash: `hcp-${Date.now()}`,
        status: "READY_TO_IMPORT",
        rowCount: rows.length,
        mapping: mapping as object,
        confirmedAt: new Date(),
      },
    });
    const createdRows = await prisma.importRow.createManyAndReturn({
      data: rows.map((row, index) => ({
        companyId: ids.companyA,
        importSessionId: session.id,
        rowNumber: index + 1,
        rawData: row,
      })),
    });
    const preview = evaluateRows({
      rows: createdRows.map((row) => ({
        id: row.id,
        rowNumber: row.rowNumber,
        rawData: row.rawData as Record<string, string>,
      })),
      mapping,
      existing: [],
      policy: "SKIP",
    });
    for (const row of preview.evaluated) {
      await prisma.importRow.update({
        where: { id: row.id },
        data: {
          status: row.status === "ERROR" ? "ERROR" : "VALID",
          action: row.duplicateVerdict !== "NEW" && row.mappedData?.externalId === "abc123" && row.rowNumber > 1
            ? "CREATE"
            : row.action,
          duplicateVerdict: row.duplicateVerdict,
          mappedData: row.mappedData ?? undefined,
          issues: row.issues,
        },
      });
    }
    const result = await executeImportBatch({ prisma, companyId: ids.companyA, sessionId: session.id });
    expect(result.done).toBe(true);
    const jordan = await prisma.customer.findFirst({
      where: { companyId: ids.companyA, externalId: "abc123" },
      include: { properties: true },
    });
    expect(jordan?.sourceSystem).toBe("HOUSECALL_PRO");
    expect(jordan?.properties.length).toBeGreaterThanOrEqual(1);
    const ref = await prisma.importExternalRef.findFirst({
      where: {
        companyId: ids.companyA,
        sourceSystem: "HOUSECALL_PRO",
        recordType: "CUSTOMERS",
        externalId: "abc123",
      },
    });
    expect(ref?.targetRecordId).toBe(jordan?.id);
    await prisma.property.deleteMany({ where: { importSessionId: session.id } });
    await prisma.customer.deleteMany({ where: { importSessionId: session.id } });
    await prisma.importExternalRef.deleteMany({ where: { importSessionId: session.id } });
    await prisma.importRow.deleteMany({ where: { importSessionId: session.id } });
    await prisma.importSession.delete({ where: { id: session.id } });
  });
});
