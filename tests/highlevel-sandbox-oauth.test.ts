import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";
import { canStartHighLevelOAuth, companyAllowsExternalIntegrationTesting, refuseDemoExternal } from "@/lib/demo/guard";
import { authorizeHighLevelTestGrant } from "@/lib/highlevel/test-grant";
import { assertHighLevelLocationAvailable } from "@/lib/highlevel/phone-numbers";
import { processHighLevelWebhook, resolveHighLevelConnectionByLocation } from "@/lib/highlevel/webhooks";
import { SUMMIT_COMPANY_NAME } from "@/lib/demo/constants";

const prisma = new PrismaClient();

describe("HighLevel integration sandbox and TEST_ONLY grants", () => {
  const ids = {
    owner: "",
    ownerConnection: "",
    summit: "",
    otherDemo: "",
    production: "",
    ownerCustomer: "",
  };

  beforeAll(async () => {
    const stamp = Date.now();
    const owner = await prisma.company.create({
      data: { businessName: `865 HVAC Sandbox Owner ${stamp}`, status: "ACTIVE", isDemo: false },
    });
    const summit = await prisma.company.create({
      data: {
        businessName: `${SUMMIT_COMPANY_NAME} Sandbox ${stamp}`,
        status: "ACTIVE",
        isDemo: true,
        allowExternalIntegrationTesting: true,
      },
    });
    const otherDemo = await prisma.company.create({
      data: { businessName: `Other Demo ${stamp}`, status: "ACTIVE", isDemo: true },
    });
    const production = await prisma.company.create({
      data: { businessName: `Production Tenant ${stamp}`, status: "ACTIVE", isDemo: false },
    });
    ids.owner = owner.id;
    ids.summit = summit.id;
    ids.otherDemo = otherDemo.id;
    ids.production = production.id;
    const connection = await prisma.integrationConnection.create({
      data: {
        companyId: owner.id,
        providerKey: HIGHLEVEL_PROVIDER_KEY,
        status: "CONNECTED",
        externalAccountId: `loc_865_owned_${stamp}`,
        accountLabel: "865 HVAC",
        scopes: ["private_token"],
        healthMessage: "Connected with a location Private Integration Token (testing / single-location).",
      },
    });
    ids.ownerConnection = connection.id;
    const customer = await prisma.customer.create({
      data: { companyId: owner.id, firstName: "Real", lastName: "Customer", phone: "+18655550123" },
    });
    ids.ownerCustomer = customer.id;
  });

  afterAll(async () => {
    for (const id of [ids.summit, ids.otherDemo, ids.production, ids.owner]) {
      if (id) await prisma.company.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it("blocks ordinary demo companies from HighLevel OAuth", async () => {
    expect(await companyAllowsExternalIntegrationTesting(ids.otherDemo)).toBe(false);
    expect(await canStartHighLevelOAuth(ids.otherDemo)).toBe(false);
    const refused = await refuseDemoExternal(ids.otherDemo);
    expect(refused?.ok).toBe(false);
  });

  it("allows Summit sandbox to initiate HighLevel OAuth without unlocking SMS or purchase", async () => {
    expect(await companyAllowsExternalIntegrationTesting(ids.summit)).toBe(true);
    expect(await canStartHighLevelOAuth(ids.summit)).toBe(true);
    const stillBlocked = await refuseDemoExternal(ids.summit);
    expect(stillBlocked?.ok).toBe(false);
    expect(await canStartHighLevelOAuth(ids.production)).toBe(true);
  });

  it("creates a TEST_ONLY grant without claiming 865 ownership", async () => {
    const owner = await prisma.integrationConnection.findUnique({ where: { id: ids.ownerConnection } });
    const locationId = owner?.externalAccountId ?? "";
    const lock = await assertHighLevelLocationAvailable(prisma, locationId, ids.summit);
    expect(lock.ok).toBe(false);
    const result = await authorizeHighLevelTestGrant(prisma, {
      tenantCompanyId: ids.summit,
      locationId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe("TEST_ONLY");
    expect(result.ownerCompanyId).toBe(ids.owner);
    const summitClaim = await prisma.integrationConnection.findFirst({
      where: { companyId: ids.summit, providerKey: HIGHLEVEL_PROVIDER_KEY, externalAccountId: locationId },
    });
    expect(summitClaim).toBeNull();
    const ownerAfter = await prisma.integrationConnection.findUnique({ where: { id: ids.ownerConnection } });
    expect(ownerAfter?.externalAccountId).toBe(locationId);
    expect(ownerAfter?.companyId).toBe(ids.owner);
    expect(ownerAfter?.status).toBe("CONNECTED");
    expect(ownerAfter?.updatedAt.getTime()).toBe(owner?.updatedAt.getTime());
  });

  it("does not copy 865 customers or conversations into Summit", async () => {
    const leakedCustomer = await prisma.customer.findFirst({
      where: { companyId: ids.summit, phone: { contains: "8655550123" } },
    });
    expect(leakedCustomer).toBeNull();
    const leakedThread = await prisma.communicationThread.findFirst({ where: { companyId: ids.summit } });
    expect(leakedThread).toBeNull();
    const ownerCustomers = await prisma.customer.count({ where: { companyId: ids.owner } });
    expect(ownerCustomers).toBe(1);
  });

  it("keeps HighLevel webhooks on the owner company, not Summit", async () => {
    const owner = await prisma.integrationConnection.findUnique({ where: { id: ids.ownerConnection } });
    const locationId = owner?.externalAccountId ?? "";
    const resolved = await resolveHighLevelConnectionByLocation(prisma, locationId);
    expect(resolved?.companyId).toBe(ids.owner);
    expect(resolved?.companyId).not.toBe(ids.summit);
    await processHighLevelWebhook(prisma, {
      companyId: resolved!.companyId,
      connectionId: resolved!.id,
      payload: {
        type: "InboundMessage",
        webhookId: "wh_owner_only_1",
        locationId,
        conversationId: "conv_owner_1",
        messageId: "msg_owner_1",
        messageType: "CALL",
        direction: "inbound",
        from: "+18655550999",
        to: "+18655550100",
      },
    });
    const summitCall = await prisma.callRecord.findFirst({ where: { companyId: ids.summit } });
    expect(summitCall).toBeNull();
    const ownerCall = await prisma.callRecord.findFirst({ where: { companyId: ids.owner, recordingRef: "msg_owner_1" } });
    expect(ownerCall).toBeTruthy();
  });

  it("does not let an ordinary demo complete a TEST_ONLY grant", async () => {
    const owner = await prisma.integrationConnection.findUnique({ where: { id: ids.ownerConnection } });
    const result = await authorizeHighLevelTestGrant(prisma, {
      tenantCompanyId: ids.otherDemo,
      locationId: owner?.externalAccountId ?? "",
    });
    expect(result.ok).toBe(false);
  });

  it("refuses a sandbox grant that would claim an unowned HighLevel location", async () => {
    const result = await authorizeHighLevelTestGrant(prisma, {
      tenantCompanyId: ids.summit,
      locationId: "loc_unowned_must_not_become_summit",
    });
    expect(result.ok).toBe(false);
    const claimed = await prisma.integrationConnection.findFirst({
      where: {
        companyId: ids.summit,
        providerKey: HIGHLEVEL_PROVIDER_KEY,
        externalAccountId: "loc_unowned_must_not_become_summit",
      },
    });
    expect(claimed).toBeNull();
  });

  it("does not route unrelated HighLevel locations into Summit", async () => {
    const resolved = await resolveHighLevelConnectionByLocation(prisma, "loc_unrelated_agency_xyz");
    expect(resolved).toBeNull();
    const summitEvents = await prisma.integrationEvent.count({ where: { companyId: ids.summit } });
    const summitCalls = await prisma.callRecord.count({ where: { companyId: ids.summit } });
    const summitThreads = await prisma.communicationThread.count({ where: { companyId: ids.summit } });
    expect(summitEvents).toBe(0);
    expect(summitCalls).toBe(0);
    expect(summitThreads).toBe(0);
  });

  it("keeps production tenant isolation after TEST_ONLY authorization", async () => {
    const ownerMaps = await prisma.providerIdentityMap.count({ where: { companyId: ids.owner } });
    const summitMaps = await prisma.providerIdentityMap.count({ where: { companyId: ids.summit } });
    const summitConnections = await prisma.integrationConnection.count({
      where: { companyId: ids.summit, providerKey: HIGHLEVEL_PROVIDER_KEY },
    });
    const summitCredentials = await prisma.integrationCredential.count({ where: { companyId: ids.summit } });
    expect(ownerMaps).toBe(0);
    expect(summitMaps).toBe(0);
    expect(summitConnections).toBe(0);
    expect(summitCredentials).toBe(0);
    const productionCustomer = await prisma.customer.findFirst({
      where: { id: ids.ownerCustomer, companyId: ids.production },
    });
    expect(productionCustomer).toBeNull();
  });
});
