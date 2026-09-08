"use server";

import { revalidatePath } from "next/cache";
import { AuthError } from "@/lib/auth";
import { requirePermission } from "@/lib/tenant";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import type { ActionResult } from "@/server/actions/auth";
import { generateAgentToolKey } from "@/lib/agent-tools/auth";

export async function generateAgentToolKeyAction(
  _prev: ActionResult | null,
  _formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("marketing:manage");
    const generated = generateAgentToolKey();
    await prisma.agentToolCredential.create({
      data: {
        companyId: ctx.company.id,
        name: "HighLevel Agent Studio",
        keyPrefix: generated.keyPrefix,
        keyHash: generated.keyHash,
        lastFour: generated.lastFour,
      },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "agent_tools.credential_created",
      entityType: "AgentToolCredential",
      entityId: ctx.company.id,
      metadata: { lastFour: generated.lastFour },
    });
    revalidatePath("/settings/highlevel");
    return {
      ok: true,
      message: `Copy this Agent Tool key now. It will not be shown again.\n${generated.plaintext}`,
    };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : "Could not create the Agent Tool key." };
  }
}

export async function revokeAgentToolKeyAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("marketing:manage");
    const id = String(formData.get("credentialId") || "");
    const row = await prisma.agentToolCredential.findFirst({
      where: { id, companyId: ctx.company.id, revokedAt: null },
      select: { id: true, lastFour: true },
    });
    if (!row) return { ok: false, error: "That Agent Tool key was not found." };
    await prisma.agentToolCredential.update({
      where: { id: row.id },
      data: { revokedAt: new Date() },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "agent_tools.credential_revoked",
      entityType: "AgentToolCredential",
      entityId: row.id,
      metadata: { lastFour: row.lastFour },
    });
    revalidatePath("/settings/highlevel");
    return { ok: true, message: `Revoked the key ending in ${row.lastFour}.` };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : "Could not revoke the Agent Tool key." };
  }
}
