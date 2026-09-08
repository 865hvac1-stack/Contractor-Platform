import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { endOfDay, startOfDay, startOfMonth, subDays } from "date-fns";
import {
  collectedPaymentWhere,
  openEstimateWhere,
  outstandingInvoiceWhere,
  overdueInvoiceWhere,
  readyToInvoiceWhere,
  revenueCategoryLabel,
  revenueInvoiceWhere,
} from "@/lib/finance/definitions";
import { financeHref, homeRangeHref } from "@/lib/finance/hrefs";
import { enumerateKeys, financePeriod, parseFinanceRange } from "@/lib/finance/period";
import { financeFilterCopy, parseFinanceSearch } from "@/lib/finance/query";
import { loadFinancialSnapshot } from "@/lib/finance/snapshot";
import { invoicesWhere } from "@/lib/invoices/search";
import { jobsWhere } from "@/lib/jobs/search";

const prisma = new PrismaClient();

describe("finance date ranges", () => {
  const now = new Date("2026-09-07T15:00:00");

  it("defaults unknown ranges to this month", () => {
    expect(parseFinanceRange(undefined)).toBe("month");
    expect(parseFinanceRange("nope")).toBe("month");
    expect(parseFinanceRange("30d")).toBe("30d");
  });

  it("uses one shared definition for month, 30d, 90d, and 12m", () => {
    const month = financePeriod("month", now);
    const days30 = financePeriod("30d", now);
    const days90 = financePeriod("90d", now);
    const months12 = financePeriod("12m", now);
    expect(month.start).toEqual(startOfMonth(now));
    expect(days30.start).toEqual(startOfDay(subDays(now, 29)));
    expect(days30.end.getTime()).toBe(endOfDay(now).getTime());
    expect(days90.start).toEqual(startOfDay(subDays(now, 89)));
    expect(months12.grain).toBe("month");
    expect(enumerateKeys(month).every((key) => key.startsWith("2026-09"))).toBe(true);
    expect(enumerateKeys(days30)).toHaveLength(30);
    expect(enumerateKeys(days90)).toHaveLength(90);
    expect(enumerateKeys(months12)).toHaveLength(12);
  });
});

describe("canonical finance filters", () => {
  it("scopes every where-clause to companyId", () => {
    const start = new Date("2026-09-01");
    const end = new Date("2026-09-30");
    expect(revenueInvoiceWhere("co_a", start, end).companyId).toBe("co_a");
    expect(collectedPaymentWhere("co_a", start, end).companyId).toBe("co_a");
    expect(outstandingInvoiceWhere("co_a").companyId).toBe("co_a");
    expect(overdueInvoiceWhere("co_a", end).companyId).toBe("co_a");
    expect(openEstimateWhere("co_a").companyId).toBe("co_a");
    expect(readyToInvoiceWhere("co_a").companyId).toBe("co_a");
    expect(invoicesWhere("co_a", { status: "PAID", from: "2026-09-01", to: "2026-09-07" }).companyId).toBe("co_a");
    expect(jobsWhere({ companyId: "co_a", access: {}, needsInvoice: true }).companyId).toBe("co_a");
  });

  it("applies paid-invoice dates only for revenue and ticket views", () => {
    const paid = invoicesWhere("co_a", { status: "PAID", from: "2026-09-01", to: "2026-09-07", view: "revenue" });
    expect(paid.status).toBe("PAID");
    expect(paid.updatedAt).toBeTruthy();
    const open = invoicesWhere("co_a", { status: "OPEN", from: "2026-09-01", to: "2026-09-07", view: "ar" });
    expect(open.updatedAt).toBeUndefined();
    expect(open.balanceCents).toEqual({ gt: 0 });
  });

  it("keeps ready-to-invoice jobs completed and uninvoiced", () => {
    const where = jobsWhere({ companyId: "co_a", access: {}, needsInvoice: true });
    expect(where.status).toBe("COMPLETED");
    expect(where.invoices).toEqual({ none: {} });
  });

  it("groups revenue mix from company service types, not a hard-coded HVAC list", () => {
    expect(
      revenueCategoryLabel({
        serviceType: { name: "Drain clearing" },
        job: { jobType: "Service", serviceType: { name: "Service" } },
      })
    ).toBe("Drain clearing");
    expect(revenueCategoryLabel({ serviceType: null, job: { jobType: "Panel upgrade", serviceType: null } })).toBe(
      "Panel upgrade"
    );
    expect(revenueCategoryLabel({ serviceType: null, job: null })).toBe("Other");
    const snapshot = readFileSync(resolve("src/lib/finance/snapshot.ts"), "utf8");
    expect(snapshot).not.toMatch(/Install \/ Replacement/);
    expect(snapshot).toContain("revenueCategoryLabel");
  });

  it("builds drill-down hrefs that reuse existing pages and preserve Home range", () => {
    const period = financePeriod("30d", new Date("2026-09-07T12:00:00"));
    const revenue = financeHref("/invoices", { period, status: "PAID", view: "revenue" });
    expect(revenue).toContain("/invoices?");
    expect(revenue).toContain("status=PAID");
    expect(revenue).toContain("view=revenue");
    expect(revenue).toContain("range=30d");
    expect(revenue).toContain("source=home");
    expect(financeHref("/payments", { period, view: "collected" })).toContain("/payments?");
    expect(financeHref("/reports", { period, view: "profit" })).toContain("view=profit");
    expect(homeRangeHref("month")).toBe("/dashboard");
    expect(homeRangeHref("90d")).toBe("/dashboard?range=90d");
  });

  it("explains the filter the contractor clicked", () => {
    const revenue = financeFilterCopy(
      parseFinanceSearch({
        status: "PAID",
        view: "revenue",
        from: "2026-09-01",
        to: "2026-09-07",
        source: "home",
        range: "month",
      })
    );
    expect(revenue?.title).toBe("Revenue");
    expect(revenue?.detail).toMatch(/Sep/);
    expect(financeFilterCopy(parseFinanceSearch({ status: "OPEN", view: "ar", source: "home" }))?.title).toBe("A/R");
    expect(financeFilterCopy(parseFinanceSearch({ needsInvoice: "1", source: "home" }))?.title).toBe("Ready to invoice");
    expect(financeFilterCopy(parseFinanceSearch({}))).toBeNull();
  });
});

describe("home snapshot surface", () => {
  it("keeps Home simple and makes every snapshot number a link", () => {
    const page = readFileSync(resolve("src/app/(app)/dashboard/page.tsx"), "utf8");
    const snapshot = readFileSync(resolve("src/components/home/business-snapshot.tsx"), "utf8");
    expect(page).toContain('can(ctx.role, "invoices:view")');
    expect(page).toContain('can(ctx.role, "job_costs:view")');
    expect(page).toContain("parseFinanceRange");
    expect(snapshot).toContain("href={snapshot.hrefs.revenue}");
    expect(snapshot).toContain("href={snapshot.hrefs.collected}");
    expect(snapshot).toContain("href={snapshot.hrefs.grossProfit}");
    expect(snapshot).toContain("href={snapshot.hrefs.ar}");
    expect(snapshot).toContain("href={snapshot.hrefs.openEstimates}");
    expect(snapshot).toContain("href={snapshot.hrefs.overdueAr}");
    expect(snapshot).toContain("href={snapshot.hrefs.averageTicket}");
    expect(snapshot).toContain("Not enough cost data");
    expect(snapshot).not.toContain("payroll");
    expect(snapshot).not.toContain("technician scorecard");
  });
});

describe("financial snapshot records", () => {
  const ids = {
    companyA: "",
    companyB: "",
    customerA: "",
    userA: "",
  };
  let dbReady = false;

  beforeAll(async () => {
    try {
      await prisma.$connect();
    } catch {
      return;
    }
    dbReady = true;
    const stamp = Date.now();
    const companyA = await prisma.company.create({
      data: { businessName: `Finance A ${stamp}`, industry: "HVAC", status: "ACTIVE" },
    });
    const companyB = await prisma.company.create({
      data: { businessName: `Finance B ${stamp}`, industry: "PLUMBING", status: "ACTIVE" },
    });
    ids.companyA = companyA.id;
    ids.companyB = companyB.id;
    const userA = await prisma.user.create({
      data: {
        email: `fin-a-${stamp}@test.local`,
        passwordHash: "x",
        firstName: "Ann",
        lastName: "Owner",
      },
    });
    ids.userA = userA.id;
    const customerA = await prisma.customer.create({
      data: { companyId: companyA.id, firstName: "Pat", lastName: "Owner", status: "ACTIVE" },
    });
    const customerB = await prisma.customer.create({
      data: { companyId: companyB.id, firstName: "Secret", lastName: "Co", status: "ACTIVE" },
    });
    ids.customerA = customerA.id;
    const propertyA = await prisma.property.create({
      data: {
        companyId: companyA.id,
        customerId: customerA.id,
        address: "1 Main",
        city: "Knoxville",
        state: "TN",
        zip: "37902",
      },
    });
    const install = await prisma.serviceType.create({
      data: { companyId: companyA.id, name: "Install / Replacement", key: `install-${stamp}` },
    });
    const service = await prisma.serviceType.create({
      data: { companyId: companyA.id, name: "Service", key: `service-${stamp}` },
    });
    const job = await prisma.job.create({
      data: {
        companyId: companyA.id,
        customerId: customerA.id,
        propertyId: propertyA.id,
        jobNumber: `JOB-FIN-${stamp}`,
        serviceTypeId: install.id,
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });
    await prisma.job.create({
      data: {
        companyId: companyA.id,
        customerId: customerA.id,
        propertyId: propertyA.id,
        jobNumber: `JOB-RDY-${stamp}`,
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });
    const paid = await prisma.invoice.create({
      data: {
        companyId: companyA.id,
        customerId: customerA.id,
        jobId: job.id,
        serviceTypeId: install.id,
        invoiceNumber: `INV-FIN-P-${stamp}`,
        status: "PAID",
        totalCents: 100000,
        amountPaidCents: 100000,
        balanceCents: 0,
      },
    });
    await prisma.invoice.create({
      data: {
        companyId: companyA.id,
        customerId: customerA.id,
        serviceTypeId: service.id,
        invoiceNumber: `INV-FIN-S-${stamp}`,
        status: "PAID",
        totalCents: 40000,
        amountPaidCents: 40000,
        balanceCents: 0,
      },
    });
    await prisma.invoice.create({
      data: {
        companyId: companyA.id,
        customerId: customerA.id,
        invoiceNumber: `INV-FIN-AR-${stamp}`,
        status: "SENT",
        totalCents: 25000,
        balanceCents: 25000,
        dueDate: subDays(new Date(), 10),
      },
    });
    await prisma.invoice.create({
      data: {
        companyId: companyB.id,
        customerId: customerB.id,
        invoiceNumber: `INV-FIN-B-${stamp}`,
        status: "PAID",
        totalCents: 999999,
        amountPaidCents: 999999,
      },
    });
    await prisma.payment.create({
      data: {
        companyId: companyA.id,
        invoiceId: paid.id,
        amountCents: 80000,
        refundedCents: 5000,
        status: "SUCCEEDED",
        paidAt: new Date(),
      },
    });
    await prisma.payment.create({
      data: {
        companyId: companyB.id,
        invoiceId: (
          await prisma.invoice.findFirstOrThrow({ where: { companyId: companyB.id } })
        ).id,
        amountCents: 500000,
        status: "SUCCEEDED",
        paidAt: new Date(),
      },
    });
    await prisma.jobCost.create({
      data: {
        companyId: companyA.id,
        jobId: job.id,
        category: "MATERIALS",
        amountCents: 35000,
        sourceType: "MANUAL",
        createdById: userA.id,
        confirmed: true,
      },
    });
    await prisma.estimate.create({
      data: {
        companyId: companyA.id,
        customerId: customerA.id,
        estimateNumber: `EST-FIN-${stamp}`,
        status: "SENT",
        totalCents: 22000,
      },
    });
  });

  afterAll(async () => {
    if (ids.companyA) await prisma.company.delete({ where: { id: ids.companyA } }).catch(() => undefined);
    if (ids.companyB) await prisma.company.delete({ where: { id: ids.companyB } }).catch(() => undefined);
    if (ids.userA) await prisma.user.delete({ where: { id: ids.userA } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("calculates company-scoped revenue, collections, profit, and A/R from verified records", async () => {
    if (!dbReady) return;
    const snapshot = await loadFinancialSnapshot(ids.companyA, "month");
    expect(snapshot.hasData).toBe(true);
    expect(snapshot.revenueCents).toBe(140000);
    expect(snapshot.collectedCents).toBe(75000);
    expect(snapshot.arCents).toBe(25000);
    expect(snapshot.overdueArCents).toBe(25000);
    expect(snapshot.openEstimateCents).toBe(22000);
    expect(snapshot.averageTicketCents).toBe(70000);
    expect(snapshot.readyToInvoiceCount).toBe(1);
    expect(snapshot.grossProfitAvailable).toBe(true);
    expect(snapshot.grossProfitCents).toBe(65000);
    expect(snapshot.mix.map((slice) => slice.label).sort()).toEqual(["Install / Replacement", "Service"]);
    expect(snapshot.trend.every((point) => point.revenueCents > 0 || point.collectedCents > 0)).toBe(true);
    expect(snapshot.hrefs.revenue).toContain("status=PAID");
    expect(snapshot.hrefs.collected).toContain("/payments?");
  });

  it("does not leak another tenant's financials and stays empty without records", async () => {
    if (!dbReady) return;
    const [b, empty] = await Promise.all([
      loadFinancialSnapshot(ids.companyB, "month"),
      loadFinancialSnapshot("missing-company", "month"),
    ]);
    expect(b.revenueCents).toBe(999999);
    expect(b.collectedCents).toBe(500000);
    expect(b.arCents).toBe(0);
    expect(empty.hasData).toBe(false);
    expect(empty.revenueCents).toBe(0);
    expect(empty.grossProfitAvailable).toBe(false);
  });
});
