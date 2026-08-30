"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/tenant";
import { AuthError } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { getProvider } from "@/lib/integrations/catalog";
import { getProviderEnv } from "@/lib/integrations/env";
import { getValidAccessToken, upsertConnection, deleteConnectionCredentials, getCompanyConnection } from "@/lib/integrations/store";
import { listProviderAccounts } from "@/lib/integrations/accounts";
import { runConnectionSync } from "@/lib/integrations/sync/engine";
import { revokeGoogleToken } from "@/lib/integrations/oauth/google";
import { revokeMetaToken } from "@/lib/integrations/oauth/meta";
import { revokeTikTokToken } from "@/lib/integrations/oauth/tiktok";
import { revokeLinkedInToken } from "@/lib/integrations/oauth/linkedin";
import { markWebsiteProductsLive } from "@/lib/integrations/forms";
import type { ActionResult } from "@/server/actions/auth";

function revalidateMarketing() {
  revalidatePath("/marketing");
  revalidatePath("/marketing/channels");
  revalidatePath("/marketing/social");
  revalidatePath("/dashboard");
}

export async function selectIntegrationAccountsAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("marketing:manage");
    const providerKey = String(formData.get("providerKey") || "");
    const selected = formData.getAll("accountId").map(String).filter(Boolean);
    const connection = await getCompanyConnection(ctx.company.id, providerKey);
    if (!connection) return { ok: false, error: "Connect this provider first." };
    if (selected.length === 0) return { ok: false, error: "Select at least one account." };

    await prisma.integrationAccount.updateMany({
      where: { companyId: ctx.company.id, connectionId: connection.id },
      data: { selected: false },
    });
    await prisma.integrationAccount.updateMany({
      where: {
        companyId: ctx.company.id,
        connectionId: connection.id,
        externalId: { in: selected },
      },
      data: { selected: true },
    });
    const labels = connection.accounts
      .filter((account) => selected.includes(account.externalId))
      .map((account) => account.name);
    await upsertConnection({
      companyId: ctx.company.id,
      providerKey,
      status: "CONNECTED",
      accountLabel: labels.join(", ") || null,
      externalAccountId: selected[0] ?? null,
      healthMessage: "Account selected. Run Sync now to import available data.",
      errorMessage: null,
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "integration.account_selected",
      entityType: "IntegrationConnection",
      entityId: connection.id,
      metadata: { providerKey, selected },
    });
    revalidateMarketing();
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function refreshIntegrationAccountsAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("marketing:manage");
    const providerKey = String(formData.get("providerKey") || "");
    const connection = await getCompanyConnection(ctx.company.id, providerKey);
    if (!connection) return { ok: false, error: "Connect this provider first." };
    const tokens = await getValidAccessToken({
      companyId: ctx.company.id,
      connectionId: connection.id,
      providerKey,
    });
    if (!tokens) return { ok: false, error: "Authorization expired. Reconnect this provider." };
    const listed = await listProviderAccounts(providerKey, tokens.accessToken);
    if (listed.error && listed.accounts.length === 0) {
      await upsertConnection({
        companyId: ctx.company.id,
        providerKey,
        status: "ERROR",
        errorMessage: listed.error,
      });
      return { ok: false, error: listed.error };
    }
    for (const account of listed.accounts) {
      await prisma.integrationAccount.upsert({
        where: {
          connectionId_kind_externalId: {
            connectionId: connection.id,
            kind: account.kind,
            externalId: account.id,
          },
        },
        create: {
          companyId: ctx.company.id,
          connectionId: connection.id,
          providerKey,
          kind: account.kind,
          externalId: account.id,
          name: account.name,
        },
        update: { name: account.name },
      });
    }
    await upsertConnection({
      companyId: ctx.company.id,
      providerKey,
      status: listed.accounts.length ? "SELECT_ACCOUNT" : connection.status,
      healthMessage: listed.error ?? "Choose the account ContractorYou should use.",
    });
    revalidateMarketing();
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function syncIntegrationAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("marketing:manage");
    const providerKey = String(formData.get("providerKey") || "");
    const result = await runConnectionSync({ companyId: ctx.company.id, providerKey, kind: "manual" });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: result.ok ? "integration.sync" : "integration.sync_failed",
      entityType: "IntegrationConnection",
      metadata: { providerKey, ...(result.ok ? { recordsOut: result.recordsOut } : { error: result.error }) },
    });
    revalidateMarketing();
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function disconnectIntegrationAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("marketing:manage");
    const providerKey = String(formData.get("providerKey") || "");
    const confirm = String(formData.get("confirm") || "");
    if (confirm !== "disconnect") {
      return { ok: false, error: "Type disconnect to confirm." };
    }
    const connection = await getCompanyConnection(ctx.company.id, providerKey);
    if (!connection) return { ok: true };
    const tokens = await getValidAccessToken({
      companyId: ctx.company.id,
      connectionId: connection.id,
      providerKey,
    }).catch(() => null);
    if (tokens?.accessToken) {
      if (providerKey.startsWith("google_") || providerKey === "youtube") {
        await revokeGoogleToken(tokens.accessToken);
      } else if (providerKey === "facebook" || providerKey === "instagram" || providerKey === "meta_ads") {
        await revokeMetaToken(tokens.accessToken);
      } else if (providerKey.startsWith("tiktok")) {
        await revokeTikTokToken(tokens.accessToken);
      } else if (providerKey === "linkedin") {
        await revokeLinkedInToken(tokens.accessToken);
      }
    }
    await deleteConnectionCredentials(ctx.company.id, connection.id);
    await prisma.integrationAccount.deleteMany({
      where: { companyId: ctx.company.id, connectionId: connection.id },
    });
    await upsertConnection({
      companyId: ctx.company.id,
      providerKey,
      status: "NOT_CONNECTED",
      accountLabel: null,
      externalAccountId: null,
      scopes: [],
      healthMessage: "Disconnected. Historical leads and reviews were kept.",
      errorMessage: null,
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "integration.disconnected",
      entityType: "IntegrationConnection",
      entityId: connection.id,
      metadata: { providerKey },
    });
    revalidateMarketing();
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function enableInternalChannelAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("marketing:manage");
    const providerKey = String(formData.get("providerKey") || "");
    const provider = getProvider(providerKey);
    if (!provider?.internalLive) return { ok: false, error: "This channel is not a ContractorYou-hosted product." };
    if (providerKey === "website_forms" || providerKey === "utm_tracking") {
      await markWebsiteProductsLive(ctx.company.id);
    } else if (providerKey === "landing_pages") {
      await upsertConnection({
        companyId: ctx.company.id,
        providerKey,
        status: "CONNECTED",
        healthMessage: "Landing pages are ready. Publish a page to start collecting leads.",
        accountLabel: "ContractorYou pages",
      });
    } else if (providerKey === "tracking_numbers") {
      const env = getProviderEnv("tracking_numbers");
      await upsertConnection({
        companyId: ctx.company.id,
        providerKey,
        status: "CONNECTED",
        healthMessage: env.missing.length
          ? "Numbers can be mapped to sources. Live call capture waits on Twilio."
          : "Tracking numbers are ready.",
        accountLabel: "Source numbers",
      });
    }
    revalidateMarketing();
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function replyToReviewAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("marketing:manage");
    const reviewId = String(formData.get("reviewId") || "");
    const comment = String(formData.get("comment") || "").trim();
    if (!comment) return { ok: false, error: "Write a reply before sending. Nothing is posted automatically." };
    const review = await prisma.review.findFirst({
      where: { id: reviewId, companyId: ctx.company.id },
    });
    if (!review || !review.externalId) return { ok: false, error: "Review not found." };
    if (review.provider !== "google_business_profile") {
      return { ok: false, error: "Replies are only implemented for Google Business Profile." };
    }
    const connection = await getCompanyConnection(ctx.company.id, "google_business_profile");
    if (!connection || connection.status !== "CONNECTED") {
      return { ok: false, error: "Connect Google Business Profile before replying." };
    }
    const tokens = await getValidAccessToken({
      companyId: ctx.company.id,
      connectionId: connection.id,
      providerKey: "google_business_profile",
    });
    if (!tokens) return { ok: false, error: "Google authorization expired. Reconnect Google." };
    const res = await fetch(`https://mybusiness.googleapis.com/v4/${review.externalId}/reply`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ comment }),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    if (!res.ok) {
      return {
        ok: false,
        error:
          json.error?.message ||
          "Google did not accept the reply. Confirm business.manage scope and GBP API approval.",
      };
    }
    await prisma.review.update({
      where: { id: review.id },
      data: { respondedAt: new Date(), needsResponse: false },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "review.replied",
      entityType: "Review",
      entityId: review.id,
      metadata: { provider: review.provider },
    });
    revalidatePath("/marketing/reviews");
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function configureEmailFromAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("marketing:manage");
    const from = String(formData.get("fromAddress") || "").trim();
    const env = getProviderEnv("email");
    if (!env.configured) {
      return { ok: false, error: "RESEND_API_KEY is not configured on the server." };
    }
    if (!from.includes("@")) return { ok: false, error: "Enter a verified from address." };
    await upsertConnection({
      companyId: ctx.company.id,
      providerKey: "email",
      status: "CONNECTED",
      accountLabel: from,
      healthMessage: "From address saved. Sends use Resend only after the domain is verified there.",
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "integration.email_configured",
      entityType: "IntegrationConnection",
      metadata: { from },
    });
    revalidateMarketing();
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}
