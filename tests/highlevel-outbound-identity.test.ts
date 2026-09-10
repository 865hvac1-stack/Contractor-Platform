import { beforeEach, describe, expect, it, vi } from "vitest";
import { HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";

const { prisma, getHighLevelContact, upsertHighLevelContact, sendHighLevelSms, resolveApprovedSenderNumber } = vi.hoisted(() => ({
  prisma: {
    customer: { findFirst: vi.fn() },
    providerIdentityMap: {
      findFirst: vi.fn(),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, string> }) => ({
        id: where.id,
        ...data,
      })),
      upsert: vi.fn(),
      create: vi.fn(),
    },
  },
  getHighLevelContact: vi.fn(),
  upsertHighLevelContact: vi.fn(),
  sendHighLevelSms: vi.fn(),
  resolveApprovedSenderNumber: vi.fn(async () => ({ phoneNumber: "+18655550100" })),
}));

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/demo/guard", () => ({
  demoOutboundBlock: async () => ({ blocked: false }),
}));
vi.mock("@/lib/highlevel/connection", () => ({
  loadHighLevelAccess: async () => ({
    accessToken: "hl-access",
    locationId: "Ssm2VhAUviopPNmEpNK1",
  }),
}));
vi.mock("@/lib/highlevel/location-token", () => ({
  assertHighLevelLocationToken: () => undefined,
}));
vi.mock("@/lib/highlevel/phone-numbers", () => ({
  resolveApprovedSenderNumber,
}));

vi.mock("@/lib/highlevel/client", () => ({
  getHighLevelContact,
  upsertHighLevelContact,
  sendHighLevelSms,
}));

import { sendViaHighLevel } from "@/lib/highlevel/communication-provider";

const syncedMap = {
  id: "map_sync",
  companyId: "co_865",
  provider: HIGHLEVEL_PROVIDER_KEY,
  entityType: "CUSTOMER",
  internalId: "cust_synced",
  externalId: "hl_contact_synced",
};

describe("outbound SMS after HighLevel communications sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.customer.findFirst).mockResolvedValue({
      id: "cust_synced",
      firstName: "Casey",
      lastName: "Rivera",
      email: "casey@865hvac.test",
      phone: "+18658514300",
      secondaryPhone: null,
    } as never);
    sendHighLevelSms.mockResolvedValue({ messageId: "msg_1" });
    resolveApprovedSenderNumber.mockResolvedValue({ phoneNumber: "+18655550100" });
  });

  it("reuses the synced HighLevel contact and does not create a second identity row", async () => {
    vi.mocked(prisma.providerIdentityMap.findFirst).mockResolvedValue(syncedMap as never);
    getHighLevelContact.mockResolvedValue({
      id: "hl_contact_synced",
      phone: "+18658514300",
      email: "casey@865hvac.test",
    });

    const result = await sendViaHighLevel({
      companyId: "co_865",
      to: "8658514300",
      body: "On the way.",
      customerId: "cust_synced",
    });

    expect(result.ok).toBe(true);
    expect(upsertHighLevelContact).not.toHaveBeenCalled();
    expect(prisma.providerIdentityMap.upsert).not.toHaveBeenCalled();
    expect(prisma.providerIdentityMap.create).not.toHaveBeenCalled();
    expect(sendHighLevelSms).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: "hl_contact_synced",
        toNumber: "+18658514300",
        fromNumber: "+18655550100",
      }),
    );
  });

  it("blocks SMS when HighLevel returns a contact that does not match the destination", async () => {
    vi.mocked(prisma.providerIdentityMap.findFirst).mockResolvedValue({
      ...syncedMap,
      externalId: "hl_wrong",
    } as never);
    getHighLevelContact.mockResolvedValue({
      id: "hl_wrong",
      phone: "+18655550999",
      email: "other@example.com",
    });
    upsertHighLevelContact.mockResolvedValue({
      contact: { id: "hl_wrong", phone: "+18655550999", email: "other@example.com" },
    });

    const result = await sendViaHighLevel({
      companyId: "co_865",
      to: "8658514300",
      body: "On the way.",
      customerId: "cust_synced",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/does not match/i);
    expect(sendHighLevelSms).not.toHaveBeenCalled();
  });

  it("re-resolves the correct HighLevel contact by phone after a stale mapped contact", async () => {
    vi.mocked(prisma.providerIdentityMap.findFirst).mockImplementation(async ({ where }) => {
      if (where.externalId === "hl_correct") return null;
      if (where.internalId === "cust_synced") {
        return { ...syncedMap, externalId: "hl_stale" } as never;
      }
      return null;
    });
    getHighLevelContact.mockImplementation(async ({ contactId }: { contactId: string }) => {
      if (contactId === "hl_stale") return { id: "hl_stale", phone: "+18655550000", email: "old@example.com" };
      return { id: contactId, phone: "+18658514300", email: "casey@865hvac.test" };
    });
    upsertHighLevelContact.mockResolvedValue({
      contact: { id: "hl_correct", phone: "+18658514300", email: "casey@865hvac.test" },
    });

    const result = await sendViaHighLevel({
      companyId: "co_865",
      to: "(865) 851-4300",
      body: "On the way.",
      customerId: "cust_synced",
    });

    expect(result.ok).toBe(true);
    expect(prisma.providerIdentityMap.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "map_sync" },
        data: { externalId: "hl_correct" },
      }),
    );
    expect(sendHighLevelSms).toHaveBeenCalledWith(expect.objectContaining({ contactId: "hl_correct" }));
  });

  it("does not send when the approved sender is the customer number", async () => {
    vi.mocked(prisma.providerIdentityMap.findFirst).mockResolvedValue(syncedMap as never);
    getHighLevelContact.mockResolvedValue({
      id: "hl_contact_synced",
      phone: "+18658514300",
      email: "casey@865hvac.test",
    });
    resolveApprovedSenderNumber.mockResolvedValue({ phoneNumber: "+18658514300" });
    sendHighLevelSms.mockClear();
    const result = await sendViaHighLevel({
      companyId: "co_865",
      to: "+18658514300",
      body: "I have openings.",
      customerId: "cust_synced",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/same number|customer phone/i);
    expect(sendHighLevelSms).not.toHaveBeenCalled();
  });
});
