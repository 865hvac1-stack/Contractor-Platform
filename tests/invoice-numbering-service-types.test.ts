import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  formatDocumentNumber,
  nextNumber,
  parseDocumentSerial,
  updateInvoiceSequenceSettings,
} from "@/lib/sequences";
import { ensureCompanyServiceTypes, listActiveServiceTypes } from "@/lib/trades/service-types";
import { HVAC_SERVICE_TYPE_STARTERS, serviceTypeStartersForTrade } from "@/lib/trades/templates";

const prisma = new PrismaClient();

describe("invoice numbering and service types", () => {
  const ids = {
    companyA: "",
    companyB: "",
    customerA: "",
    customerB: "",
    existingInvoice: "",
    playbookA: "",
  };

  beforeAll(async () => {
    const stamp = Date.now();
    const companyA = await prisma.company.create({
      data: { businessName: `Seq A ${stamp}`, industry: "HVAC", status: "ACTIVE" },
    });
    const companyB = await prisma.company.create({
      data: { businessName: `Seq B ${stamp}`, industry: "PLUMBING", status: "ACTIVE" },
    });
    const customerA = await prisma.customer.create({
      data: { companyId: companyA.id, firstName: "Ann", lastName: "Invoice" },
    });
    const customerB = await prisma.customer.create({
      data: { companyId: companyB.id, firstName: "Bea", lastName: "Other" },
    });
    const playbook = await prisma.playbook.create({
      data: {
        companyId: companyA.id,
        name: "Residential Service",
        status: "ACTIVE",
      },
    });
    ids.companyA = companyA.id;
    ids.companyB = companyB.id;
    ids.customerA = customerA.id;
    ids.customerB = customerB.id;
    ids.playbookA = playbook.id;
  });

  afterAll(async () => {
    const companies = [ids.companyA, ids.companyB].filter(Boolean);
    await prisma.invoice.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.serviceType.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.playbook.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.numberSequence.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.customer.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.company.deleteMany({ where: { id: { in: companies } } });
    await prisma.$disconnect();
  });

  it("A/B. first invoice is INV-00001 and second is INV-00002", async () => {
    const first = await nextNumber(ids.companyA, "INVOICE", "INV");
    const second = await nextNumber(ids.companyA, "INVOICE", "INV");
    expect(first).toBe("INV-00001");
    expect(second).toBe("INV-00002");
  });

  it("C/F. existing INV-00002 causes next to become INV-00003 and does not renumber", async () => {
    const company = await prisma.company.create({
      data: { businessName: `Existing ${Date.now()}`, industry: "HVAC", status: "ACTIVE" },
    });
    const customer = await prisma.customer.create({
      data: { companyId: company.id, firstName: "Pat", lastName: "Exist" },
    });
    const kept = await prisma.invoice.create({
      data: {
        companyId: company.id,
        customerId: customer.id,
        invoiceNumber: "INV-00002",
        status: "SENT",
        totalCents: 1000,
        balanceCents: 1000,
      },
    });
    const next = await nextNumber(company.id, "INVOICE", "INV");
    expect(next).toBe("INV-00003");
    const unchanged = await prisma.invoice.findUnique({ where: { id: kept.id } });
    expect(unchanged?.invoiceNumber).toBe("INV-00002");
    await prisma.invoice.deleteMany({ where: { companyId: company.id } });
    await prisma.numberSequence.deleteMany({ where: { companyId: company.id } });
    await prisma.customer.deleteMany({ where: { companyId: company.id } });
    await prisma.company.delete({ where: { id: company.id } });
  });

  it("D. concurrent allocation cannot produce duplicate invoice numbers", async () => {
    const company = await prisma.company.create({
      data: { businessName: `Race ${Date.now()}`, industry: "HVAC", status: "ACTIVE" },
    });
    const numbers = await Promise.all(
      Array.from({ length: 12 }, () => nextNumber(company.id, "INVOICE", "INV"))
    );
    expect(new Set(numbers).size).toBe(12);
    expect(numbers).toContain("INV-00001");
    expect(numbers).toContain("INV-00012");
    await prisma.numberSequence.deleteMany({ where: { companyId: company.id } });
    await prisma.company.delete({ where: { id: company.id } });
  });

  it("E. Company A and Company B keep independent sequences", async () => {
    const a = await nextNumber(ids.companyA, "INVOICE", "INV");
    const b1 = await nextNumber(ids.companyB, "INVOICE", "INV");
    const b2 = await nextNumber(ids.companyB, "INVOICE", "INV");
    expect(b1).toBe("INV-00001");
    expect(b2).toBe("INV-00002");
    expect(a).not.toBe(b1);
    expect(parseDocumentSerial(a, "INV")).toBeGreaterThan(2);
  });

  it("G. custom invoice prefix works", async () => {
    const company = await prisma.company.create({
      data: { businessName: `Prefix ${Date.now()}`, industry: "OTHER", status: "ACTIVE" },
    });
    const saved = await updateInvoiceSequenceSettings({
      companyId: company.id,
      prefix: "CY",
      nextValue: 1001,
      padding: 5,
    });
    expect(saved.ok).toBe(true);
    expect(await nextNumber(company.id, "INVOICE")).toBe("CY-01001");
    const customer = await prisma.customer.create({
      data: { companyId: company.id, firstName: "Cy", lastName: "Prefix" },
    });
    await prisma.invoice.create({
      data: {
        companyId: company.id,
        customerId: customer.id,
        invoiceNumber: "CY-01001",
        status: "DRAFT",
        totalCents: 0,
        balanceCents: 0,
      },
    });
    const blocked = await updateInvoiceSequenceSettings({
      companyId: company.id,
      prefix: "CY",
      nextValue: 1,
    });
    expect(blocked.ok).toBe(false);
    await prisma.invoice.deleteMany({ where: { companyId: company.id } });
    await prisma.customer.deleteMany({ where: { companyId: company.id } });
    await prisma.numberSequence.deleteMany({ where: { companyId: company.id } });
    await prisma.company.delete({ where: { id: company.id } });
  });

  it("O. HVAC starter template seeds the full service catalog", async () => {
    const result = await ensureCompanyServiceTypes(prisma, ids.companyA, "HVAC");
    expect(result.skipped).toBe(false);
    expect(result.created).toBe(HVAC_SERVICE_TYPE_STARTERS.length);
    const types = await listActiveServiceTypes(prisma, ids.companyA);
    expect(types.map((type) => type.name)).toEqual(HVAC_SERVICE_TYPE_STARTERS.map((type) => type.name));
    expect(types.find((type) => type.key === "residential_service_call")?.playbookId).toBe(ids.playbookA);
  });

  it("P. existing company does not get destructive duplicate seeds", async () => {
    const again = await ensureCompanyServiceTypes(prisma, ids.companyA, "HVAC");
    expect(again.skipped).toBe(true);
    expect(again.created).toBe(0);
    const count = await prisma.serviceType.count({ where: { companyId: ids.companyA } });
    expect(count).toBe(HVAC_SERVICE_TYPE_STARTERS.length);
  });

  it("H/I/J. service types are tenant scoped, editable, and deactivating does not break history", async () => {
    const type = await prisma.serviceType.findFirst({
      where: { companyId: ids.companyA, key: "residential_service_call" },
    });
    expect(type).toBeTruthy();
    await prisma.serviceType.update({
      where: { id: type!.id },
      data: { name: "Resi Service", active: false },
    });
    const invoice = await prisma.invoice.create({
      data: {
        companyId: ids.companyA,
        customerId: ids.customerA,
        invoiceNumber: await nextNumber(ids.companyA, "INVOICE"),
        status: "DRAFT",
        notes: "Edited description",
        serviceTypeId: type!.id,
        totalCents: 0,
        balanceCents: 0,
      },
    });
    expect(invoice.serviceTypeId).toBe(type!.id);
    expect(invoice.notes).toBe("Edited description");
    const active = await listActiveServiceTypes(prisma, ids.companyA);
    expect(active.find((row) => row.id === type!.id)).toBeUndefined();
    const stillLinked = await prisma.invoice.findUnique({ where: { id: invoice.id } });
    expect(stillLinked?.serviceTypeId).toBe(type!.id);
  });

  it("K/L/M/N. invoice can select a service type, keep a custom description, and use Other/Custom", async () => {
    await ensureCompanyServiceTypes(prisma, ids.companyB, "PLUMBING");
    const custom = await prisma.serviceType.findFirst({
      where: { companyId: ids.companyB, key: "other_custom" },
    });
    expect(custom?.name).toBe("Other / Custom");
    const invoice = await prisma.invoice.create({
      data: {
        companyId: ids.companyB,
        customerId: ids.customerB,
        invoiceNumber: await nextNumber(ids.companyB, "INVOICE"),
        status: "DRAFT",
        notes: "Manual override after picking Other / Custom",
        serviceTypeId: custom!.id,
        totalCents: 2500,
        balanceCents: 2500,
      },
    });
    expect(invoice.notes).toBe("Manual override after picking Other / Custom");
    expect(invoice.serviceTypeId).toBe(custom!.id);
  });

  it("Q. Company A cannot use Company B service types", async () => {
    const typeB = await prisma.serviceType.findFirst({ where: { companyId: ids.companyB } });
    const leaked = await prisma.serviceType.findFirst({
      where: { id: typeB!.id, companyId: ids.companyA },
    });
    expect(leaked).toBeNull();
    const aTypes = await listActiveServiceTypes(prisma, ids.companyA);
    expect(aTypes.every((type) => type.id !== typeB!.id)).toBe(true);
  });

  it("generic fallback starters are used for non-HVAC trades", () => {
    expect(serviceTypeStartersForTrade("PLUMBING").some((row) => row.key === "service_call")).toBe(true);
    expect(serviceTypeStartersForTrade("HVAC")).toHaveLength(14);
    expect(formatDocumentNumber("INV", 3, 5)).toBe("INV-00003");
  });
});
