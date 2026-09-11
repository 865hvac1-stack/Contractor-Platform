import { describe, expect, it } from "vitest";
import { analyzeBillingHealth, summarizeFindings } from "@/lib/billing-watchdog/detect";
import { getJobBillingReadiness, looksLikeNoChargeJob } from "@/lib/billing-watchdog/readiness";
import { persistWatchdogFindings } from "@/lib/billing-watchdog/persist";
import { presentInvoiceDelivery } from "@/lib/billing-watchdog/invoice-delivery";
import { defaultWatchdogStartDate } from "@/lib/billing-watchdog/settings";
import { can } from "@/lib/permissions";
import type { BillingWatchdogSettingsView, DetectedFinding } from "@/lib/billing-watchdog/types";
import type { PrismaClient } from "@prisma/client";

const asOf = new Date("2026-09-11T16:00:00");
const settings: BillingWatchdogSettingsView = {
  startDate: new Date("2026-09-01"),
  checkoutGraceMinutes: 120,
  completedInvoiceGraceHours: 8,
  invoiceSendGraceHours: 4,
  accountingSyncGraceHours: 24,
  morningSummaryEnabled: false,
  morningSummaryRoles: ["COMPANY_OWNER"],
};

function baseInput(overrides: Partial<Parameters<typeof analyzeBillingHealth>[0]> = {}) {
  return {
    companyId: "co-a",
    asOf,
    settings,
    jobs: [],
    invoices: [],
    payments: [],
    customers: [{ id: "cust-1", name: "Carolyn Everett", email: "carolyn@example.com", phone: "5551111" }],
    qboConnected: false,
    qboInvoiceMaps: [],
    qboPaymentMaps: [],
    excludedFingerprints: new Set<string>(),
    excludedJobIds: new Set<string>(),
    ...overrides,
  };
}

describe("Billing Watchdog detection", () => {
  it("1. completed job with invoice creates no alert", () => {
    const findings = analyzeBillingHealth(
      baseInput({
        jobs: [
          {
            id: "job-1",
            companyId: "co-a",
            jobNumber: "JOB-1051",
            status: "COMPLETED",
            customerId: "cust-1",
            scheduledStart: new Date("2026-09-09T14:00:00"),
            scheduledEnd: new Date("2026-09-09T16:00:00"),
            checkedInAt: new Date("2026-09-09T14:00:00"),
            checkedOutAt: new Date("2026-09-09T16:00:00"),
            completedAt: new Date("2026-09-09T16:00:00"),
            createdAt: new Date("2026-09-09T10:00:00"),
            importMode: "LIVE",
          },
        ],
        invoices: [
          {
            id: "inv-1",
            companyId: "co-a",
            invoiceNumber: "INV-1051",
            status: "SENT",
            jobId: "job-1",
            customerId: "cust-1",
            totalCents: 42500,
            amountPaidCents: 0,
            balanceCents: 42500,
            issueDate: new Date("2026-09-09"),
            dueDate: new Date("2026-09-20"),
            createdAt: new Date("2026-09-09T16:10:00"),
            sentAt: new Date("2026-09-09T16:15:00"),
            deliveryStatus: "SENT",
          },
        ],
      })
    );
    expect(findings.some((row) => row.type === "COMPLETED_NO_INVOICE")).toBe(false);
  });

  it("2. completed billable job with no invoice alerts", () => {
    const findings = analyzeBillingHealth(
      baseInput({
        jobs: [
          {
            id: "job-1",
            companyId: "co-a",
            jobNumber: "JOB-1051",
            status: "COMPLETED",
            customerId: "cust-1",
            scheduledStart: new Date("2026-09-09T14:00:00"),
            scheduledEnd: new Date("2026-09-09T16:00:00"),
            checkedInAt: new Date("2026-09-09T14:00:00"),
            checkedOutAt: new Date("2026-09-09T16:00:00"),
            completedAt: new Date("2026-09-09T16:00:00"),
            createdAt: new Date("2026-09-09T10:00:00"),
            estimateTotalCents: 42500,
            importMode: "LIVE",
          },
        ],
      })
    );
    const hit = findings.find((row) => row.type === "COMPLETED_NO_INVOICE");
    expect(hit).toBeTruthy();
    expect(hit?.amountAtRiskCents).toBe(42500);
    expect(hit?.amountUnknown).toBe(false);
  });

  it("3. completed warranty/no-charge job does not alert", () => {
    expect(looksLikeNoChargeJob("Warranty callback", "Service")).toBe(true);
    const findings = analyzeBillingHealth(
      baseInput({
        jobs: [
          {
            id: "job-w",
            companyId: "co-a",
            jobNumber: "JOB-W",
            status: "COMPLETED",
            jobType: "Warranty callback",
            customerId: "cust-1",
            scheduledStart: new Date("2026-09-09T14:00:00"),
            scheduledEnd: new Date("2026-09-09T16:00:00"),
            checkedInAt: new Date("2026-09-09T14:00:00"),
            checkedOutAt: new Date("2026-09-09T16:00:00"),
            completedAt: new Date("2026-09-09T16:00:00"),
            createdAt: new Date("2026-09-09T10:00:00"),
            importMode: "LIVE",
          },
        ],
      })
    );
    expect(findings.some((row) => row.type === "COMPLETED_NO_INVOICE")).toBe(false);
    expect(getJobBillingReadiness({
      id: "job-w",
      jobNumber: "JOB-W",
      status: "COMPLETED",
      jobType: "Warranty callback",
      invoices: [],
    }).state).toBe("NOT_REQUIRED");
  });

  it("4. technician started yesterday and never checked out alerts", () => {
    const findings = analyzeBillingHealth(
      baseInput({
        jobs: [
          {
            id: "job-1042",
            companyId: "co-a",
            jobNumber: "JOB-1042",
            status: "IN_PROGRESS",
            customerId: "cust-1",
            scheduledStart: new Date("2026-09-10T14:00:00"),
            scheduledEnd: new Date("2026-09-10T16:00:00"),
            checkedInAt: new Date("2026-09-10T14:05:00"),
            checkedOutAt: null,
            completedAt: null,
            createdAt: new Date("2026-09-10T09:00:00"),
            technicianId: "tech-1",
            importMode: "LIVE",
          },
        ],
        customers: [{ id: "cust-1", name: "JR Day", email: "jr@example.com" }],
      })
    );
    expect(findings.some((row) => row.type === "TECH_CHECKOUT_INCOMPLETE")).toBe(true);
  });

  it("5. active legitimate current job does not false-alert", () => {
    const findings = analyzeBillingHealth(
      baseInput({
        jobs: [
          {
            id: "job-now",
            companyId: "co-a",
            jobNumber: "JOB-NOW",
            status: "IN_PROGRESS",
            customerId: "cust-1",
            scheduledStart: new Date("2026-09-11T15:00:00"),
            scheduledEnd: new Date("2026-09-11T17:00:00"),
            checkedInAt: new Date("2026-09-11T15:10:00"),
            checkedOutAt: null,
            completedAt: null,
            createdAt: new Date("2026-09-11T08:00:00"),
            importMode: "LIVE",
          },
        ],
      })
    );
    expect(findings.some((row) => row.type.includes("CHECKOUT"))).toBe(false);
  });

  it("6. invoice created but not sent alerts", () => {
    const findings = analyzeBillingHealth(
      baseInput({
        invoices: [
          {
            id: "inv-1058",
            companyId: "co-a",
            invoiceNumber: "INV-1058",
            status: "DRAFT",
            jobId: null,
            customerId: "cust-1",
            totalCents: 98500,
            amountPaidCents: 0,
            balanceCents: 98500,
            issueDate: new Date("2026-09-10"),
            dueDate: new Date("2026-09-20"),
            createdAt: new Date("2026-09-10T10:00:00"),
            sentAt: null,
            deliveryStatus: "NONE",
          },
        ],
      })
    );
    expect(findings.some((row) => row.type === "INVOICE_NOT_SENT")).toBe(true);
  });

  it("7. invoice intentionally draft within grace does not alert", () => {
    const findings = analyzeBillingHealth(
      baseInput({
        invoices: [
          {
            id: "inv-new",
            companyId: "co-a",
            invoiceNumber: "INV-NEW",
            status: "DRAFT",
            jobId: null,
            customerId: "cust-1",
            totalCents: 10000,
            amountPaidCents: 0,
            balanceCents: 10000,
            issueDate: asOf,
            dueDate: new Date("2026-09-20"),
            createdAt: new Date("2026-09-11T14:00:00"),
            sentAt: null,
            deliveryStatus: "NONE",
          },
        ],
      })
    );
    expect(findings.some((row) => row.type === "INVOICE_NOT_SENT")).toBe(false);
  });

  it("8. missing customer email blocks email delivery", () => {
    const findings = analyzeBillingHealth(
      baseInput({
        customers: [{ id: "cust-1", name: "Smith Residence", email: null }],
        invoices: [
          {
            id: "inv-1058",
            companyId: "co-a",
            invoiceNumber: "INV-1058",
            status: "DRAFT",
            jobId: null,
            customerId: "cust-1",
            totalCents: 210000,
            amountPaidCents: 0,
            balanceCents: 210000,
            issueDate: new Date("2026-09-10"),
            dueDate: new Date("2026-09-20"),
            createdAt: new Date("2026-09-10T10:00:00"),
            sentAt: null,
            deliveryStatus: "NONE",
          },
        ],
      })
    );
    expect(findings.some((row) => row.type === "CUSTOMER_MISSING_EMAIL")).toBe(true);
    expect(findings.some((row) => row.type === "INVOICE_NOT_SENT")).toBe(false);
  });

  it("9. verified delivery failure alerts", () => {
    const findings = analyzeBillingHealth(
      baseInput({
        invoices: [
          {
            id: "inv-fail",
            companyId: "co-a",
            invoiceNumber: "INV-FAIL",
            status: "SENT",
            jobId: null,
            customerId: "cust-1",
            totalCents: 50000,
            amountPaidCents: 0,
            balanceCents: 50000,
            issueDate: new Date("2026-09-10"),
            dueDate: new Date("2026-09-20"),
            createdAt: new Date("2026-09-10T10:00:00"),
            sentAt: new Date("2026-09-10T11:00:00"),
            deliveryStatus: "FAILED",
            lastDeliveryError: "Mailbox rejected",
          },
        ],
      })
    );
    expect(findings.some((row) => row.type === "INVOICE_DELIVERY_FAILED")).toBe(true);
  });

  it("10. sent invoice unpaid but not overdue does not create overdue alert", () => {
    const findings = analyzeBillingHealth(
      baseInput({
        invoices: [
          {
            id: "inv-ok",
            companyId: "co-a",
            invoiceNumber: "INV-OK",
            status: "SENT",
            jobId: null,
            customerId: "cust-1",
            totalCents: 10000,
            amountPaidCents: 0,
            balanceCents: 10000,
            issueDate: new Date("2026-09-10"),
            dueDate: new Date("2026-09-20"),
            createdAt: new Date("2026-09-10T10:00:00"),
            sentAt: new Date("2026-09-10T11:00:00"),
            deliveryStatus: "SENT",
          },
        ],
      })
    );
    expect(findings.some((row) => row.type === "OVERDUE_INVOICE")).toBe(false);
  });

  it("11. invoice past due creates overdue alert", () => {
    const findings = analyzeBillingHealth(
      baseInput({
        invoices: [
          {
            id: "inv-late",
            companyId: "co-a",
            invoiceNumber: "INV-LATE",
            status: "SENT",
            jobId: null,
            customerId: "cust-1",
            totalCents: 10000,
            amountPaidCents: 0,
            balanceCents: 10000,
            issueDate: new Date("2026-08-01"),
            dueDate: new Date("2026-09-01"),
            createdAt: new Date("2026-09-02T10:00:00"),
            sentAt: new Date("2026-09-02T11:00:00"),
            deliveryStatus: "SENT",
          },
        ],
      })
    );
    expect(findings.some((row) => row.type === "OVERDUE_INVOICE")).toBe(true);
  });

  it("12. successful payment correctly applied creates no alert", () => {
    const findings = analyzeBillingHealth(
      baseInput({
        invoices: [
          {
            id: "inv-paid",
            companyId: "co-a",
            invoiceNumber: "INV-PAID",
            status: "PAID",
            jobId: null,
            customerId: "cust-1",
            totalCents: 10000,
            amountPaidCents: 10000,
            balanceCents: 0,
            issueDate: new Date("2026-09-10"),
            dueDate: new Date("2026-09-20"),
            createdAt: new Date("2026-09-10T10:00:00"),
            sentAt: new Date("2026-09-10T11:00:00"),
            deliveryStatus: "SENT",
          },
        ],
        payments: [
          {
            id: "pay-1",
            invoiceId: "inv-paid",
            amountCents: 10000,
            status: "SUCCEEDED",
            paidAt: new Date("2026-09-10T12:00:00"),
          },
        ],
      })
    );
    expect(findings.some((row) => row.type === "PAYMENT_NOT_APPLIED")).toBe(false);
  });

  it("13. payment exists but unresolved alerts", () => {
    const findings = analyzeBillingHealth(
      baseInput({
        invoices: [
          {
            id: "inv-open",
            companyId: "co-a",
            invoiceNumber: "INV-OPEN",
            status: "SENT",
            jobId: null,
            customerId: "cust-1",
            totalCents: 10000,
            amountPaidCents: 0,
            balanceCents: 10000,
            issueDate: new Date("2026-09-10"),
            dueDate: new Date("2026-09-20"),
            createdAt: new Date("2026-09-10T10:00:00"),
            sentAt: new Date("2026-09-10T11:00:00"),
            deliveryStatus: "SENT",
          },
        ],
        payments: [
          {
            id: "pay-1",
            invoiceId: "inv-open",
            amountCents: 10000,
            status: "SUCCEEDED",
            paidAt: new Date("2026-09-10T12:00:00"),
          },
        ],
      })
    );
    expect(findings.some((row) => row.type === "PAYMENT_NOT_APPLIED")).toBe(true);
  });

  it("14. ContractorYou/QBO discrepancy after grace alerts", () => {
    const findings = analyzeBillingHealth(
      baseInput({
        qboConnected: true,
        invoices: [
          {
            id: "inv-qbo",
            companyId: "co-a",
            invoiceNumber: "INV-QBO",
            status: "PAID",
            jobId: null,
            customerId: "cust-1",
            totalCents: 10000,
            amountPaidCents: 10000,
            balanceCents: 0,
            issueDate: new Date("2026-09-08"),
            dueDate: new Date("2026-09-20"),
            createdAt: new Date("2026-09-08T10:00:00"),
            updatedAt: new Date("2026-09-08T12:00:00"),
            sentAt: new Date("2026-09-08T11:00:00"),
            deliveryStatus: "SENT",
          },
        ],
        payments: [
          {
            id: "pay-qbo",
            invoiceId: "inv-qbo",
            amountCents: 10000,
            status: "SUCCEEDED",
            paidAt: new Date("2026-09-08T12:00:00"),
          },
        ],
      })
    );
    expect(findings.some((row) => row.type === "ACCOUNTING_OUT_OF_SYNC")).toBe(true);
  });

  it("15. temporary QBO sync delay within grace does not alert", () => {
    const findings = analyzeBillingHealth(
      baseInput({
        qboConnected: true,
        invoices: [
          {
            id: "inv-qbo",
            companyId: "co-a",
            invoiceNumber: "INV-QBO",
            status: "PAID",
            jobId: null,
            customerId: "cust-1",
            totalCents: 10000,
            amountPaidCents: 10000,
            balanceCents: 0,
            issueDate: asOf,
            dueDate: new Date("2026-09-20"),
            createdAt: asOf,
            updatedAt: asOf,
            sentAt: asOf,
            deliveryStatus: "SENT",
          },
        ],
        payments: [
          {
            id: "pay-qbo",
            invoiceId: "inv-qbo",
            amountCents: 10000,
            status: "SUCCEEDED",
            paidAt: new Date("2026-09-11T15:00:00"),
          },
        ],
      })
    );
    expect(findings.some((row) => row.type === "ACCOUNTING_OUT_OF_SYNC")).toBe(false);
  });

  it("18. imported historical records do not flood Watchdog", () => {
    const findings = analyzeBillingHealth(
      baseInput({
        jobs: [
          {
            id: "job-hist",
            companyId: "co-a",
            jobNumber: "JOB-HIST",
            status: "COMPLETED",
            customerId: "cust-1",
            scheduledStart: new Date("2024-01-01"),
            scheduledEnd: new Date("2024-01-01"),
            checkedInAt: new Date("2024-01-01"),
            checkedOutAt: new Date("2024-01-01"),
            completedAt: new Date("2024-01-01"),
            createdAt: new Date("2024-01-01"),
            importMode: "HISTORICAL",
            importedTotalCents: 999999,
          },
        ],
        invoices: [
          {
            id: "inv-hist",
            companyId: "co-a",
            invoiceNumber: "INV-HIST",
            status: "DRAFT",
            jobId: "job-hist",
            customerId: "cust-1",
            totalCents: 999999,
            amountPaidCents: 0,
            balanceCents: 999999,
            issueDate: new Date("2024-01-01"),
            dueDate: new Date("2024-01-15"),
            createdAt: new Date("2024-01-01"),
            sentAt: null,
            deliveryStatus: "NONE",
            importMode: "HISTORICAL",
          },
        ],
      })
    );
    expect(findings).toHaveLength(0);
  });

  it("21/22. revenue at risk totals only verified amounts and keeps unknown separate", () => {
    const summary = summarizeFindings([
      { type: "COMPLETED_NO_INVOICE", amountAtRiskCents: 42500, amountUnknown: false },
      { type: "COMPLETED_NO_INVOICE", amountAtRiskCents: null, amountUnknown: true },
      { type: "INVOICE_NOT_SENT", amountAtRiskCents: 6100, amountUnknown: false },
    ]);
    expect(summary.verifiedAtRiskCents).toBe(48600);
    expect(summary.unknownAmountCount).toBe(1);
    expect(summary.openCount).toBe(3);
    expect(summary.morningLine).toMatch(/\$486/);
  });
});

describe("Billing Watchdog readiness and delivery", () => {
  it("marks a completed billable job READY and an invoiced job ALREADY_BILLED", () => {
    expect(
      getJobBillingReadiness({
        id: "j1",
        jobNumber: "JOB-1",
        status: "COMPLETED",
        customerId: "cust-1",
        invoices: [],
        estimateTotalCents: 1000,
      }).state
    ).toBe("READY");
    expect(
      getJobBillingReadiness({
        id: "j1",
        jobNumber: "JOB-1",
        status: "COMPLETED",
        invoices: [{ id: "inv", invoiceNumber: "INV-1058", status: "SENT", totalCents: 210000 }],
      }).label
    ).toMatch(/INV-1058/);
  });

  it("does not confuse QuickBooks with customer delivery", () => {
    expect(presentInvoiceDelivery({ status: "SENT", sentAt: asOf, deliveryStatus: "SENT" }).label).toBe("Sent");
    expect(presentInvoiceDelivery({ status: "SENT", deliveryStatus: "FAILED" }).label).toBe("Delivery failed");
    expect(presentInvoiceDelivery({ status: "PAID", sentAt: asOf, deliveryStatus: "SENT" }).label).toBe("Paid");
    expect(presentInvoiceDelivery({ status: "DRAFT" }).label).toBe("Draft");
  });

  it("20. technicians cannot manage company-wide financial Watchdog", () => {
    expect(can("TECHNICIAN", "invoices:financial")).toBe(false);
    expect(can("TECHNICIAN", "reports:financial")).toBe(false);
    expect(can("OFFICE", "invoices:view")).toBe(true);
    expect(can("COMPANY_OWNER", "invoices:manage")).toBe(true);
  });

  it("defaults the Watchdog start date to a safe recent month start", () => {
    expect(defaultWatchdogStartDate(new Date(2026, 8, 11))).toEqual(new Date(2026, 8, 1));
  });
});

describe("Billing Watchdog persistence", () => {
  it("16/17/23. auto-resolves fixed issues, keeps exclusions, and does not duplicate", async () => {
    const rows: Array<Record<string, unknown>> = [];
    const prisma = {
      billingWatchdogFinding: {
        async findMany() {
          return rows;
        },
        async create({ data }: { data: Record<string, unknown> }) {
          const created = { id: `f${rows.length + 1}`, status: "OPEN", ...data };
          rows.push(created);
          return created;
        },
        async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
          const row = rows.find((item) => item.id === where.id);
          if (row) Object.assign(row, data);
          return row;
        },
        async updateMany({ where, data }: { where: { companyId: string; id?: { in: string[] } }; data: Record<string, unknown> }) {
          let count = 0;
          for (const row of rows) {
            if (row.companyId !== where.companyId) continue;
            if (where.id?.in && !where.id.in.includes(String(row.id))) continue;
            Object.assign(row, data);
            count += 1;
          }
          return { count };
        },
      },
    } as unknown as PrismaClient;

    const finding: DetectedFinding = {
      fingerprint: "COMPLETED_NO_INVOICE:job:job-1",
      type: "COMPLETED_NO_INVOICE",
      severity: "ACTION_NEEDED",
      jobId: "job-1",
      invoiceId: null,
      paymentId: null,
      customerId: "cust-1",
      technicianId: null,
      amountAtRiskCents: 42500,
      amountUnknown: false,
      reason: "No invoice",
      recommendedAction: "Create invoice",
      title: "Carolyn Everett",
      subtitle: "JOB-1051",
      actions: [],
      metadata: {},
    };

    await persistWatchdogFindings(prisma, "co-a", [finding], asOf);
    await persistWatchdogFindings(prisma, "co-a", [finding], asOf);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("OPEN");

    rows[0]!.status = "EXCLUDED";
    await persistWatchdogFindings(prisma, "co-a", [finding], asOf);
    expect(rows[0]?.status).toBe("EXCLUDED");

    rows[0]!.status = "OPEN";
    await persistWatchdogFindings(prisma, "co-a", [], asOf);
    expect(rows[0]?.status).toBe("RESOLVED");
  });
});
