import type { PrismaClient } from "@prisma/client";
import { HighLevelApiError, listHighLevelSocialAccounts, createHighLevelSocialPost } from "@/lib/highlevel/client";
import { highlevelPlatformToChannel } from "@/lib/highlevel/channels";
import { HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";
import { loadHighLevelAccess } from "@/lib/highlevel/connection";
import { demoOutboundBlock } from "@/lib/demo/guard";

export type DiscoveredSocialAccount = {
  id: string;
  name: string;
  platform: string;
  channel: string;
};

export async function discoverHighLevelSocialAccounts(prisma: PrismaClient, companyId: string) {
  const access = await loadHighLevelAccess(prisma, companyId);
  if (!access) return { authorized: false as const, connected: false as const, accounts: [] as DiscoveredSocialAccount[], error: "HighLevel is not connected." };

  try {
    const payload = await listHighLevelSocialAccounts({
      accessToken: access.accessToken,
      locationId: access.locationId,
    });
    const raw = payload.results?.accounts ?? payload.accounts ?? [];
    const accounts: DiscoveredSocialAccount[] = [];
    for (const account of raw) {
      const channel = highlevelPlatformToChannel(account.platform);
      if (!account.id || !channel) continue;
      accounts.push({
        id: account.id,
        name: account.name || channel.replaceAll("_", " "),
        platform: account.platform || channel,
        channel,
      });
      await prisma.integrationAccount.upsert({
        where: {
          connectionId_kind_externalId: {
            connectionId: access.connection.id,
            kind: channel,
            externalId: account.id,
          },
        },
        create: {
          companyId,
          connectionId: access.connection.id,
          providerKey: HIGHLEVEL_PROVIDER_KEY,
          kind: channel,
          externalId: account.id,
          name: account.name || channel,
          selected: true,
          metadata: { platform: account.platform, source: "highlevel" },
        },
        update: {
          name: account.name || channel,
          selected: true,
          metadata: { platform: account.platform, source: "highlevel" },
        },
      });
    }
    return { authorized: true as const, connected: true as const, accounts, error: null };
  } catch (error) {
    if (error instanceof HighLevelApiError && (error.status === 401 || error.status === 403)) {
      return {
        authorized: false as const,
        connected: true as const,
        accounts: [] as DiscoveredSocialAccount[],
        error: "HighLevel Social Planner is not authorized for this location token.",
      };
    }
    return {
      authorized: false as const,
      connected: true as const,
      accounts: [] as DiscoveredSocialAccount[],
      error: error instanceof Error ? error.message : "HighLevel Social Planner request failed.",
    };
  }
}

export function socialAccountStatus(accounts: DiscoveredSocialAccount[], channel: string, highlevelConnected: boolean, authorized: boolean) {
  if (!highlevelConnected) return { status: "NOT_CONNECTED", detail: "HighLevel is not connected." };
  if (!authorized) return { status: "NOT_AUTHORIZED", detail: "Not authorized in HighLevel Social Planner." };
  const match = accounts.find((account) => account.channel === channel);
  if (match) {
    return { status: "CONNECTED_THROUGH_HIGHLEVEL", detail: match.name };
  }
  return { status: "NOT_CONNECTED_IN_HIGHLEVEL", detail: "No account for this network in HighLevel." };
}

function validateNetworkPayload(input: { channels: string[]; body: string; mediaUrl?: string | null }) {
  const unique = [...new Set(input.channels)];
  for (const channel of unique) {
    if ((channel === "INSTAGRAM" || channel === "TIKTOK" || channel === "YOUTUBE") && !input.mediaUrl) {
      return `${channel.replaceAll("_", " ")} requires media. HighLevel will not accept a text-only payload for that network.`;
    }
    if ((channel === "FACEBOOK" || channel === "LINKEDIN" || channel === "GOOGLE_BUSINESS_PROFILE") && !input.body.trim() && !input.mediaUrl) {
      return `${channel.replaceAll("_", " ")} requires caption text or media.`;
    }
  }
  return null;
}

export async function publishThroughHighLevel(
  prisma: PrismaClient,
  input: {
    companyId: string;
    accountIds: string[];
    body: string;
    mediaUrl?: string | null;
    status: "draft" | "scheduled" | "published";
    scheduleDate?: Date | null;
    channels: string[];
  }
) {
  const blocked = await demoOutboundBlock(input.companyId, prisma);
  if (blocked.blocked) return { ok: false as const, error: blocked.message };
  const access = await loadHighLevelAccess(prisma, input.companyId);
  if (!access) return { ok: false as const, error: "HighLevel is not connected." };
  if (input.status !== "draft") {
    const invalid = validateNetworkPayload({ channels: input.channels, body: input.body, mediaUrl: input.mediaUrl });
    if (invalid) return { ok: false as const, error: invalid };
    if (!input.accountIds.length) return { ok: false as const, error: "Select at least one HighLevel social account." };
  }
  if (input.status === "scheduled") {
    if (!input.scheduleDate || Number.isNaN(input.scheduleDate.getTime())) {
      return { ok: false as const, error: "Scheduled posts require a future date." };
    }
    if (input.scheduleDate.getTime() <= Date.now()) {
      return { ok: false as const, error: "Scheduled time must be in the future. Scheduling does not publish immediately." };
    }
  }
  try {
    const created = await createHighLevelSocialPost({
      accessToken: access.accessToken,
      locationId: access.locationId,
      accountIds: input.accountIds,
      summary: input.body,
      status: input.status,
      scheduleDate: input.scheduleDate ? input.scheduleDate.toISOString() : undefined,
      mediaUrl: input.mediaUrl,
    });
    const externalId = created.results?.id || created.id || created.post?.id || null;
    return { ok: true as const, externalId, status: created.results?.status || created.post?.status || input.status };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "HighLevel rejected the social post.",
    };
  }
}
