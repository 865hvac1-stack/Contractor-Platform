import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { getOfficeHubData } from "@/lib/office/hub";
import { buildOfficeAttentionCategories } from "@/lib/office/attention-categories";
import { buildOfficeIntelligence } from "@/lib/office/intelligence";
import { buildOfficePipeline } from "@/lib/office/pipeline";
import { customerSearchWhere } from "@/lib/customers/search";
import { prioritizeAttention } from "@/lib/attention-priority";
import { getNeedsAttention } from "@/lib/attention";
import { canAccessWorkspace } from "@/lib/workspaces";
import { can } from "@/lib/permissions";
import { SUMMIT_COMPANY_NAME } from "@/lib/demo/constants";

const prisma = new PrismaClient();

describe("Customer Hub V2", () => {
  const ids = {
    companyA: "",
    companyB: "",
    customerA: "",
    propertyA: "",
    estimateA: "",
    invoiceA: "",
    leadA: "",
    hvacId: "",
  };
  let hvacBefore: { customers: number; jobs: number; estimates: number; invoices: number } | null = null;

  beforeAll(async () => {
    const hvac = await prisma.company.findFirst({
      where: { businessName: "865 HVAC", isDemo: false },
      select: {
        id: true,
        _count: { select: { customers: true, jobs: true, estimates: true, invoices: true } },
      },
    });
    if (hvac) {
      ids.hvacId = hvac.id;
      hvacBefore = {
        customers: hvac._count.customers,
        jobs: hvac._count.jobs,
        estimates: hvac._count.estimates,
        invoices: hvac._count.invoices,
      };
    }

    const stamp = Date.now();
    const a = await prisma.company.create({ data: { businessName: `Office Hub A ${stamp}`, status: "ACTIVE" } });
    const b = await prisma.company.create({ data: { businessName: `Office Hub B ${stamp}`, status: "ACTIVE" } });
    ids.companyA = a.id;
    ids.companyB = b.id;

    const customer = await prisma.customer.create({
      data: {
        companyId: a.id,
        firstName: "John",
        lastName: "Smith",
        phone: "(865) 555-0192",
        email: "john@example.com",
      },
    });
    ids.customerA = customer.id;

    const property = await prisma.property.create({
      data: {
        companyId: a.id,
        customerId: customer.id,
        address: "123 Main Street",
        city: "Knoxville",
        state: "TN",
        zip: "37918",
        isPrimary: true,
      },
    });
    ids.propertyA = property.id;

    const estimate = await prisma.estimate.create({
      data: {
        companyId: a.id,
        customerId: customer.id,
        estimateNumber: `EST-HUB-${stamp}`,
        status: "SENT",
        totalCents: 1_280_000,
        issueDate: new Date(Date.now() - 4 * 86_400_000),
      },
    });
    ids.estimateA = estimate.id;

    const invoice = await prisma.invoice.create({
      data: {
        companyId: a.id,
        customerId: customer.id,
        invoiceNumber: `INV-HUB-${stamp}`,
        status: "OVERDUE",
        totalCents: 167_090,
        balanceCents: 167_090,
        amountPaidCents: 0,
        dueDate: new Date(Date.now() - 10 * 86_400_000),
      },
    });
    ids.invoiceA = invoice.id;

    const lead = await prisma.lead.create({
      data: {
        companyId: a.id,
        firstName: "Amy",
        lastName: "Lead",
        status: "NEW",
        source: "PHONE",
      },
    });
    ids.leadA = lead.id;
  });

  afterAll(async () => {
    if (ids.companyA) await prisma.company.delete({ where: { id: ids.companyA } }).catch(() => undefined);
    if (ids.companyB) await prisma.company.delete({ where: { id: ids.companyB } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("loads verified office hub metrics for a tenant", async () => {
    const data = await getOfficeHubData(ids.companyA);
    expect(data.scorecards.some((card) => card.label === "Follow-ups due")).toBe(true);
    expect(data.scorecards.some((card) => card.label === "Overdue A/R")).toBe(true);
    expect(data.scorecards.find((card) => card.label === "Overdue A/R")?.value).toMatch(/\$/);
    expect(data.attentionCategories.length).toBeGreaterThan(0);
    expect(data.recentCustomers.some((row) => row.id === ids.customerA)).toBe(true);
  });

  it("keeps office hub data tenant-isolated", async () => {
    const [a, b] = await Promise.all([getOfficeHubData(ids.companyA), getOfficeHubData(ids.companyB)]);
    expect(a.scorecards.length).toBeGreaterThan(0);
    expect(b.scorecards.every((card) => card.value === "0" || card.value === "$0")).toBe(true);
    expect(a.attentionCategories.length).toBeGreaterThan(0);
    expect(b.attentionCategories.length).toBe(0);
    expect(b.recentCustomers.some((row) => row.id === ids.customerA)).toBe(false);
  });

  it("links scorecards to filtered destinations", async () => {
    const data = await getOfficeHubData(ids.companyA);
    const overdue = data.scorecards.find((card) => card.label === "Overdue A/R");
    const followUp = data.scorecards.find((card) => card.label === "Follow-ups due");
    expect(overdue?.href).toBe("/invoices?status=overdue");
    expect(followUp?.href).toBe("/attention?filter=follow_ups");
    for (const card of data.scorecards) {
      expect(card.href.startsWith("/")).toBe(true);
    }
  });

  it("summarizes attention categories with money impact and destinations", async () => {
    const ranked = prioritizeAttention(await getNeedsAttention(ids.companyA));
    const categories = buildOfficeAttentionCategories(ranked);
    expect(categories.some((item) => item.id === "estimate_follow_up")).toBe(true);
    expect(categories.some((item) => item.id === "overdue_invoices")).toBe(true);
    for (const category of categories) {
      expect(category.href.startsWith("/")).toBe(true);
      expect(category.count).toBeGreaterThan(0);
    }
  });

  it("builds pipeline stages only when data exists", () => {
    const stages = buildOfficePipeline({
      newLeads: 10,
      contactedLeads: 0,
      bookedLeads: 0,
      estimateFollowUp: 9,
      approvedNotScheduled: 0,
      paymentFollowUp: 7,
    });
    expect(stages.map((stage) => stage.id)).toEqual(["new_leads", "estimate_follow_up", "payment_follow_up"]);
    expect(stages[0]?.href).toBe("/marketing/leads?status=NEW");
    expect(stages[2]?.href).toBe("/invoices?status=overdue");
  });

  it("builds front office intelligence from verified counts only", () => {
    const rows = buildOfficeIntelligence({
      followUpCount: 9,
      followUpValueCents: 2_761_300,
      approvedNotScheduled: 4,
      approvedValueCents: 1_842_000,
      overdueBalanceCents: 1_670_900,
      overdueCount: 7,
      unansweredLeads: 10,
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.href.startsWith("/"))).toBe(true);
    expect(rows.every((row) => row.summary.includes("$") || row.summary.match(/\d/))).toBe(true);
  });

  it("finds customers by property address in search", () => {
    const where = customerSearchWhere(ids.companyA, "123 Main Street");
    expect(JSON.stringify(where)).toContain("properties");
  });

  it("wires Customer Hub page to V2 sections and compact Ask bar", () => {
    const page = readFileSync(resolve("src/app/(app)/office/page.tsx"), "utf8");
    expect(page).toMatch(/Run the front office from one screen/);
    expect(page).toMatch(/getOfficeHubData/);
    expect(page).toMatch(/OfficeScorecards/);
    expect(page).toMatch(/OfficeAttentionSection/);
    expect(page).toMatch(/OfficePipelineSection/);
    expect(page).toMatch(/variant="bar"/);
    expect(page).not.toMatch(/Follow-up/);
  });

  it("supports filtered invoice and estimate list routes", () => {
    const invoices = readFileSync(resolve("src/app/(app)/invoices/page.tsx"), "utf8");
    const estimates = readFileSync(resolve("src/app/(app)/estimates/page.tsx"), "utf8");
    expect(invoices).toMatch(/status === "overdue"/);
    expect(estimates).toMatch(/status === "open"/);
    expect(estimates).toMatch(/status === "approved"/);
    const jobs = readFileSync(resolve("src/lib/jobs/search.ts"), "utf8");
    expect(jobs).toMatch(/when === "today"/);
    expect(jobs).toMatch(/customerId/);
    const comms = readFileSync(resolve("src/app/(app)/marketing/communications/page.tsx"), "utf8");
    expect(comms).toMatch(/filter === "missed"/);
    const hub = readFileSync(resolve("src/lib/office/hub.ts"), "utf8");
    expect(hub).toMatch(/\/marketing\/communications\?filter=today/);
    expect(hub).toMatch(/\/attention\?filter=follow_ups/);
    expect(hub).toMatch(/\/jobs\?when=today/);
  });

  it("exposes property-aware customer search results", () => {
    const route = readFileSync(resolve("src/app/api/customers/search/route.ts"), "utf8");
    const typeahead = readFileSync(resolve("src/components/customers/search-typeahead.tsx"), "utf8");
    expect(route).toMatch(/propertyId/);
    expect(route).toMatch(/openEstimate/);
    expect(typeahead).toMatch(/propertyId/);
    expect(typeahead).toMatch(/New job/);
  });

  it("restricts office workspace and permissions appropriately", () => {
    expect(canAccessWorkspace("OFFICE", "office")).toBe(true);
    expect(canAccessWorkspace("TECHNICIAN", "office")).toBe(false);
    expect(can("OFFICE", "customers:view")).toBe(true);
    expect(can("TECHNICIAN", "customers:manage")).toBe(false);
  });

  it("does not mutate 865 HVAC records when loading office hub for another tenant", async () => {
    if (!hvacBefore || !ids.hvacId) return;
    await getOfficeHubData(ids.companyA);
    const after = await prisma.company.findFirst({
      where: { id: ids.hvacId },
      select: { _count: { select: { customers: true, jobs: true, estimates: true, invoices: true } } },
    });
    expect(after?._count.customers).toBe(hvacBefore.customers);
    expect(after?._count.jobs).toBe(hvacBefore.jobs);
    expect(after?._count.estimates).toBe(hvacBefore.estimates);
    expect(after?._count.invoices).toBe(hvacBefore.invoices);
  });

  it("can load Summit demo company hub without error", async () => {
    const summit = await prisma.company.findFirst({
      where: { businessName: SUMMIT_COMPANY_NAME, isDemo: true },
      select: { id: true },
    });
    if (!summit) return;
    const data = await getOfficeHubData(summit.id);
    expect(Array.isArray(data.scorecards)).toBe(true);
    expect(Array.isArray(data.recentCustomers)).toBe(true);
  });
});
