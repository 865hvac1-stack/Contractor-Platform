import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { getCommandCenterData } from "@/lib/dashboard";
import { getNeedsAttention } from "@/lib/attention";
import { filterAttention, homeAttentionItems, prioritizeAttention } from "@/lib/attention-priority";
import { suggestedQuestions } from "@/lib/intelligence/intent";

const prisma = new PrismaClient();

describe("Command Center calculations", () => {
  const ids = { companyA: "", companyB: "", customerA: "", hvacId: "" };
  let hvacBefore: { customers: number; jobs: number } | null = null;

  beforeAll(async () => {
    const hvac = await prisma.company.findFirst({
      where: { businessName: "865 HVAC", isDemo: false },
      select: { id: true, _count: { select: { customers: true, jobs: true } } },
    });
    if (hvac) {
      ids.hvacId = hvac.id;
      hvacBefore = { customers: hvac._count.customers, jobs: hvac._count.jobs };
    }
    const stamp = Date.now();
    const a = await prisma.company.create({ data: { businessName: `CC A ${stamp}`, status: "ACTIVE" } });
    const b = await prisma.company.create({ data: { businessName: `CC B ${stamp}`, status: "ACTIVE" } });
    ids.companyA = a.id;
    ids.companyB = b.id;
    const customer = await prisma.customer.create({
      data: { companyId: a.id, firstName: "Robert", lastName: "Miller" },
    });
    ids.customerA = customer.id;
    await prisma.invoice.create({
      data: {
        companyId: a.id,
        customerId: customer.id,
        invoiceNumber: "INV-CC-1",
        status: "OVERDUE",
        totalCents: 485000,
        balanceCents: 485000,
        amountPaidCents: 0,
        dueDate: new Date(Date.now() - 12 * 86_400_000),
      },
    });
    await prisma.estimate.create({
      data: {
        companyId: a.id,
        customerId: customer.id,
        estimateNumber: "EST-CC-1",
        status: "SENT",
        totalCents: 1190000,
        issueDate: new Date(Date.now() - 4 * 86_400_000),
      },
    });
  });

  afterAll(async () => {
    if (ids.companyA) await prisma.company.delete({ where: { id: ids.companyA } }).catch(() => undefined);
    if (ids.companyB) await prisma.company.delete({ where: { id: ids.companyB } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("keeps KPI and attention data isolated by tenant", async () => {
    const [a, b] = await Promise.all([getCommandCenterData(ids.companyA), getCommandCenterData(ids.companyB)]);
    expect(a.money.outstandingBalance).toBe(485000);
    expect(a.sales.estimateValue).toBe(1190000);
    expect(b.money.outstandingBalance).toBe(0);
    expect(b.sales.estimateValue).toBe(0);
    expect(b.attention).toHaveLength(0);
    expect(a.attention.some((item) => item.href.startsWith("/invoices/") || item.href.startsWith("/estimates/"))).toBe(true);
  });

  it("shows only a top-N attention queue on Home", async () => {
    const data = await getCommandCenterData(ids.companyA);
    expect(data.homeAttention.length).toBeLessThanOrEqual(5);
    expect(data.homeAttention.length).toBeGreaterThan(0);
    const money = filterAttention(data.attention, "money");
    expect(money.length).toBeGreaterThan(0);
  });

  it("ranks attention from recorded items rather than hard-coded totals", async () => {
    const raw = await getNeedsAttention(ids.companyA);
    const ranked = prioritizeAttention(raw);
    const home = homeAttentionItems(ranked);
    expect(home[0]?.href).toMatch(/^\/(invoices|estimates|jobs|dispatch|marketing|memberships|receipts|expenses|team)\b/);
    expect(home.every((item) => item.score > 0)).toBe(true);
  });

  it("does not change 865 HVAC when Command Center reads another tenant", async () => {
    if (!hvacBefore || !ids.hvacId) return;
    await getCommandCenterData(ids.companyA);
    const after = await prisma.company.findFirst({
      where: { id: ids.hvacId },
      select: { _count: { select: { customers: true, jobs: true } } },
    });
    expect(after?._count.customers).toBe(hvacBefore.customers);
    expect(after?._count.jobs).toBe(hvacBefore.jobs);
  });

  it("keeps owner Ask suggestions on the existing Intelligence path", () => {
    const questions = suggestedQuestions("COMPANY_OWNER", null, "command");
    expect(questions).toContain("What needs my attention today?");
    expect(questions).toContain("Who owes us money?");
    expect(questions).toContain("Take care of my estimate follow-ups.");
  });
});
