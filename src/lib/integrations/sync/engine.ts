import { prisma } from "@/lib/db";
import { scopedCompanyWhere } from "@/lib/intelligence/scope";
import { getValidAccessToken } from "@/lib/integrations/store";
import { syncGoogleProvider } from "@/lib/integrations/sync/google";
import { syncMetaProvider } from "@/lib/integrations/sync/meta";
import { syncTikTokProvider } from "@/lib/integrations/sync/tiktok";
import { syncLinkedInProvider } from "@/lib/integrations/sync/linkedin";

export async function runConnectionSync(input: {
  companyId: string;
  providerKey: string;
  kind?: string;
}) {
  const connection = await prisma.integrationConnection.findFirst({
    where: scopedCompanyWhere(input.companyId, { providerKey: input.providerKey }),
    include: { accounts: true },
  });
  if (!connection) {
    return { ok: false as const, error: "This channel is not connected." };
  }

  const sync = await prisma.integrationSync.create({
    data: {
      companyId: input.companyId,
      connectionId: connection.id,
      kind: input.kind ?? "manual",
      status: "RUNNING",
    },
  });

  await prisma.integrationConnection.update({
    where: { id: connection.id },
    data: { status: "SYNCING", lastAttemptAt: new Date() },
  });

  try {
    const tokens = await getValidAccessToken({
      companyId: input.companyId,
      connectionId: connection.id,
      providerKey: input.providerKey,
    });
    if (!tokens) {
      throw new Error("Authorization expired. Reconnect this provider.");
    }

    let recordsOut = 0;
    if (connection.providerKey.startsWith("google_") || connection.providerKey === "youtube") {
      recordsOut = await syncGoogleProvider({ connection, accessToken: tokens.accessToken });
    } else if (
      connection.providerKey === "facebook" ||
      connection.providerKey === "instagram" ||
      connection.providerKey === "meta_ads"
    ) {
      recordsOut = await syncMetaProvider({ connection, accessToken: tokens.accessToken });
    } else if (connection.providerKey.startsWith("tiktok")) {
      recordsOut = await syncTikTokProvider({ connection, accessToken: tokens.accessToken });
    } else if (connection.providerKey === "linkedin") {
      recordsOut = await syncLinkedInProvider({ connection, accessToken: tokens.accessToken });
    } else {
      throw new Error("This channel does not have a live sync yet.");
    }

    await prisma.integrationSync.update({
      where: { id: sync.id },
      data: {
        status: "SUCCEEDED",
        finishedAt: new Date(),
        recordsOut,
      },
    });
    await prisma.integrationConnection.update({
      where: { id: connection.id },
      data: {
        status: "CONNECTED",
        lastSyncAt: new Date(),
        nextSyncAt: new Date(Date.now() + 60 * 60 * 1000),
        healthMessage: `Last synced ${new Date().toLocaleString()}`,
        errorMessage: null,
      },
    });
    return { ok: true as const, recordsOut };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed.";
    await prisma.integrationSync.update({
      where: { id: sync.id },
      data: { status: "FAILED", finishedAt: new Date(), errorMessage: message },
    });
    await prisma.integrationConnection.update({
      where: { id: connection.id },
      data: {
        status: message.toLowerCase().includes("expired") ? "REAUTH_REQUIRED" : "ERROR",
        errorMessage: message,
        lastAttemptAt: new Date(),
      },
    });
    return { ok: false as const, error: message };
  }
}
