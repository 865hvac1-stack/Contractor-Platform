"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/tenant";
import { refreshTechnicianPerformance } from "@/lib/technician-intelligence/performance";
import { readiness } from "@/lib/technician-intelligence/core";
import type { ActionResult } from "@/server/actions/auth";

export async function saveTechnicianEvaluationAction(
  _previous: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("technician_intelligence:manage");
    const technicianId = text(formData, "technicianId");
    await requireTechnician(ctx.company.id, technicianId);
    const skillIds = formData.getAll("skillId").map(String);
    const skills = await prisma.technicianSkillDefinition.findMany({
      where: { companyId: ctx.company.id, id: { in: skillIds }, active: true },
      select: { id: true },
    });
    if (skills.length !== new Set(skillIds).size) return fail("One or more skills are unavailable.");

    const existing = await prisma.technicianIntelligenceProfile.findUnique({
      where: { companyId_technicianId: { companyId: ctx.company.id, technicianId } },
      include: { skillRatings: true },
    });
    const before = Object.fromEntries(existing?.skillRatings.map((rating) => [rating.skillId, rating.rating]) ?? []);
    const profile = await prisma.$transaction(async (tx) => {
      const result = await tx.technicianIntelligenceProfile.upsert({
        where: { companyId_technicianId: { companyId: ctx.company.id, technicianId } },
        update: {
          evaluationCompletedAt: new Date(),
          evaluationUpdatedAt: new Date(),
          evaluationCompletedById: ctx.user.id,
          notes: optional(formData, "profileNotes"),
        },
        create: {
          companyId: ctx.company.id,
          technicianId,
          evaluationCompletedAt: new Date(),
          evaluationUpdatedAt: new Date(),
          evaluationCompletedById: ctx.user.id,
          notes: optional(formData, "profileNotes"),
        },
      });
      for (const skill of skills) {
        const rating = Number(formData.get(`rating:${skill.id}`));
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) continue;
        await tx.technicianSkillRating.upsert({
          where: { profileId_skillId: { profileId: result.id, skillId: skill.id } },
          update: {
            rating,
            managerNote: optional(formData, `note:${skill.id}`),
            updatedById: ctx.user.id,
          },
          create: {
            companyId: ctx.company.id,
            profileId: result.id,
            skillId: skill.id,
            rating,
            managerNote: optional(formData, `note:${skill.id}`),
            updatedById: ctx.user.id,
          },
        });
      }
      return result;
    });
    await updateReadiness(profile.id);
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "technician_intelligence.evaluation_updated",
      entityType: "TechnicianIntelligenceProfile",
      entityId: profile.id,
      metadata: { technicianId, before, ratedSkillIds: skillIds },
    });
    refresh(technicianId);
    return { ok: true, message: "Owner evaluation saved." };
  } catch (error) {
    return fail(message(error));
  }
}

export async function saveTechnicianQualificationAction(
  _previous: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("technician_intelligence:manage");
    const technicianId = text(formData, "technicianId");
    const definitionId = text(formData, "definitionId");
    await requireTechnician(ctx.company.id, technicianId);
    const definition = await prisma.technicianQualificationDefinition.findFirst({
      where: { id: definitionId, companyId: ctx.company.id, active: true },
    });
    if (!definition) return fail("Qualification type not found.");
    const status = text(formData, "status");
    if (!["ACTIVE", "PENDING", "INACTIVE", "EXPIRED"].includes(status)) {
      return fail("Choose a valid qualification status.");
    }
    const profile = await getOrCreateProfile(ctx.company.id, technicianId);
    const existing = await prisma.technicianQualification.findUnique({
      where: { profileId_definitionId: { profileId: profile.id, definitionId } },
    });
    const qualification = await prisma.technicianQualification.upsert({
      where: { profileId_definitionId: { profileId: profile.id, definitionId } },
      update: {
        status,
        issuedDate: date(formData, "issuedDate"),
        expirationDate: date(formData, "expirationDate"),
        certificationNumber: optional(formData, "certificationNumber"),
        notes: optional(formData, "notes"),
      },
      create: {
        companyId: ctx.company.id,
        profileId: profile.id,
        definitionId,
        status,
        issuedDate: date(formData, "issuedDate"),
        expirationDate: date(formData, "expirationDate"),
        certificationNumber: optional(formData, "certificationNumber"),
        notes: optional(formData, "notes"),
        createdById: ctx.user.id,
      },
    });
    await updateReadiness(profile.id);
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "technician_intelligence.qualification_updated",
      entityType: "TechnicianQualification",
      entityId: qualification.id,
      metadata: { technicianId, definitionId, before: existing, after: qualification },
    });
    refresh(technicianId);
    return { ok: true, message: `${definition.name} saved.` };
  } catch (error) {
    return fail(message(error));
  }
}

export async function saveTechnicianPreferenceAction(
  _previous: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("technician_intelligence:manage");
    const technicianId = text(formData, "technicianId");
    const categoryId = text(formData, "categoryId");
    const preference = text(formData, "preference");
    if (!["PREFERRED", "DEVELOPMENT", "NEUTRAL"].includes(preference)) {
      return fail("Choose preferred, development, or neutral.");
    }
    await requireTechnician(ctx.company.id, technicianId);
    const category = await prisma.technicianJobCategory.findFirst({
      where: { id: categoryId, companyId: ctx.company.id, active: true },
    });
    if (!category) return fail("Call type not found.");
    const profile = await getOrCreateProfile(ctx.company.id, technicianId);
    const existing = await prisma.technicianCallPreference.findUnique({
      where: { profileId_categoryId: { profileId: profile.id, categoryId } },
    });
    if (preference === "NEUTRAL") {
      if (existing) await prisma.technicianCallPreference.delete({ where: { id: existing.id } });
    } else {
      await prisma.technicianCallPreference.upsert({
        where: { profileId_categoryId: { profileId: profile.id, categoryId } },
        update: { preference, reason: optional(formData, "reason"), changedById: ctx.user.id },
        create: {
          companyId: ctx.company.id,
          profileId: profile.id,
          categoryId,
          preference,
          reason: optional(formData, "reason"),
          changedById: ctx.user.id,
        },
      });
    }
    await updateReadiness(profile.id);
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "technician_intelligence.preference_updated",
      entityType: "TechnicianCallPreference",
      entityId: existing?.id ?? profile.id,
      metadata: { technicianId, categoryId, before: existing?.preference ?? null, after: preference },
    });
    refresh(technicianId);
    return { ok: true, message: `${category.name} preference saved.` };
  } catch (error) {
    return fail(message(error));
  }
}

export async function saveJobTypeRequirementAction(
  _previous: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("technician_intelligence:manage");
    const categoryId = text(formData, "categoryId");
    const qualificationDefinitionId = text(formData, "qualificationDefinitionId");
    const enabled = text(formData, "enabled") === "true";
    const [category, qualification] = await Promise.all([
      prisma.technicianJobCategory.findFirst({ where: { id: categoryId, companyId: ctx.company.id } }),
      prisma.technicianQualificationDefinition.findFirst({
        where: { id: qualificationDefinitionId, companyId: ctx.company.id },
      }),
    ]);
    if (!category || !qualification) return fail("Call type or qualification not found.");
    const key = { categoryId_qualificationDefinitionId: { categoryId, qualificationDefinitionId } };
    const existing = await prisma.technicianJobTypeRequirement.findUnique({ where: key });
    if (enabled && !existing) {
      await prisma.technicianJobTypeRequirement.create({
        data: { companyId: ctx.company.id, categoryId, qualificationDefinitionId, createdById: ctx.user.id },
      });
    } else if (!enabled && existing) {
      await prisma.technicianJobTypeRequirement.delete({ where: { id: existing.id } });
    }
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "technician_intelligence.requirement_updated",
      entityType: "TechnicianJobTypeRequirement",
      entityId: existing?.id,
      metadata: { categoryId, qualificationDefinitionId, before: Boolean(existing), after: enabled },
    });
    revalidatePath("/team/intelligence");
    return { ok: true, message: "Job-type requirement saved." };
  } catch (error) {
    return fail(message(error));
  }
}

export async function saveTechnicianSkillDefinitionAction(
  _previous: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("technician_intelligence:manage");
    const skillId = optional(formData, "skillId");
    const name = text(formData, "name");
    const group = text(formData, "group") || "SERVICE";
    const categoryId = optional(formData, "categoryId");
    const active = text(formData, "active") !== "false";
    if (!name) return fail("Skill name is required.");
    if (categoryId && !await prisma.technicianJobCategory.findFirst({ where: { id: categoryId, companyId: ctx.company.id } })) {
      return fail("Call type not found.");
    }
    const existing = skillId
      ? await prisma.technicianSkillDefinition.findFirst({ where: { id: skillId, companyId: ctx.company.id } })
      : null;
    const skill = existing
      ? await prisma.technicianSkillDefinition.update({
          where: { id: existing.id },
          data: { name: name.slice(0, 120), group, categoryId, active },
        })
      : await prisma.technicianSkillDefinition.create({
          data: {
            companyId: ctx.company.id,
            key: `${slug(name)}_${Date.now().toString(36).toUpperCase()}`,
            name: name.slice(0, 120),
            group,
            categoryId,
            active,
            sortOrder: await prisma.technicianSkillDefinition.count({ where: { companyId: ctx.company.id } }) + 1,
          },
        });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "technician_intelligence.skill_definition_updated",
      entityType: "TechnicianSkillDefinition",
      entityId: skill.id,
      metadata: { before: existing, after: skill },
    });
    revalidatePath("/team/intelligence");
    return { ok: true, message: existing ? "Skill updated." : "Skill added." };
  } catch (error) {
    return fail(message(error));
  }
}

export async function saveTechnicianQualificationDefinitionAction(
  _previous: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("technician_intelligence:manage");
    const name = text(formData, "name");
    if (!name) return fail("Qualification name is required.");
    const definition = await prisma.technicianQualificationDefinition.create({
      data: {
        companyId: ctx.company.id,
        key: `${slug(name)}_${Date.now().toString(36).toUpperCase()}`,
        name: name.slice(0, 120),
        sortOrder: await prisma.technicianQualificationDefinition.count({ where: { companyId: ctx.company.id } }) + 1,
      },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "technician_intelligence.qualification_definition_created",
      entityType: "TechnicianQualificationDefinition",
      entityId: definition.id,
      metadata: { name },
    });
    revalidatePath("/team/intelligence");
    return { ok: true, message: "Qualification type added." };
  } catch (error) {
    return fail(message(error));
  }
}

export async function refreshTechnicianPerformanceAction(
  _previous: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("technician_intelligence:manage");
    const technicianId = text(formData, "technicianId");
    await requireTechnician(ctx.company.id, technicianId);
    await refreshTechnicianPerformance({ companyId: ctx.company.id, technicianId });
    refresh(technicianId);
    return { ok: true, message: "Performance refreshed from completed ContractorYou jobs." };
  } catch (error) {
    return fail(message(error));
  }
}

export async function setTechnicianSmartDispatchEligibilityAction(
  _previous: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("technician_intelligence:manage");
    const technicianId = text(formData, "technicianId");
    const enabled = text(formData, "enabled") === "true";
    const reason = optional(formData, "reason");
    if (!enabled && !reason) return fail("Add a reason before disabling Smart Dispatch recommendations.");
    await requireTechnician(ctx.company.id, technicianId);
    const profile = await getOrCreateProfile(ctx.company.id, technicianId);
    const before = profile.smartDispatchEligible;
    await prisma.technicianIntelligenceProfile.update({
      where: { id: profile.id },
      data: { smartDispatchEligible: enabled },
    });
    await prisma.technicianIntelligenceOverride.create({
      data: {
        companyId: ctx.company.id,
        profileId: profile.id,
        kind: enabled ? "SMART_DISPATCH_RESTORED" : "SMART_DISPATCH_DISABLED",
        reason: reason || "Restored by authorized manager",
        changedById: ctx.user.id,
      },
    });
    await updateReadiness(profile.id);
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "technician_intelligence.smart_dispatch_eligibility_updated",
      entityType: "TechnicianIntelligenceProfile",
      entityId: profile.id,
      metadata: { technicianId, before, after: enabled, reason },
    });
    refresh(technicianId);
    return { ok: true, message: enabled ? "Smart Dispatch eligibility restored." : "Smart Dispatch recommendations disabled." };
  } catch (error) {
    return fail(message(error));
  }
}

export async function saveTechnicianRecommendationOverrideAction(
  _previous: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("technician_intelligence:manage");
    const technicianId = text(formData, "technicianId");
    const categoryId = text(formData, "categoryId");
    const active = text(formData, "active") === "true";
    const reason = optional(formData, "reason");
    if (active && !reason) return fail("Add a reason for a do-not-recommend override.");
    await requireTechnician(ctx.company.id, technicianId);
    const category = await prisma.technicianJobCategory.findFirst({
      where: { id: categoryId, companyId: ctx.company.id },
    });
    if (!category) return fail("Call type not found.");
    const profile = await getOrCreateProfile(ctx.company.id, technicianId);
    await prisma.$transaction(async (tx) => {
      await tx.technicianIntelligenceOverride.updateMany({
        where: { companyId: ctx.company.id, profileId: profile.id, categoryId, kind: "DO_NOT_RECOMMEND", active: true },
        data: { active: false },
      });
      if (active) {
        await tx.technicianIntelligenceOverride.create({
          data: {
            companyId: ctx.company.id,
            profileId: profile.id,
            categoryId,
            kind: "DO_NOT_RECOMMEND",
            reason: reason!,
            changedById: ctx.user.id,
          },
        });
      }
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "technician_intelligence.recommendation_override_updated",
      entityType: "TechnicianIntelligenceOverride",
      entityId: profile.id,
      metadata: { technicianId, categoryId, active, reason },
    });
    refresh(technicianId);
    return { ok: true, message: `${category.name} recommendation override saved.` };
  } catch (error) {
    return fail(message(error));
  }
}

async function getOrCreateProfile(companyId: string, technicianId: string) {
  return prisma.technicianIntelligenceProfile.upsert({
    where: { companyId_technicianId: { companyId, technicianId } },
    update: {},
    create: { companyId, technicianId },
  });
}

async function requireTechnician(companyId: string, technicianId: string) {
  const membership = await prisma.membership.findFirst({
    where: {
      companyId,
      userId: technicianId,
      role: { in: ["TECHNICIAN", "INSTALLER", "MANAGER"] },
    },
  });
  if (!membership) throw new Error("Technician not found in your company.");
  return membership;
}

async function updateReadiness(profileId: string) {
  const profile = await prisma.technicianIntelligenceProfile.findUniqueOrThrow({
    where: { id: profileId },
    include: { _count: { select: { skillRatings: true, qualifications: true, preferences: true } } },
  });
  const state = readiness({
    ratingCount: profile._count.skillRatings,
    qualificationCount: profile._count.qualifications,
    preferenceCount: profile._count.preferences,
    smartDispatchEligible: profile.smartDispatchEligible,
  });
  await prisma.technicianIntelligenceProfile.update({
    where: { id: profile.id },
    data: { status: state.ready ? "READY" : "NEEDS_SETUP" },
  });
}

function refresh(technicianId: string) {
  revalidatePath("/team");
  revalidatePath("/team/intelligence");
  revalidatePath(`/team/${technicianId}/intelligence`);
}

function text(formData: FormData, key: string) {
  return String(formData.get(key) || "").trim();
}
function optional(formData: FormData, key: string) {
  return text(formData, key) || null;
}
function date(formData: FormData, key: string) {
  const value = text(formData, key);
  return value ? new Date(`${value}T12:00:00.000Z`) : null;
}
function fail(error: string): ActionResult {
  return { ok: false, error };
}
function message(error: unknown) {
  return error instanceof Error ? error.message : "Could not update Technician Intelligence.";
}
function slug(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "") || "CUSTOM";
}
