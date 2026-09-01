"use server";

import { revalidatePath } from "next/cache";
import { AuthError } from "@/lib/auth";
import { requireAnyPermission, requirePermission } from "@/lib/tenant";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import type { ActionResult } from "@/server/actions/auth";
import { HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";
import { deleteConnectionCredentials, saveConnectionTokens, upsertConnection } from "@/lib/integrations/store";
import { probeHighLevelLocation } from "@/lib/highlevel/connection";
import { applyHighLevelContactSync, previewHighLevelContactSync } from "@/lib/highlevel/sync";
import { sendCompanyCommunication } from "@/lib/comms/provider";

export async function connectHighLevelPrivateTokenAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("marketing:manage");
    const locationId = String(formData.get("locationId") || "").trim();
    const token = String(formData.get("privateToken") || "").trim();
    const locationName = String(formData.get("locationName") || "").trim();
    if (!locationId || !token) {
      return { ok: false, error: "Location ID and Private Integration Token are required." };
    }
    const probe = await probeHighLevelLocation(token, locationId);
    const connection = await upsertConnection({
      companyId: ctx.company.id,
      providerKey: HIGHLEVEL_PROVIDER_KEY,
      status: probe.ok ? "CONNECTED" : "ERROR",
      accountLabel: probe.ok ? probe.location.name || locationName || "HighLevel location" : locationName || null,
      externalAccountId: locationId,
      scopes: ["private_token"],
      healthMessage: probe.ok
        ? "Connected with a location Private Integration Token (testing / single-location)."
        : probe.error,
      errorMessage: probe.ok ? null : probe.error,
    });
    await saveConnectionTokens({
      companyId: ctx.company.id,
      connectionId: connection.id,
      tokens: { accessToken: token, scopes: ["private_token"] },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: probe.ok ? "highlevel.connected" : "highlevel.connect_failed",
      entityType: "IntegrationConnection",
      entityId: connection.id,
      metadata: { mode: "private_token", locationId },
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
    const connection = await prisma.integrationConnection.findFirst({
      where: { companyId: ctx.company.id, providerKey: HIGHLEVEL_PROVIDER_KEY },
      include: { credentials: true },
    });
    if (!connection?.externalAccountId || !connection.credentials) {
      return { ok: false, error: "HighLevel is not connected." };
    }
    const { decryptProviderTokens } = await import("@/lib/integrations/crypto");
    const tokens = decryptProviderTokens({
      ciphertext: Buffer.from(connection.credentials.ciphertext),
      iv: Buffer.from(connection.credentials.iv),
      authTag: Buffer.from(connection.credentials.authTag),
      keyVersion: connection.credentials.keyVersion,
    });
    const probe = await probeHighLevelLocation(tokens.accessToken, connection.externalAccountId);
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
    const result = await sendCompanyCommunication({
      companyId: ctx.company.id,
      channel: "SMS",
      to,
      body,
      customerId,
      leadId,
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
      ? { ok: true, message: `Text sent through ${result.provider}.` }
      : { ok: false, error: result.error };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    throw error;
  }
}
