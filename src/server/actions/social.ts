"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/tenant";
import { AuthError } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { getCompanyConnection, getValidAccessToken } from "@/lib/integrations/store";
import type { ActionResult } from "@/server/actions/auth";

const CHANNEL_TO_PROVIDER: Record<string, string> = {
  FACEBOOK: "facebook",
  INSTAGRAM: "instagram",
  GOOGLE_BUSINESS_PROFILE: "google_business_profile",
  TIKTOK: "tiktok",
  LINKEDIN: "linkedin",
  YOUTUBE: "youtube",
};

export async function publishSocialPostAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("marketing:manage");
    const postId = String(formData.get("postId") || "");
    const post = await prisma.socialPost.findFirst({
      where: { id: postId, companyId: ctx.company.id },
    });
    if (!post) return { ok: false, error: "Draft not found." };

    const providerKey = CHANNEL_TO_PROVIDER[post.channel];
    const connection = providerKey
      ? await getCompanyConnection(ctx.company.id, providerKey)
      : null;
    if (!connection || connection.status !== "CONNECTED") {
      return { ok: false, error: `${post.channel.replaceAll("_", " ")} is not connected.` };
    }

    await prisma.socialPostPublication.upsert({
      where: { postId_channel: { postId: post.id, channel: post.channel } },
      create: {
        companyId: ctx.company.id,
        postId: post.id,
        channel: post.channel,
        status: "PUBLISHING",
      },
      update: { status: "PUBLISHING", errorMessage: null },
    });

    let published = false;
    let externalId: string | null = null;
    let errorMessage: string | null = null;

    if (post.channel === "FACEBOOK") {
      const tokens = await getValidAccessToken({
        companyId: ctx.company.id,
        connectionId: connection.id,
        providerKey: "facebook",
      });
      const page = connection.accounts.find((account) => account.selected && account.kind === "page");
      if (!tokens || !page) {
        errorMessage = "Select a Facebook Page before publishing.";
      } else {
        const pageTokenRes = await fetch(
          `https://graph.facebook.com/v21.0/${page.externalId}?fields=access_token`,
          { headers: { Authorization: `Bearer ${tokens.accessToken}` } }
        );
        const pageTokenJson = (await pageTokenRes.json()) as {
          access_token?: string;
          error?: { message?: string };
        };
        const pageToken = pageTokenJson.access_token;
        if (!pageToken) {
          errorMessage =
            pageTokenJson.error?.message ||
            "Could not obtain a Page access token. Confirm Page admin access and pages_manage_posts.";
        } else {
          const res = await fetch(`https://graph.facebook.com/v21.0/${page.externalId}/feed`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message: post.body,
              link: post.linkUrl || undefined,
              access_token: pageToken,
            }),
          });
          const json = (await res.json()) as { id?: string; error?: { message?: string } };
          if (res.ok && json.id) {
            published = true;
            externalId = json.id;
          } else {
            errorMessage =
              json.error?.message ||
              "Facebook publishing is not approved for this Meta app. App Review is required.";
          }
        }
      }
    } else {
      errorMessage = `Publishing to ${post.channel.replaceAll("_", " ")} is waiting on provider approval or is not supported yet. The draft was not marked published.`;
    }

    await prisma.socialPostPublication.update({
      where: { postId_channel: { postId: post.id, channel: post.channel } },
      data: {
        status: published ? "PUBLISHED" : "FAILED",
        externalId,
        errorMessage,
        publishedAt: published ? new Date() : null,
      },
    });
    await prisma.socialPost.update({
      where: { id: post.id },
      data: {
        status: published ? "PUBLISHED" : "FAILED",
        publishedAt: published ? new Date() : null,
      },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: published ? "social.published" : "social.publish_failed",
      entityType: "SocialPost",
      entityId: post.id,
      metadata: { channel: post.channel },
    });
    revalidatePath("/marketing/social");
    return published ? { ok: true } : { ok: false, error: errorMessage || "Publish failed." };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}
