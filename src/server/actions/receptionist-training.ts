"use server";

import { revalidatePath } from "next/cache";
import { AuthError } from "@/lib/auth";
import { requireAnyPermission, requirePermission } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import type { ActionResult } from "@/server/actions/auth";

function refresh() {
  revalidatePath("/settings/highlevel/training");
  revalidatePath("/settings/highlevel");
}

async function requireTrainer() {
  return requirePermission("receptionist:train");
}

export async function saveKnowledgeItemAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireTrainer();
    const id = String(formData.get("id") || "");
    const data = {
      question: String(formData.get("question") || "").trim(),
      answer: String(formData.get("answer") || "").trim(),
      category: String(formData.get("category") || "FAQ").trim() || "FAQ",
      notes: String(formData.get("notes") || "").trim() || null,
      active: formData.get("active") === "on",
    };
    if (!data.question || !data.answer) return { ok: false, error: "Question and answer are required." };
    if (id) {
      await prisma.receptionistKnowledgeItem.updateMany({ where: { id, companyId: ctx.company.id }, data });
    } else {
      await prisma.receptionistKnowledgeItem.create({
        data: { companyId: ctx.company.id, createdById: ctx.user.id, ...data },
      });
    }
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "receptionist.training_knowledge",
      entityType: "ReceptionistKnowledgeItem",
      entityId: id || ctx.company.id,
      metadata: { question: data.question, active: data.active },
    });
    refresh();
    return { ok: true, message: "Knowledge saved. Regina can use it after you keep it active." };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not save knowledge." };
  }
}

export async function saveConversationRuleAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireTrainer();
    const id = String(formData.get("id") || "");
    const body = String(formData.get("body") || "").trim();
    if (!body) return { ok: false, error: "Write the rule first." };
    const data = {
      body,
      active: formData.get("active") === "on",
      priority: Number(formData.get("priority") || 100) || 100,
    };
    if (id) await prisma.receptionistConversationRule.updateMany({ where: { id, companyId: ctx.company.id }, data });
    else await prisma.receptionistConversationRule.create({ data: { companyId: ctx.company.id, createdById: ctx.user.id, ...data } });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "receptionist.training_rule",
      entityType: "ReceptionistConversationRule",
      entityId: id || ctx.company.id,
      metadata: { active: data.active },
    });
    refresh();
    return { ok: true, message: "Conversation rule saved." };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not save the rule." };
  }
}

export async function saveOpportunityRuleAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireTrainer();
    const id = String(formData.get("id") || "");
    const data = {
      type: String(formData.get("type") || "MAINTENANCE").trim(),
      title: String(formData.get("title") || "").trim(),
      triggerText: String(formData.get("triggerText") || "").trim(),
      verifiedRequirement: String(formData.get("verifiedRequirement") || "").trim(),
      suggestedBehavior: String(formData.get("suggestedBehavior") || "").trim(),
      cta: String(formData.get("cta") || "").trim() || null,
      active: formData.get("active") === "on",
      priority: Number(formData.get("priority") || 100) || 100,
    };
    if (!data.title || !data.triggerText || !data.verifiedRequirement || !data.suggestedBehavior) {
      return { ok: false, error: "Title, when, verified data, and what Regina should do are required." };
    }
    if (id) await prisma.receptionistOpportunityRule.updateMany({ where: { id, companyId: ctx.company.id }, data });
    else await prisma.receptionistOpportunityRule.create({ data: { companyId: ctx.company.id, createdById: ctx.user.id, ...data } });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "receptionist.training_opportunity",
      entityType: "ReceptionistOpportunityRule",
      entityId: id || ctx.company.id,
      metadata: { type: data.type, active: data.active },
    });
    refresh();
    return { ok: true, message: "Opportunity rule saved." };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not save the opportunity." };
  }
}

export async function saveApprovedExampleAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireTrainer();
    const id = String(formData.get("id") || "");
    const data = {
      customerMessage: String(formData.get("customerMessage") || "").trim(),
      preferredResponse: String(formData.get("preferredResponse") || "").trim(),
      intent: String(formData.get("intent") || "GENERAL_QUESTION").trim(),
      notes: String(formData.get("notes") || "").trim() || null,
      active: formData.get("active") === "on",
    };
    if (!data.customerMessage || !data.preferredResponse) return { ok: false, error: "Customer message and preferred reply are required." };
    if (id) await prisma.receptionistApprovedExample.updateMany({ where: { id, companyId: ctx.company.id }, data });
    else await prisma.receptionistApprovedExample.create({ data: { companyId: ctx.company.id, createdById: ctx.user.id, ...data } });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "receptionist.training_example",
      entityType: "ReceptionistApprovedExample",
      entityId: id || ctx.company.id,
      metadata: { intent: data.intent, active: data.active },
    });
    refresh();
    return { ok: true, message: "Approved example saved." };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not save the example." };
  }
}

export async function reviewReceptionistTurnAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireAnyPermission(["receptionist:train", "marketing:manage"]);
    const turnId = String(formData.get("turnId") || "");
    const decision = String(formData.get("decision") || "").toUpperCase();
    const improvedText = String(formData.get("improvedText") || "").trim() || null;
    const saveAs = String(formData.get("saveAs") || "");
    const turn = await prisma.receptionistTurn.findFirst({
      where: { id: turnId, companyId: ctx.company.id },
    });
    if (!turn) return { ok: false, error: "That conversation was not found." };
    if (!["GOOD", "IMPROVE", "IGNORE"].includes(decision)) return { ok: false, error: "Choose a review action." };
    if (decision === "IMPROVE" && !improvedText) return { ok: false, error: "Tell Regina what she should have said." };
    if (decision === "IMPROVE" && saveAs && !can(ctx.role, "receptionist:train")) {
      return { ok: false, error: "Only owners, admins, and managers can turn a review into training." };
    }

    await prisma.receptionistTrainingReview.create({
      data: {
        companyId: ctx.company.id,
        turnId,
        decision,
        improvedText,
        savedAs: saveAs || null,
        createdById: ctx.user.id,
      },
    });
    await prisma.receptionistTurn.update({
      where: { id: turnId },
      data: { reviewStatus: decision },
    });

    if (decision === "IMPROVE" && improvedText && saveAs === "example") {
      await prisma.receptionistApprovedExample.create({
        data: {
          companyId: ctx.company.id,
          customerMessage: String(formData.get("customerMessage") || "Customer question").trim(),
          preferredResponse: improvedText,
          intent: turn.intent || "GENERAL_QUESTION",
          notes: "Saved from review queue",
          active: true,
          createdById: ctx.user.id,
        },
      });
    }
    if (decision === "IMPROVE" && improvedText && saveAs === "knowledge") {
      await prisma.receptionistKnowledgeItem.create({
        data: {
          companyId: ctx.company.id,
          question: String(formData.get("customerMessage") || "Customer question").trim(),
          answer: improvedText,
          category: "FAQ",
          notes: "Saved from review queue",
          active: true,
          createdById: ctx.user.id,
        },
      });
    }
    if (decision === "IMPROVE" && improvedText && saveAs === "rule") {
      await prisma.receptionistConversationRule.create({
        data: {
          companyId: ctx.company.id,
          body: improvedText,
          active: true,
          priority: 50,
          createdById: ctx.user.id,
        },
      });
    }
    if (decision === "IMPROVE" && improvedText && saveAs === "opportunity") {
      await prisma.receptionistOpportunityRule.create({
        data: {
          companyId: ctx.company.id,
          type: "CUSTOM",
          title: "From review",
          triggerText: String(formData.get("customerMessage") || "Customer question").trim(),
          verifiedRequirement: "Only when ContractorYou can verify the related record",
          suggestedBehavior: improvedText,
          active: false,
          priority: 80,
          createdById: ctx.user.id,
        },
      });
    }

    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "receptionist.training_review",
      entityType: "ReceptionistTurn",
      entityId: turnId,
      metadata: { decision, saveAs: saveAs || null },
    });
    refresh();
    if (decision === "IMPROVE" && saveAs === "opportunity") {
      return { ok: true, message: "Saved as a draft opportunity. Turn it on after you review the verified-data requirement." };
    }
    return { ok: true, message: decision === "GOOD" ? "Marked as a good reply." : decision === "IGNORE" ? "Ignored." : "Saved. Regina will not change until the new item is active." };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not save the review." };
  }
}
