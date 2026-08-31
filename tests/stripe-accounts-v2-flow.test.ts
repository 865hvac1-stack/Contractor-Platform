import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

const accountsCreate = vi.fn();
const accountLinksCreate = vi.fn();
const accountsRetrieve = vi.fn();

vi.mock("@/lib/payments/stripe-client", () => ({
  requireStripe: () => ({
    v2: {
      core: {
        accounts: {
          create: accountsCreate,
          retrieve: accountsRetrieve,
        },
        accountLinks: { create: accountLinksCreate },
      },
    },
    accounts: { createLoginLink: vi.fn() },
    webhooks: { constructEvent: vi.fn() },
    parseEventNotification: vi.fn(),
  }),
}));

const { createOrResumeConnectAccount, refreshConnectAccount } = await import("@/lib/payments/connect");

const prisma = new PrismaClient();

describe("accounts v2 create-or-resume flow", () => {
  const ids = { companyId: "" };

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: { businessName: `V2 Flow ${Date.now()}`, industry: "HVAC", status: "ACTIVE" },
    });
    ids.companyId = company.id;
    accountsCreate.mockReset();
    accountLinksCreate.mockReset();
    accountsRetrieve.mockReset();
    accountsCreate.mockResolvedValue({ id: `acct_v2_${company.id}` });
    accountLinksCreate.mockResolvedValue({ url: "https://connect.stripe.com/v2/onboard/test" });
    accountsRetrieve.mockResolvedValue({
      id: `acct_v2_${company.id}`,
      configuration: {
        merchant: {
          applied: false,
          capabilities: { card_payments: { status: "pending" } },
        },
      },
      requirements: { entries: [{ awaiting_action_from: "user", description: "identity" }] },
    });
  });

  afterAll(async () => {
    await prisma.stripeWebhookEvent.deleteMany({ where: { companyId: ids.companyId } });
    await prisma.stripeConnectAccount.deleteMany({ where: { companyId: ids.companyId } });
    await prisma.company.deleteMany({ where: { id: ids.companyId } });
    await prisma.$disconnect();
  });

  it("A. first Set Up Payments creates one Accounts v2 account", async () => {
    const first = await createOrResumeConnectAccount(prisma, {
      companyId: ids.companyId,
      email: "owner@865hvac.local",
      businessName: "865 HVAC",
    });
    expect(accountsCreate).toHaveBeenCalledTimes(1);
    const createArgs = accountsCreate.mock.calls[0]?.[0] as { dashboard?: string; identity?: { country?: string } };
    expect(createArgs.dashboard).toBe("full");
    expect(createArgs.identity?.country).toBe("us");
    expect(JSON.stringify(createArgs)).not.toMatch(/"dashboard"\s*:\s*"express"/);
    expect(JSON.stringify(createArgs)).not.toMatch(/"type"\s*:\s*"express"/);
    expect(first.created).toBe(true);
    expect(first.stripeAccountId).toBe(`acct_v2_${ids.companyId}`);
    expect(first.url).toContain("connect.stripe.com");
    expect(accountLinksCreate).toHaveBeenCalledTimes(1);
    const linkArgs = accountLinksCreate.mock.calls[0]?.[0] as { use_case?: { type?: string } };
    expect(linkArgs.use_case?.type).toBe("account_onboarding");
    const rows = await prisma.stripeConnectAccount.findMany({ where: { companyId: ids.companyId } });
    expect(rows).toHaveLength(1);
  });

  it("B/C. second click and incomplete onboarding reuse the same account", async () => {
    accountsCreate.mockClear();
    accountLinksCreate.mockClear();
    const second = await createOrResumeConnectAccount(prisma, {
      companyId: ids.companyId,
      email: "owner@865hvac.local",
      businessName: "865 HVAC",
    });
    expect(accountsCreate).not.toHaveBeenCalled();
    expect(second.created).toBe(false);
    expect(second.stripeAccountId).toBe(`acct_v2_${ids.companyId}`);
    expect(accountLinksCreate).toHaveBeenCalledTimes(1);
    const rows = await prisma.stripeConnectAccount.findMany({ where: { companyId: ids.companyId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.onboardingStatus).not.toBe("CONNECTED");
  });

  it("D/E. return refresh uses Accounts v2 status and does not mark CONNECTED when incapable", async () => {
    const updated = await refreshConnectAccount(prisma, ids.companyId);
    expect(accountsRetrieve).toHaveBeenCalled();
    expect(updated?.onboardingStatus).toBe("ONBOARDING");
    expect(updated?.chargesEnabled).toBe(false);
    expect(updated?.detailsSubmitted).toBe(false);

    accountsRetrieve.mockResolvedValueOnce({
      id: `acct_v2_${ids.companyId}`,
      configuration: {
        merchant: {
          applied: true,
          capabilities: {
            card_payments: { status: "active" },
            stripe_balance: { payouts: { status: "active" } },
          },
        },
      },
      requirements: { entries: [] },
    });
    const ready = await refreshConnectAccount(prisma, ids.companyId);
    expect(ready?.onboardingStatus).toBe("CONNECTED");
    expect(ready?.chargesEnabled).toBe(true);
    expect(ready?.payoutsEnabled).toBe(true);
  });

  it("K. Stripe API failure stays contractor-safe", async () => {
    accountsCreate.mockRejectedValueOnce(
      new Error("Stripe no longer recommends Accounts v1. sk_test_secretvalue")
    );
    await prisma.stripeConnectAccount.deleteMany({ where: { companyId: ids.companyId } });
    await expect(
      createOrResumeConnectAccount(prisma, {
        companyId: ids.companyId,
        email: "owner@865hvac.local",
        businessName: "865 HVAC",
      })
    ).rejects.toThrow(/Accounts v1|Stripe/);
  });
});
