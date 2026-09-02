"use server";

import { revalidatePath } from "next/cache";
import { AuthError } from "@/lib/auth";
import { requireAnyPermission, requirePermission } from "@/lib/tenant";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import type { ActionResult } from "@/server/actions/auth";
import { HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";
import { deleteConnectionCredentials, getValidAccessToken, saveConnectionTokens, upsertConnection } from "@/lib/integrations/store";
import { probeHighLevelLocation } from "@/lib/highlevel/connection";
import { applyHighLevelContactSync, previewHighLevelContactSync } from "@/lib/highlevel/sync";
import { formatCommunicationsSyncMessage, syncHighLevelCommunications } from "@/lib/highlevel/comms-sync";
import { discoverHighLevelSocialAccounts, publishThroughHighLevel } from "@/lib/highlevel/social";
import { sendCompanyCommunication } from "@/lib/comms/provider";
import { sanitizeHighLevelLocationId } from "@/lib/highlevel/location-id";
import { refuseDemoExternal } from "@/lib/demo/guard";
import { assertHighLevelLocationAvailable } from "@/lib/highlevel/phone-numbers";
import {
  resolveApprovedSenderNumber,
  searchHighLevelInventory,
  syncHighLevelActiveNumbers,
} from "@/lib/highlevel/phone-numbers";
import { SMS_DEFAULT_CHANNEL } from "@/lib/highlevel/config";
import { loadHighLevelAccess } from "@/lib/highlevel/connection";
import { purchaseHighLevelNumber } from "@/lib/highlevel/client";
import { normalizePhoneDigits } from "@/lib/highlevel/identity";

export async function connectHighLevelPrivateTokenAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("marketing:manage");
    const submittedLocationId = String(formData.get("highlevelLocationId") || formData.get("locationId") || "").trim();
    const submittedToken = String(formData.get("highlevelPrivateToken") || formData.get("privateToken") || "").trim();
    const locationName = String(formData.get("locationName") || "").trim();
    const locationId = sanitizeHighLevelLocationId(submittedLocationId);
    if (submittedLocationId && !locationId) {
      return { ok: false, error: "HighLevel Location ID cannot be an email or profile value. Use the provider location id." };
    }

    const existing = await prisma.integrationConnection.findFirst({
      where: { companyId: ctx.company.id, providerKey: HIGHLEVEL_PROVIDER_KEY },
      include: { credentials: true },
    });
    const storedLocationId = sanitizeHighLevelLocationId(existing?.externalAccountId);
    const resolvedLocationId = locationId || storedLocationId;
    if (!resolvedLocationId) {
      return { ok: false, error: "HighLevel Location ID is required." };
    }
    const locationLock = await assertHighLevelLocationAvailable(prisma, resolvedLocationId, ctx.company.id);
    if (!locationLock.ok) return locationLock;

    let token = submittedToken;
    if (!token && existing) {
      const stored = await getValidAccessToken({
        companyId: ctx.company.id,
        connectionId: existing.id,
        providerKey: HIGHLEVEL_PROVIDER_KEY,
      });
      token = stored?.accessToken ?? "";
    }
    if (!token) {
      return { ok: false, error: "Private Integration Token is required for the first connection." };
    }

    const probe = await probeHighLevelLocation(token, resolvedLocationId);
    const connection = await upsertConnection({
      companyId: ctx.company.id,
      providerKey: HIGHLEVEL_PROVIDER_KEY,
      status: probe.ok ? "CONNECTED" : "ERROR",
      accountLabel: probe.ok ? probe.location.name || locationName || existing?.accountLabel || "HighLevel location" : locationName || existing?.accountLabel || null,
      externalAccountId: resolvedLocationId,
      scopes: ["private_token"],
      healthMessage: probe.ok
        ? "Connected with a location Private Integration Token (testing / single-location)."
        : probe.error,
      errorMessage: probe.ok ? null : probe.error,
    });
    if (submittedToken) {
      await saveConnectionTokens({
        companyId: ctx.company.id,
        connectionId: connection.id,
        tokens: { accessToken: submittedToken, scopes: ["private_token"] },
      });
    }
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: probe.ok ? "highlevel.connected" : "highlevel.connect_failed",
      entityType: "IntegrationConnection",
      entityId: connection.id,
      metadata: { mode: "private_token", locationId: resolvedLocationId },
    });
    revalidatePath("/settings/highlevel");
    revalidatePath("/marketing/channels");
    revalidatePath("/marketing/communications");
    return probe.ok
      ? { ok: true, message: "HighLevel location connected." }
      : { ok: false, error: probe.error };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function disconnectHighLevelAction(
  _prev: ActionResult | null,
  _formData?: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("marketing:manage");
    const connection = await prisma.integrationConnection.findFirst({
      where: { companyId: ctx.company.id, providerKey: HIGHLEVEL_PROVIDER_KEY },
    });
    if (connection) {
      await deleteConnectionCredentials(ctx.company.id, connection.id);
      await upsertConnection({
        companyId: ctx.company.id,
        providerKey: HIGHLEVEL_PROVIDER_KEY,
        status: "DISABLED",
        healthMessage: "Disconnected. ContractorYou customers, jobs, and invoices were not changed.",
        errorMessage: null,
      });
      await writeAudit({
        companyId: ctx.company.id,
        actorId: ctx.user.id,
        action: "highlevel.disconnected",
        entityType: "IntegrationConnection",
        entityId: connection.id,
        metadata: {},
      });
    }
    revalidatePath("/settings/highlevel");
    revalidatePath("/marketing/channels");
    return { ok: true, message: "HighLevel disconnected. Operational history is unchanged." };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function refreshHighLevelConnectionAction(
  _prev: ActionResult | null,
  _formData?: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("marketing:manage");
    const demo = await refuseDemoExternal(ctx.company.id);
    if (demo) return demo;
    const connection = await prisma.integrationConnection.findFirst({
      where: { companyId: ctx.company.id, providerKey: HIGHLEVEL_PROVIDER_KEY },
      include: { credentials: true },
    });
    const storedLocationId = sanitizeHighLevelLocationId(connection?.externalAccountId);
    if (!connection || !storedLocationId || !connection.credentials) {
      return { ok: false, error: "HighLevel is not connected." };
    }
    const { decryptProviderTokens } = await import("@/lib/integrations/crypto");
    const tokens = decryptProviderTokens({
      ciphertext: Buffer.from(connection.credentials.ciphertext),
      iv: Buffer.from(connection.credentials.iv),
      authTag: Buffer.from(connection.credentials.authTag),
      keyVersion: connection.credentials.keyVersion,
    });
    const probe = await probeHighLevelLocation(tokens.accessToken, storedLocationId);
    await prisma.integrationConnection.update({
      where: { id: connection.id },
      data: {
        lastHealthAt: new Date(),
        status: probe.ok ? "CONNECTED" : "REAUTH_REQUIRED",
        accountLabel: probe.ok ? probe.location.name || connection.accountLabel : connection.accountLabel,
        healthMessage: probe.ok ? "Location reachable." : probe.error,
        errorMessage: probe.ok ? null : probe.error,
      },
    });
    revalidatePath("/settings/highlevel");
    return probe.ok ? { ok: true, message: "HighLevel connection is healthy." } : { ok: false, error: probe.error };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function previewHighLevelSyncAction(
  _prev: ActionResult | null,
  _formData?: FormData
): Promise<ActionResult & { summary?: string }> {
  try {
    const ctx = await requirePermission("marketing:manage");
    const demo = await refuseDemoExternal(ctx.company.id);
    if (demo) return demo;
    const preview = await previewHighLevelContactSync(prisma, ctx.company.id);
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "highlevel.sync_previewed",
      entityType: "IntegrationConnection",
      entityId: ctx.company.id,
      metadata: {
        contactsFound: preview.contactsFound,
        existingMatches: preview.existingMatches,
        newLeads: preview.newLeads,
      },
    });
    revalidatePath("/settings/highlevel");
    return {
      ok: true,
      message: `Preview: ${preview.contactsFound} contacts, ${preview.existingMatches} existing customers, ${preview.newLeads} new leads, ${preview.nameOnlySkipped} name-only skipped.`,
      summary: JSON.stringify(preview),
    };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : "Preview failed." };
  }
}

export async function applyHighLevelSyncAction(
  _prev: ActionResult | null,
  _formData?: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("marketing:manage");
    const demo = await refuseDemoExternal(ctx.company.id);
    if (demo) return demo;
    const result = await applyHighLevelContactSync(prisma, ctx.company.id, ctx.user.id);
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "highlevel.sync_completed",
      entityType: "IntegrationConnection",
      entityId: ctx.company.id,
      metadata: { mapped: result.mapped, leadsCreated: result.leadsCreated },
    });
    revalidatePath("/settings/highlevel");
    revalidatePath("/marketing/leads");
    return {
      ok: true,
      message: `Sync finished. Mapped ${result.mapped} existing customers and created ${result.leadsCreated} leads. No historical jobs were changed.`,
    };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : "Sync failed." };
  }
}

export async function syncHighLevelCommunicationsAction(
  _prev: ActionResult | null,
  _formData?: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("marketing:manage");
    const demo = await refuseDemoExternal(ctx.company.id);
    if (demo) return demo;
    const result = await syncHighLevelCommunications(prisma, ctx.company.id);
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "highlevel.communications_synced",
      entityType: "IntegrationConnection",
      entityId: ctx.company.id,
      metadata: result,
    });
    revalidatePath("/settings/highlevel");
    revalidatePath("/marketing/communications");
    return {
      ok: true,
      message: formatCommunicationsSyncMessage(result),
    };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : "Communications sync failed." };
  }
}

export async function refreshHighLevelSocialAccountsAction(
  _prev: ActionResult | null,
  _formData?: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("marketing:manage");
    const demo = await refuseDemoExternal(ctx.company.id);
    if (demo) return demo;
    const result = await discoverHighLevelSocialAccounts(prisma, ctx.company.id);
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "highlevel.social_discovered",
      entityType: "IntegrationConnection",
      entityId: ctx.company.id,
      metadata: { count: result.accounts.length, authorized: result.authorized },
    });
    revalidatePath("/marketing/social");
    revalidatePath("/settings/highlevel");
    if (!result.authorized) return { ok: false, error: result.error || "Social Planner is not authorized." };
    return {
      ok: true,
      message: result.accounts.length
        ? `Found ${result.accounts.length} HighLevel social account${result.accounts.length === 1 ? "" : "s"}.`
        : "HighLevel Social Planner is reachable. No social accounts are connected in HighLevel.",
    };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : "Social discovery failed." };
  }
}

export async function createHighLevelSocialPostAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("marketing:manage");
    const demo = await refuseDemoExternal(ctx.company.id);
    if (demo) return demo;
    const intent = String(formData.get("intent") || "draft");
    const body = String(formData.get("body") || "").trim();
    const mediaUrl = String(formData.get("mediaUrl") || "").trim() || null;
    const linkUrl = String(formData.get("linkUrl") || "").trim() || null;
    const ctaLabel = String(formData.get("ctaLabel") || "").trim() || null;
    const scheduledRaw = String(formData.get("scheduledAt") || "");
    const accountIds = formData.getAll("accountId").map((value) => String(value)).filter(Boolean);
    const discovered = await discoverHighLevelSocialAccounts(prisma, ctx.company.id);
    const selected = discovered.accounts.filter((account) => accountIds.includes(account.id));
    if (!body && intent !== "draft") return { ok: false, error: "Write the post before scheduling or publishing." };
    const status = intent === "publish" ? "published" : intent === "schedule" ? "scheduled" : "draft";
    if (status === "published" && !accountIds.length) {
      return { ok: false, error: "Select a HighLevel social account before publishing." };
    }
    const scheduledAt = scheduledRaw ? new Date(scheduledRaw) : null;
    const result = await publishThroughHighLevel(prisma, {
      companyId: ctx.company.id,
      accountIds,
      body: linkUrl ? `${body}\n${linkUrl}` : body,
      mediaUrl,
      status,
      scheduleDate: scheduledAt,
      channels: selected.map((account) => account.channel),
    });
    if (!result.ok) return { ok: false, error: result.error };
    const channel = selected[0]?.channel || "FACEBOOK";
    const publications = new Map(selected.map((account) => [account.channel, account]));
    const post = await prisma.socialPost.create({
      data: {
        companyId: ctx.company.id,
        channel,
        provider: HIGHLEVEL_PROVIDER_KEY,
        externalId: result.externalId,
        body,
        linkUrl,
        mediaUrl,
        ctaLabel,
        scheduledAt: status === "scheduled" ? scheduledAt : null,
        publishedAt: status === "published" ? new Date() : null,
        status: status === "published" ? "PUBLISHED" : status === "scheduled" ? "SCHEDULED" : "DRAFT",
        publications: {
          create: [...publications.values()].map((account) => ({
            companyId: ctx.company.id,
            channel: account.channel,
            status: status === "published" ? "PUBLISHED" : status === "scheduled" ? "SCHEDULED" : "DRAFT",
            externalId: result.externalId,
            publishedAt: status === "published" ? new Date() : null,
          })),
        },
      },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: `highlevel.social_${status}`,
      entityType: "SocialPost",
      entityId: post.id,
      metadata: { intent, accounts: accountIds.length },
    });
    revalidatePath("/marketing/social");
    return {
      ok: true,
      message:
        status === "published"
          ? "Published through HighLevel."
          : status === "scheduled"
            ? "Scheduled in HighLevel. It was not published immediately."
            : "Draft saved in HighLevel. It was not published.",
    };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : "Social post failed." };
  }
}

export async function sendInboxSmsAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requireAnyPermission(["marketing:manage", "jobs:field_status", "customers:manage"]);
    const to = String(formData.get("to") || "").trim();
    const body = String(formData.get("body") || "").trim();
    const customerId = String(formData.get("customerId") || "") || null;
    const leadId = String(formData.get("leadId") || "") || null;
    if (!to || !body) return { ok: false, error: "Phone and message are required." };
    const confirmExternalSend = String(formData.get("confirmExternalSend") || "").trim().toUpperCase() === "SEND";
    const result = await sendCompanyCommunication({
      companyId: ctx.company.id,
      channel: "SMS",
      to,
      body,
      customerId,
      leadId,
      confirmExternalSend,
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: result.ok ? "highlevel.sms_sent" : "highlevel.sms_failed",
      entityType: "Communication",
      entityId: customerId || leadId || ctx.company.id,
      metadata: { provider: result.provider, configured: result.ok ? true : result.configured },
    });
    revalidatePath("/marketing/communications");
    return result.ok
      ? { ok: true, message: `Text sent through ${result.provider} from the approved sender.` }
      : { ok: false, error: result.error };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function syncHighLevelNumbersAction(
  _prev: ActionResult | null,
  _formData?: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("marketing:manage");
    const result = await syncHighLevelActiveNumbers(prisma, ctx.company.id);
    if (!result.ok) return { ok: false, error: result.error };
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "highlevel.numbers_synced",
      entityType: "TrackingNumber",
      entityId: ctx.company.id,
      metadata: { synced: result.synced, locationId: result.locationId },
    });
    revalidatePath("/marketing/channels/tracking_numbers");
    revalidatePath("/marketing/forms");
    revalidatePath("/settings/highlevel");
    return {
      ok: true,
      message:
        result.synced > 0
          ? `Imported ${result.synced} HighLevel number${result.synced === 1 ? "" : "s"}. Map a source and set the SMS sender before texting.`
          : "HighLevel returned no active numbers for this location.",
    };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : "Number sync failed." };
  }
}

export async function mapTrackingNumberSourceAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("marketing:manage");
    const id = String(formData.get("trackingNumberId") || "").trim();
    const source = String(formData.get("source") || "").trim();
    const campaign = String(formData.get("campaign") || "").trim() || null;
    if (!id || !source) return { ok: false, error: "Select a number and a source." };
    const row = await prisma.trackingNumber.findFirst({ where: { id, companyId: ctx.company.id } });
    if (!row) return { ok: false, error: "Tracking number not found." };
    await prisma.trackingNumber.update({
      where: { id: row.id },
      data: { source, campaign },
    });
    revalidatePath("/marketing/channels/tracking_numbers");
    revalidatePath("/marketing/forms");
    return { ok: true, message: `${row.phoneNumber} mapped to ${source}.` };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function setDefaultSmsSenderAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("marketing:manage");
    const id = String(formData.get("trackingNumberId") || "").trim();
    const row = await prisma.trackingNumber.findFirst({ where: { id, companyId: ctx.company.id } });
    if (!row) return { ok: false, error: "Tracking number not found." };
    await prisma.trackingNumber.updateMany({
      where: { companyId: ctx.company.id, channel: SMS_DEFAULT_CHANNEL },
      data: { channel: null },
    });
    await prisma.trackingNumber.update({
      where: { id: row.id },
      data: { channel: SMS_DEFAULT_CHANNEL, provider: HIGHLEVEL_PROVIDER_KEY, status: "ACTIVE" },
    });
    const sender = await resolveApprovedSenderNumber(prisma, ctx.company.id);
    revalidatePath("/marketing/channels/tracking_numbers");
    return { ok: true, message: `Approved SMS sender is ${sender?.phoneNumber ?? row.phoneNumber}.` };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function searchHighLevelAvailableNumbersAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("marketing:manage");
    const areaCode = String(formData.get("areaCode") || "").trim();
    const result = await searchHighLevelInventory(prisma, ctx.company.id, { countryCode: "US", areaCode });
    if (!result.ok) return { ok: false, error: result.error };
    return {
      ok: true,
      message:
        result.numbers.length > 0
          ? `Found ${result.numbers.length} available number${result.numbers.length === 1 ? "" : "s"}. Purchase is billable and requires typing PURCHASE.`
          : "No available numbers matched that search.",
    };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : "Number search failed." };
  }
}

export async function purchaseHighLevelNumberAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("marketing:manage");
    const demo = await refuseDemoExternal(ctx.company.id);
    if (demo) return demo;
    const confirm = String(formData.get("confirmPurchase") || "").trim();
    const phoneNumber = String(formData.get("phoneNumber") || "").trim();
    if (confirm !== "PURCHASE") {
      return { ok: false, error: "Type PURCHASE to buy this HighLevel number. This is a billable provider action." };
    }
    if (!normalizePhoneDigits(phoneNumber)) return { ok: false, error: "Enter the exact number to purchase." };
    const access = await loadHighLevelAccess(prisma, ctx.company.id);
    if (!access) return { ok: false, error: "HighLevel is not connected." };
    const purchased = await purchaseHighLevelNumber({
      accessToken: access.accessToken,
      locationId: access.locationId,
      phoneNumber,
    });
    await syncHighLevelActiveNumbers(prisma, ctx.company.id);
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "highlevel.number_purchased",
      entityType: "TrackingNumber",
      entityId: ctx.company.id,
      metadata: { phoneNumber, locationId: access.locationId },
    });
    revalidatePath("/marketing/channels/tracking_numbers");
    return {
      ok: true,
      message: `Purchased ${purchased.data?.number || purchased.data?.phoneNumber || phoneNumber} for this HighLevel location.`,
    };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : "Number purchase failed." };
  }
}
