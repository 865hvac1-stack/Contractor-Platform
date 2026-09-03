import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import * as highlevelOAuth from "@/lib/highlevel/oauth";
import { HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";
import { HighLevelOAuthExchangeError } from "@/lib/highlevel/oauth";
import {
  highlevelAuthMode,
  isHighLevelConnected,
  loadHighLevelAccess,
  resolveHighLevelConnection,
} from "@/lib/highlevel/connection";
import * as store from "@/lib/integrations/store";

const prisma = new PrismaClient();

describe("canonical Marketplace OAuth HighLevel connection", () => {
  const ids = { company: "", connection: "", user: "" };

  beforeAll(async () => {
    const stamp = Date.now();
    const hash = await bcrypt.hash("TestPassword-123!", 10);
    const user = await prisma.user.create({
      data: { email: `hl-oauth-resolver-${stamp}@test.local`, passwordHash: hash, firstName: "Ops", lastName: "User" },
    });
    ids.user = user.id;
    const company = await prisma.company.create({
      data: { businessName: `HL OAuth Resolver ${stamp}`, status: "ACTIVE" },
    });
    ids.company = company.id;
    const connection = await store.upsertConnection({
      companyId: company.id,
      providerKey: HIGHLEVEL_PROVIDER_KEY,
      status: "CONNECTED",
      accountLabel: "865 HVAC",
      externalAccountId: "qPjPtcAUzdkBtYTJUUWB",
      scopes: [
        "contacts.readonly",
        "conversations.readonly",
        "conversations/message.readonly",
        "conversations/message.write",
      ],
    });
    ids.connection = connection.id;
    await store.saveConnectionTokens({
      companyId: company.id,
      connectionId: connection.id,
      tokens: {
        accessToken: "hl-oauth-access",
        refreshToken: "hl-oauth-refresh",
        expiresAt: new Date(Date.now() - 120_000).toISOString(),
        scopes: connection.scopes,
      },
    });
  });

  afterAll(async () => {
    await prisma.integrationCredential.deleteMany({ where: { companyId: ids.company } });
    await prisma.integrationConnection.deleteMany({ where: { companyId: ids.company } });
    await prisma.company.deleteMany({ where: { id: ids.company } });
    if (ids.user) await prisma.user.delete({ where: { id: ids.user } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("treats Marketplace OAuth as oauth, not private_token", () => {
    expect(
      highlevelAuthMode([
        "contacts.readonly",
        "conversations.readonly",
        "conversations/message.write",
      ])
    ).toBe("oauth");
    expect(highlevelAuthMode(["private_token"])).toBe("private_token");
  });

  it("keeps the Marketplace OAuth access token when refresh returns Location is not active", async () => {
    const spy = vi
      .spyOn(highlevelOAuth, "refreshHighLevelConnectionTokens")
      .mockRejectedValue(new HighLevelOAuthExchangeError("Location is not active", 400));
    const tokens = await store.getValidAccessToken({
      companyId: ids.company,
      connectionId: ids.connection,
      providerKey: HIGHLEVEL_PROVIDER_KEY,
    });
    expect(tokens?.accessToken).toBe("hl-oauth-access");
    const connection = await prisma.integrationConnection.findFirst({ where: { id: ids.connection } });
    expect(connection?.status).toBe("CONNECTED");
    spy.mockRestore();
  });

  it("resolves the same connected OAuth state for Settings and Sync Communications", async () => {
    const spy = vi
      .spyOn(highlevelOAuth, "refreshHighLevelConnectionTokens")
      .mockRejectedValue(new HighLevelOAuthExchangeError("Location is not actived", 400));
    const resolved = await resolveHighLevelConnection(prisma, ids.company);
    const access = await loadHighLevelAccess(prisma, ids.company);
    expect(resolved.connected).toBe(true);
    if (resolved.connected) {
      expect(resolved.authMode).toBe("oauth");
      expect(resolved.locationId).toBe("qPjPtcAUzdkBtYTJUUWB");
      expect(resolved.accessToken).toBe("hl-oauth-access");
      expect(resolved.connection.scopes.includes("private_token")).toBe(false);
    }
    expect(access?.accessToken).toBe("hl-oauth-access");
    expect(access?.locationId).toBe("qPjPtcAUzdkBtYTJUUWB");
    expect(await isHighLevelConnected(prisma, ids.company)).toBe(true);
    spy.mockRestore();
  });
});
