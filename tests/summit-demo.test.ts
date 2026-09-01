import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { sendCompanyCommunication } from "@/lib/comms/provider";
import { DEMO_BLOCKED_MESSAGE, SUMMIT_COMPANY_NAME } from "@/lib/demo/constants";
import { addDemoDays, atDemoHour, partsInZone } from "@/lib/demo/dates";
import { assertResettableDemoCompany, isDemoCompany } from "@/lib/demo/guard";
import { resetSummitDemoCompany } from "@/lib/demo/seed-summit";
import { wipeDemoCompany } from "@/lib/demo/wipe";
import { sendTransactionalEmail } from "@/lib/email/resend";
import { publishThroughHighLevel } from "@/lib/highlevel/social";
import { resolveInvoicePaymentDestination } from "@/lib/payments/intents";
import { syncInvoiceToQuickBooks, syncPaymentToQuickBooks } from "@/lib/quickbooks/sync";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const prisma = new PrismaClient();

describe("Summit Home Services demo tenant", () => {
  const ids = { normalCompany: "", normalUser: "", demoCompany: "" };
  let hvacBefore: { id: string; customers: number; jobs: number } | null = null;
  let counts: Awaited<ReturnType<typeof resetSummitDemoCompany>>;

  beforeAll(async () => {
    const hvac = await prisma.company.findFirst({
      where: { businessName: "865 HVAC", isDemo: false },
      select: { id: true, _count: { select: { customers: true, jobs: true } } },
    });
    if (hvac) {
      hvacBefore = { id: hvac.id, customers: hvac._count.customers, jobs: hvac._count.jobs };
    }
    const stamp = Date.now();
    const hash = await bcrypt.hash("NormalTenant-123!", 10);
    const user = await prisma.user.create({
      data: { email: `normal-${stamp}@example.test`, passwordHash: hash, firstName: "Nora", lastName: "Lane" },
    });
    ids.normalUser = user.id;
    const company = await prisma.company.create({
      data: { businessName: `Normal Co ${stamp}`, industry: "PLUMBING", status: "ACTIVE" },
    });
    ids.normalCompany = company.id;
    await prisma.membership.create({
      data: { companyId: company.id, userId: user.id, role: "COMPANY_OWNER", status: "ACTIVE" },
    });
    counts = await resetSummitDemoCompany(prisma);
    ids.demoCompany = counts.companyId;
  }, 180_000);

  afterAll(async () => {
    if (ids.normalCompany) {
      await prisma.membership.deleteMany({ where: { companyId: ids.normalCompany } });
      await prisma.company.delete({ where: { id: ids.normalCompany } }).catch(() => undefined);
    }
    if (ids.normalUser) await prisma.user.delete({ where: { id: ids.normalUser } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("creates an isolated isDemo Summit tenant", async () => {
    expect(counts.companyName).toBe(SUMMIT_COMPANY_NAME);
    expect(await isDemoCompany(ids.demoCompany)).toBe(true);
    expect(await isDemoCompany(ids.normalCompany)).toBe(false);
    expect(counts.team).toBe(14);
    expect(counts.customers).toBe(100);
    expect(counts.properties).toBeGreaterThanOrEqual(115);
    expect(counts.todayJobs).toBeGreaterThanOrEqual(10);
    expect(counts.estimates).toBeGreaterThanOrEqual(20);
    expect(counts.invoices).toBeGreaterThanOrEqual(30);
    expect(counts.playbooks).toBe(5);
  });

  it("keeps 865 HVAC unchanged when present", async () => {
    if (!hvacBefore) return;
    const after = await prisma.company.findFirst({
      where: { id: hvacBefore.id },
      select: { isDemo: true, _count: { select: { customers: true, jobs: true } } },
    });
    expect(after?.isDemo).toBe(false);
    expect(after?._count.customers).toBe(hvacBefore.customers);
    expect(after?._count.jobs).toBe(hvacBefore.jobs);
  });

  it("isolates customers and jobs between tenants", async () => {
    const leakedToNormal = await prisma.customer.findFirst({
      where: { companyId: ids.normalCompany, sourceSystem: "DEMO" },
    });
    expect(leakedToNormal).toBeNull();
    const leakedFromNormal = await prisma.customer.findFirst({
      where: { companyId: ids.demoCompany, email: { contains: "normal-" } },
    });
    expect(leakedFromNormal).toBeNull();
    const job = await prisma.job.findFirst({ where: { companyId: ids.demoCompany } });
    expect(job?.customerId).toBeTruthy();
    expect(job?.propertyId).toBeTruthy();
  });

  it("blocks demo outbound SMS, email, Stripe, refunds, HighLevel, social, and QuickBooks", async () => {
    const sms = await sendCompanyCommunication({
      companyId: ids.demoCompany,
      channel: "SMS",
      to: "(865) 555-1000",
      body: "Should not send",
    });
    expect(sms.ok).toBe(false);
    if (!sms.ok) expect(sms.error).toBe(DEMO_BLOCKED_MESSAGE);
    const email = await sendTransactionalEmail({
      to: "nobody@example.com",
      subject: "nope",
      html: "<p>nope</p>",
      text: "nope",
      companyId: ids.demoCompany,
    });
    expect(email.ok).toBe(false);
    if (!email.ok) expect(email.error).toBe(DEMO_BLOCKED_MESSAGE);
    const stripe = await resolveInvoicePaymentDestination(prisma, {
      companyId: ids.demoCompany,
      invoiceId: "missing",
    });
    expect(stripe.ok).toBe(false);
    if (!stripe.ok) expect(stripe.error).toBe(DEMO_BLOCKED_MESSAGE);
    const social = await publishThroughHighLevel(prisma, {
      companyId: ids.demoCompany,
      accountIds: ["x"],
      body: "nope",
      status: "published",
      channels: ["FACEBOOK"],
    });
    expect(social.ok).toBe(false);
    if (!social.ok) expect(social.error).toBe(DEMO_BLOCKED_MESSAGE);
    const transport = async () => ({ ok: false, status: 401, json: {} });
    const qbInvoice = await syncInvoiceToQuickBooks(prisma, transport, {
      companyId: ids.demoCompany,
      invoiceId: "missing",
      actorId: ids.normalUser,
    });
    expect(qbInvoice.ok).toBe(false);
    expect(qbInvoice.error).toBe(DEMO_BLOCKED_MESSAGE);
    const qbPayment = await syncPaymentToQuickBooks(prisma, transport, {
      companyId: ids.demoCompany,
      paymentId: "missing",
    });
    expect(qbPayment.ok).toBe(false);
    expect(qbPayment.error).toBe(DEMO_BLOCKED_MESSAGE);
    const { refuseDemoExternal } = await import("@/lib/demo/guard");
    const refund = await refuseDemoExternal(ids.demoCompany);
    expect(refund?.ok).toBe(false);
    expect(refund?.error).toBe(DEMO_BLOCKED_MESSAGE);
    const normal = await refuseDemoExternal(ids.normalCompany);
    expect(normal).toBeNull();
  });

  it("refuses reset against a normal company", async () => {
    expect(() =>
      assertResettableDemoCompany({ id: ids.normalCompany, isDemo: false, businessName: "Normal" })
    ).toThrow(/only allowed/);
    await expect(wipeDemoCompany(prisma, ids.normalCompany)).rejects.toThrow(/only allowed/);
  });

  it("builds today and tomorrow with relative dates", () => {
    const now = new Date();
    const today = atDemoHour(now, 8, 0);
    const tomorrow = addDemoDays(now, 1, 9, 0);
    expect(partsInZone(today).day).toBe(partsInZone(now).day);
    expect(tomorrow.getTime()).toBeGreaterThan(today.getTime());
  });

  it("keeps job, estimate, invoice, and payment relationships valid", async () => {
    const invoice = await prisma.invoice.findFirst({
      where: { companyId: ids.demoCompany, jobId: { not: null } },
      include: { payments: true, job: true, customer: true },
    });
    expect(invoice?.job?.companyId).toBe(ids.demoCompany);
    expect(invoice?.customer.companyId).toBe(ids.demoCompany);
    if (invoice && invoice.amountPaidCents > 0) {
      expect(invoice.payments[0]?.provider).toBe("DEMO");
    }
    const cost = await prisma.jobCost.findFirst({ where: { companyId: ids.demoCompany } });
    expect(cost?.amountCents).toBeGreaterThan(0);
  });

  it("does not seed provider credentials or live account ids", async () => {
    const creds = await prisma.integrationCredential.count({ where: { companyId: ids.demoCompany } });
    const stripe = await prisma.stripeConnectAccount.count({ where: { companyId: ids.demoCompany } });
    const qb = await prisma.quickBooksSettings.count({ where: { companyId: ids.demoCompany } });
    expect(creds).toBe(0);
    expect(stripe).toBe(0);
    expect(qb).toBe(0);
    const sql = readFileSync(resolve(process.cwd(), "prisma/migrations/20260901200000_summit_demo_company/migration.sql"), "utf8");
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS/i);
    expect(sql).not.toMatch(/DROP TABLE/i);
  });

  it("applies tenant branding on the demo company", async () => {
    const company = await prisma.company.findFirst({ where: { id: ids.demoCompany } });
    expect(company?.primaryColor).toBe("#12233F");
    expect(company?.accentColor).toBe("#FF6A1A");
    expect(company?.logoUrl).toContain("/demo/summit/");
    expect(company?.tagline).toBe("Comfort. Done Right.");
  });
});
