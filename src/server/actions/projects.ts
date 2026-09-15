"use server";

import { createHash, randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { AuthError } from "@/lib/auth";
import { isNextRedirect } from "@/lib/action-errors";
import { writeAudit } from "@/lib/audit";
import { nextNumber } from "@/lib/sequences";
import { dollarsToCents } from "@/lib/money";
import {
  laborCostCents,
  minutesBetween,
  PHASE_STATUSES,
  PROJECT_PHASE_TEMPLATES,
  PROJECT_TYPES,
  projectAccessFilter,
} from "@/lib/projects/core";
import { emitDomainEvent } from "@/lib/conversations/event-engine";
import { zonedLocalDateTime } from "@/lib/scheduling/time";
import { loadProject360 } from "@/lib/projects/load";
import type { ActionResult } from "@/server/actions/auth";

const ALLOWED_ASSETS = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export async function createProjectAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("projects:manage");
    const customerId = text(formData, "customerId");
    const propertyId = text(formData, "propertyId");
    const name = text(formData, "name");
    const type = text(formData, "type");
    if (!customerId || !propertyId || !name || !PROJECT_TYPES.includes(type as never)) return fail("Choose a project type, customer, property, and name.");
    const [customer, property] = await Promise.all([
      prisma.customer.findFirst({ where: { id: customerId, companyId: ctx.company.id } }),
      prisma.property.findFirst({ where: { id: propertyId, customerId, companyId: ctx.company.id } }),
    ]);
    if (!customer || !property) return fail("Customer or property is not in your company.");
    const projectManagerId = optional(formData, "projectManagerId");
    if (projectManagerId && !await prisma.membership.findFirst({ where: { companyId: ctx.company.id, userId: projectManagerId, status: "ACTIVE" } })) {
      return fail("Project manager is not active in your company.");
    }
    const requestedPhases = formData.getAll("phases").map(String).map((value) => value.trim()).filter(Boolean);
    const phases = requestedPhases.length ? requestedPhases : PROJECT_PHASE_TEMPLATES[type as keyof typeof PROJECT_PHASE_TEMPLATES];
    const projectNumber = await nextNumber(ctx.company.id, "PROJECT", "PRJ");
    const project = await prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          companyId: ctx.company.id,
          customerId,
          propertyId,
          projectNumber,
          name: name.slice(0, 180),
          type,
          builderName: optional(formData, "builderName"),
          primaryContactName: optional(formData, "primaryContactName"),
          primaryContactPhone: optional(formData, "primaryContactPhone"),
          projectManagerId,
          originalContractCents: money(formData, "originalContract"),
          laborBudgetMinutes: hoursToMinutes(formData.get("laborBudgetHours")),
          laborBudgetCostCents: optionalMoney(formData, "laborBudgetCost"),
          equipmentBudgetCents: optionalMoney(formData, "equipmentBudget"),
          materialsBudgetCents: optionalMoney(formData, "materialsBudget"),
          otherBudgetCents: optionalMoney(formData, "otherBudget"),
          estimatedStart: date(formData, "estimatedStart"),
          targetCompletion: date(formData, "targetCompletion"),
          createdById: ctx.user.id,
          phases: { create: phases.map((phaseName, sortOrder) => ({ companyId: ctx.company.id, name: phaseName.slice(0, 120), sortOrder, status: sortOrder === 0 ? "READY" : "NOT_STARTED" })) },
        },
      });
      await tx.projectActivity.create({ data: { companyId: ctx.company.id, projectId: created.id, actorId: ctx.user.id, event: "PROJECT_CREATED", summary: `${projectNumber} created` } });
      return created;
    });
    await writeAudit({ companyId: ctx.company.id, actorId: ctx.user.id, action: "project.created", entityType: "Project", entityId: project.id, metadata: { projectNumber, type } });
    await emitProjectEvent(ctx.company.id, "PROJECT_CREATED", project.id, customerId);
    redirect(`/projects/${project.id}`);
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    return actionError(error, "Could not create the project.");
  }
}

export async function updateProjectPhaseAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("projects:manage");
    const phase = await tenantPhase(ctx.company.id, text(formData, "phaseId"));
    if (!phase) return fail("Project phase not found.");
    const status = text(formData, "status");
    if (!PHASE_STATUSES.includes(status as never)) return fail("Choose a valid phase status.");
    const waitingReason = optional(formData, "waitingReason");
    if (["WAITING", "BLOCKED"].includes(status) && !waitingReason) return fail("Add why this phase is waiting or blocked.");
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.projectPhase.update({
        where: { id: phase.id },
        data: {
          name: optional(formData, "name") || phase.name,
          status,
          waitingReason: ["WAITING", "BLOCKED"].includes(status) ? waitingReason : null,
          notes: optional(formData, "notes"),
          laborBudgetMinutes: hoursToMinutes(formData.get("laborBudgetHours")),
          laborBudgetCostCents: optionalMoney(formData, "laborBudgetCost"),
          plannedStart: date(formData, "plannedStart"),
          plannedCompletion: date(formData, "plannedCompletion"),
          actualStart: status === "IN_PROGRESS" && !phase.actualStart ? now : phase.actualStart,
          actualCompletion: status === "COMPLETE" ? now : null,
        },
      });
      if (status === "IN_PROGRESS" && phase.project.status !== "IN_PROGRESS") {
        await tx.project.update({ where: { id: phase.projectId }, data: { status: "IN_PROGRESS", actualStart: phase.project.actualStart || now } });
      } else if (status === "WAITING" || status === "BLOCKED") {
        await tx.project.update({ where: { id: phase.projectId }, data: { status: "WAITING" } });
      } else if (status === "COMPLETE") {
        const nextPhase = await tx.projectPhase.findFirst({ where: { projectId: phase.projectId, sortOrder: { gt: phase.sortOrder }, status: "NOT_STARTED" }, orderBy: { sortOrder: "asc" } });
        if (nextPhase) await tx.projectPhase.update({ where: { id: nextPhase.id }, data: { status: "READY" } });
        await tx.project.update({
          where: { id: phase.projectId },
          data: { status: !nextPhase || /punch|final/i.test(nextPhase.name) ? "PUNCH_FINAL" : "IN_PROGRESS", nextStep: null, nextStepOverride: false },
        });
      }
      await tx.projectActivity.create({ data: { companyId: ctx.company.id, projectId: phase.projectId, phaseId: phase.id, actorId: ctx.user.id, event: `PHASE_${status}`, summary: `${phase.name} changed to ${friendly(status)}${waitingReason ? ` — ${waitingReason}` : ""}` } });
    });
    await writeAudit({ companyId: ctx.company.id, actorId: ctx.user.id, action: "project.phase_updated", entityType: "ProjectPhase", entityId: phase.id, metadata: { from: phase.status, to: status } });
    const event = status === "COMPLETE" ? "PROJECT_PHASE_COMPLETED" : status === "IN_PROGRESS" ? "PROJECT_PHASE_STARTED" : status === "BLOCKED" ? "PROJECT_BLOCKED" : status === "READY" ? "PROJECT_PHASE_READY" : null;
    if (event) await emitProjectEvent(ctx.company.id, event, phase.projectId, phase.project.customerId, phase.id);
    refreshProject(phase.projectId);
    return { ok: true, message: "Phase updated." };
  } catch (error) {
    return actionError(error, "Could not update the phase.");
  }
}

export async function addProjectPhaseAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("projects:manage");
    const project = await tenantProject(ctx.company.id, text(formData, "projectId"));
    const name = text(formData, "name");
    if (!project || !name) return fail("Project and phase name are required.");
    const last = await prisma.projectPhase.aggregate({ where: { companyId: ctx.company.id, projectId: project.id }, _max: { sortOrder: true } });
    const phase = await prisma.projectPhase.create({ data: { companyId: ctx.company.id, projectId: project.id, name: name.slice(0, 120), sortOrder: (last._max.sortOrder ?? -1) + 1 } });
    await activity(ctx.company.id, project.id, ctx.user.id, "PHASE_ADDED", `${phase.name} added`, phase.id);
    refreshProject(project.id);
    return { ok: true, message: "Phase added." };
  } catch (error) {
    return actionError(error, "Could not add the phase.");
  }
}

export async function setProjectNextStepAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("projects:manage");
    const project = await tenantProject(ctx.company.id, text(formData, "projectId"));
    const nextStep = text(formData, "nextStep");
    if (!project || !nextStep) return fail("Add the next step.");
    await prisma.project.update({ where: { id: project.id }, data: { nextStep: nextStep.slice(0, 500), nextStepOverride: true } });
    await activity(ctx.company.id, project.id, ctx.user.id, "NEXT_STEP_SET", `Next step: ${nextStep.slice(0, 500)}`);
    refreshProject(project.id);
    return { ok: true, message: "Next step updated." };
  } catch (error) {
    return actionError(error, "Could not update the next step.");
  }
}

export async function addProjectContactAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("projects:manage");
    const project = await tenantProject(ctx.company.id, text(formData, "projectId"));
    const name = text(formData, "name");
    if (!project || !name) return fail("Project and contact name are required.");
    const contact = await prisma.projectContact.create({ data: { companyId: ctx.company.id, projectId: project.id, role: text(formData, "role") || "OTHER", name: name.slice(0, 160), companyName: optional(formData, "companyName"), phone: optional(formData, "phone"), email: optional(formData, "email"), isPrimary: formData.get("isPrimary") === "true" } });
    await activity(ctx.company.id, project.id, ctx.user.id, "CONTACT_ADDED", `${friendly(contact.role)} contact added: ${contact.name}`);
    refreshProject(project.id);
    return { ok: true, message: "Project contact added." };
  } catch (error) {
    return actionError(error, "Could not add the contact.");
  }
}

export async function scheduleProjectVisitAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("projects:manage");
    if (!can(ctx.role, "schedule:manage")) return fail("You do not have permission to schedule visits.");
    const project = await tenantProject(ctx.company.id, text(formData, "projectId"));
    const phase = await tenantPhase(ctx.company.id, text(formData, "phaseId"));
    if (!project || !phase || phase.projectId !== project.id) return fail("Choose a phase from this project.");
    const assigneeIds = [...new Set(formData.getAll("assigneeIds").map(String).filter(Boolean))];
    const validMembers = await prisma.membership.findMany({ where: { companyId: ctx.company.id, userId: { in: assigneeIds }, status: "ACTIVE" }, select: { userId: true } });
    if (validMembers.length !== assigneeIds.length) return fail("One or more crew members are not active in your company.");
    const scheduledStart = localDateTime(formData, "scheduledStart", ctx.company.timezone);
    const scheduledEnd = localDateTime(formData, "scheduledEnd", ctx.company.timezone);
    const purpose = text(formData, "purpose");
    if (!scheduledStart || !purpose) return fail("Choose a start time and visit purpose.");
    const jobNumber = await nextNumber(ctx.company.id, "JOB", "JOB");
    const job = await prisma.$transaction(async (tx) => {
      const created = await tx.job.create({
        data: {
          companyId: ctx.company.id,
          customerId: project.customerId,
          propertyId: project.propertyId,
          jobNumber,
          jobType: "PROJECT_VISIT",
          source: "PROJECT",
          description: purpose.slice(0, 500),
          internalNotes: optional(formData, "notes"),
          status: "SCHEDULED",
          scheduledStart,
          scheduledEnd,
          projectId: project.id,
          projectPhaseId: phase.id,
          projectVisitPurpose: purpose.slice(0, 200),
          assignments: assigneeIds.length ? { create: assigneeIds.map((userId) => ({ userId })) } : undefined,
        },
      });
      await tx.projectActivity.create({ data: { companyId: ctx.company.id, projectId: project.id, phaseId: phase.id, actorId: ctx.user.id, event: "VISIT_SCHEDULED", summary: `${purpose} scheduled as ${jobNumber}`, details: { jobId: created.id, scheduledStart: scheduledStart.toISOString() } } });
      return created;
    });
    await writeAudit({ companyId: ctx.company.id, actorId: ctx.user.id, action: "project.visit_scheduled", entityType: "Job", entityId: job.id, metadata: { projectId: project.id, phaseId: phase.id } });
    await emitProjectEvent(ctx.company.id, "PROJECT_VISIT_SCHEDULED", project.id, project.customerId, phase.id, job.id);
    refreshProject(project.id);
    revalidatePath("/jobs");
    return { ok: true, message: `Project visit ${jobNumber} scheduled in Jobs & Dispatch.` };
  } catch (error) {
    return actionError(error, "Could not schedule the project visit.");
  }
}

export async function startProjectWorkAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("project_labor:clock");
    const project = await accessibleProject(ctx.company.id, ctx.role, ctx.user.id, text(formData, "projectId"));
    const phaseId = optional(formData, "phaseId");
    const employeeId = can(ctx.role, "project_labor:manage") ? optional(formData, "employeeId") || ctx.user.id : ctx.user.id;
    if (!project) return fail("Project not found or unavailable.");
    if (phaseId && !await prisma.projectPhase.findFirst({ where: { id: phaseId, projectId: project.id, companyId: ctx.company.id } })) return fail("Phase not found.");
    const member = await prisma.membership.findFirst({ where: { companyId: ctx.company.id, userId: employeeId, status: "ACTIVE" }, include: { user: true } });
    if (!member) return fail("Crew member not found.");
    const active = await prisma.projectLaborEntry.findFirst({ where: { companyId: ctx.company.id, employeeId, endedAt: null }, include: { project: true } });
    if (active) return fail(`${member.user.firstName} is already clocked into ${active.project.name} since ${active.startedAt.toLocaleTimeString()}. End or correct that clock first.`);
    const now = new Date();
    const rate = member.internalJobCostRateCents ?? member.user.loadedLaborCostCents ?? 0;
    const entry = await prisma.projectLaborEntry.create({
      data: { companyId: ctx.company.id, projectId: project.id, phaseId, jobId: optional(formData, "jobId"), employeeId, workDate: workDateForTimeZone(now, ctx.company.timezone), startedAt: now, internalCostRateCents: rate, workCategory: optional(formData, "workCategory"), notes: optional(formData, "notes"), source: employeeId === ctx.user.id ? "TECH_CLOCK" : "CREW_CLOCK", createdById: ctx.user.id },
    });
    await activity(ctx.company.id, project.id, ctx.user.id, "LABOR_STARTED", `${member.user.firstName} ${member.user.lastName} started work`, phaseId, { laborEntryId: entry.id });
    refreshProject(project.id);
    return { ok: true, message: `Work started for ${member.user.firstName}.` };
  } catch (error) {
    return actionError(error, "Could not start work.");
  }
}

export async function startProjectCrewAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("project_labor:manage");
    const project = await tenantProject(ctx.company.id, text(formData, "projectId"));
    const phaseId = optional(formData, "phaseId");
    const employeeIds = [...new Set(formData.getAll("employeeIds").map(String).filter(Boolean))];
    if (!project || !employeeIds.length) return fail("Choose a project and at least one crew member.");
    if (phaseId && !await prisma.projectPhase.findFirst({ where: { id: phaseId, projectId: project.id, companyId: ctx.company.id } })) return fail("Phase not found.");
    const members = await prisma.membership.findMany({ where: { companyId: ctx.company.id, userId: { in: employeeIds }, status: "ACTIVE" }, include: { user: true } });
    if (members.length !== employeeIds.length) return fail("One or more crew members are unavailable.");
    const active = await prisma.projectLaborEntry.findFirst({ where: { companyId: ctx.company.id, employeeId: { in: employeeIds }, endedAt: null }, include: { employee: true, project: true } });
    if (active) return fail(`${active.employee.firstName} is already clocked into ${active.project.name}. Crew start was not created.`);
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.projectLaborEntry.createMany({
        data: members.map((member) => ({ companyId: ctx.company.id, projectId: project.id, phaseId, employeeId: member.userId, workDate: workDateForTimeZone(now, ctx.company.timezone), startedAt: now, internalCostRateCents: member.internalJobCostRateCents ?? member.user.loadedLaborCostCents ?? 0, source: "CREW_CLOCK", createdById: ctx.user.id })),
      });
      await tx.projectActivity.create({ data: { companyId: ctx.company.id, projectId: project.id, phaseId, actorId: ctx.user.id, event: "CREW_STARTED", summary: `${members.length} crew members started work`, details: { employeeIds } } });
    });
    refreshProject(project.id);
    return { ok: true, message: `${members.length} individual crew clocks started.` };
  } catch (error) {
    return actionError(error, "Could not start the crew.");
  }
}

export async function endProjectWorkAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("project_labor:clock");
    const entry = await prisma.projectLaborEntry.findFirst({ where: { id: text(formData, "laborEntryId"), companyId: ctx.company.id, endedAt: null }, include: { employee: true } });
    if (!entry) return fail("Active labor clock not found.");
    if (entry.employeeId !== ctx.user.id && !can(ctx.role, "project_labor:manage")) return fail("You can only end your own clock.");
    const endedAt = localDateTime(formData, "endedAt", ctx.company.timezone) || new Date();
    const breakMinutes = Math.max(0, Number(formData.get("breakMinutes") || 0));
    const totalMinutes = minutesBetween(entry.startedAt, endedAt, breakMinutes);
    if (!totalMinutes) return fail("End time must be after start time and break.");
    await prisma.projectLaborEntry.update({ where: { id: entry.id }, data: { endedAt, breakMinutes, totalMinutes, internalLaborCostCents: laborCostCents(totalMinutes, entry.internalCostRateCents), notes: optional(formData, "notes") || entry.notes } });
    await activity(ctx.company.id, entry.projectId, ctx.user.id, "LABOR_ENDED", `${entry.employee.firstName} ${entry.employee.lastName} ended work (${(totalMinutes / 60).toFixed(2)} hours)`, entry.phaseId, { laborEntryId: entry.id });
    await maybeEmitLaborOverBudget(ctx.company.id, entry.projectId, entry.id);
    refreshProject(entry.projectId);
    return { ok: true, message: `Clock ended at ${(totalMinutes / 60).toFixed(2)} hours.` };
  } catch (error) {
    return actionError(error, "Could not end work.");
  }
}

export async function addManualProjectLaborAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("project_labor:manage");
    const project = await tenantProject(ctx.company.id, text(formData, "projectId"));
    const employeeId = text(formData, "employeeId");
    const startedAt = localDateTime(formData, "startedAt", ctx.company.timezone);
    const endedAt = localDateTime(formData, "endedAt", ctx.company.timezone);
    if (!project || !employeeId || !startedAt || !endedAt) return fail("Project, employee, start, and end are required.");
    const member = await prisma.membership.findFirst({ where: { companyId: ctx.company.id, userId: employeeId, status: "ACTIVE" }, include: { user: true } });
    if (!member) return fail("Employee not found.");
    const overlap = await prisma.projectLaborEntry.findFirst({ where: { companyId: ctx.company.id, employeeId, startedAt: { lt: endedAt }, OR: [{ endedAt: null }, { endedAt: { gt: startedAt } }] } });
    if (overlap) return fail("This employee already has overlapping project time.");
    const breakMinutes = Math.max(0, Number(formData.get("breakMinutes") || 0));
    const totalMinutes = minutesBetween(startedAt, endedAt, breakMinutes);
    if (!totalMinutes) return fail("Enter a valid time range.");
    const rate = member.internalJobCostRateCents ?? member.user.loadedLaborCostCents ?? 0;
    const entry = await prisma.projectLaborEntry.create({ data: { companyId: ctx.company.id, projectId: project.id, phaseId: optional(formData, "phaseId"), employeeId, workDate: workDateForTimeZone(startedAt, ctx.company.timezone), startedAt, endedAt, breakMinutes, totalMinutes, internalCostRateCents: rate, internalLaborCostCents: laborCostCents(totalMinutes, rate), source: "MANUAL", createdById: ctx.user.id, notes: optional(formData, "notes") } });
    await activity(ctx.company.id, project.id, ctx.user.id, "LABOR_ADDED_MANUALLY", `${member.user.firstName} ${member.user.lastName}: ${(totalMinutes / 60).toFixed(2)} hours`, entry.phaseId, { laborEntryId: entry.id });
    await maybeEmitLaborOverBudget(ctx.company.id, project.id, entry.id);
    refreshProject(project.id);
    return { ok: true, message: "Manual labor added with an audit trail." };
  } catch (error) {
    return actionError(error, "Could not add labor.");
  }
}

export async function correctProjectLaborAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("project_labor:manage");
    const entry = await prisma.projectLaborEntry.findFirst({ where: { id: text(formData, "laborEntryId"), companyId: ctx.company.id } });
    const reason = text(formData, "reason");
    const startedAt = localDateTime(formData, "startedAt", ctx.company.timezone);
    const endedAt = localDateTime(formData, "endedAt", ctx.company.timezone);
    if (!entry || !reason || !startedAt || !endedAt) return fail("Entry, corrected times, and reason are required.");
    const overlap = await prisma.projectLaborEntry.findFirst({ where: { companyId: ctx.company.id, employeeId: entry.employeeId, id: { not: entry.id }, startedAt: { lt: endedAt }, OR: [{ endedAt: null }, { endedAt: { gt: startedAt } }] } });
    if (overlap) return fail("Corrected time overlaps another project labor entry.");
    const breakMinutes = Math.max(0, Number(formData.get("breakMinutes") || 0));
    const totalMinutes = minutesBetween(startedAt, endedAt, breakMinutes);
    if (!totalMinutes) return fail("Enter a valid corrected time range.");
    const before = laborSnapshot(entry);
    const after = { startedAt, endedAt, breakMinutes, totalMinutes, internalLaborCostCents: laborCostCents(totalMinutes, entry.internalCostRateCents), notes: optional(formData, "notes") || entry.notes };
    await prisma.$transaction(async (tx) => {
      await tx.projectLaborRevision.create({ data: { companyId: ctx.company.id, laborEntryId: entry.id, changedById: ctx.user.id, reason: reason.slice(0, 500), before, after: after as Prisma.InputJsonValue } });
      await tx.projectLaborEntry.update({ where: { id: entry.id }, data: { ...after, editedById: ctx.user.id, editReason: reason.slice(0, 500), source: "ADMIN_CORRECTION" } });
      await tx.projectActivity.create({ data: { companyId: ctx.company.id, projectId: entry.projectId, phaseId: entry.phaseId, actorId: ctx.user.id, event: "LABOR_CORRECTED", summary: `Labor corrected: ${reason.slice(0, 300)}`, details: { laborEntryId: entry.id } } });
    });
    await maybeEmitLaborOverBudget(ctx.company.id, entry.projectId, entry.id);
    refreshProject(entry.projectId);
    return { ok: true, message: "Labor corrected. Original values were preserved." };
  } catch (error) {
    return actionError(error, "Could not correct labor.");
  }
}

export async function setInternalJobCostRateAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("project_labor_cost:manage");
    const userId = text(formData, "userId");
    const membership = await prisma.membership.findFirst({ where: { companyId: ctx.company.id, userId, status: "ACTIVE" } });
    if (!membership) return fail("Employee not found.");
    const rate = optionalMoney(formData, "hourlyRate");
    await prisma.membership.update({ where: { id: membership.id }, data: { internalJobCostRateCents: rate } });
    await writeAudit({ companyId: ctx.company.id, actorId: ctx.user.id, action: "project.internal_cost_rate_updated", entityType: "Membership", entityId: membership.id, metadata: { rateConfigured: rate != null } });
    revalidatePath("/projects");
    return { ok: true, message: "Internal job cost rate updated. Historical labor entries were not changed." };
  } catch (error) {
    return actionError(error, "Could not update the internal cost rate.");
  }
}

export async function addProjectCostAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("projects:financial_manage");
    const project = await tenantProject(ctx.company.id, text(formData, "projectId"));
    const amountCents = money(formData, "amount");
    const description = text(formData, "description");
    const status = text(formData, "status") || "ACTUAL";
    if (!project || !amountCents || !description || !["ESTIMATED", "COMMITTED", "ACTUAL"].includes(status)) return fail("Add a description, amount, and valid cost status.");
    const cost = await prisma.projectCost.create({ data: { companyId: ctx.company.id, projectId: project.id, phaseId: optional(formData, "phaseId"), description: description.slice(0, 300), category: text(formData, "category") || "MISCELLANEOUS", amountCents, status, vendor: optional(formData, "vendor"), incurredAt: date(formData, "incurredAt") || new Date(), sourceType: "MANUAL", idempotencyKey: `manual:${randomUUID()}`, notes: optional(formData, "notes"), createdById: ctx.user.id } });
    await activity(ctx.company.id, project.id, ctx.user.id, "COST_ADDED", `${friendly(status)} cost added: ${description}`, cost.phaseId, { projectCostId: cost.id, amountCents });
    refreshProject(project.id);
    return { ok: true, message: "Project cost added." };
  } catch (error) {
    return actionError(error, "Could not add the project cost.");
  }
}

export async function addProjectMaterialAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("projects:manage");
    if (!can(ctx.role, "inventory:use")) return fail("You do not have permission to use Parts Bank.");
    const project = await tenantProject(ctx.company.id, text(formData, "projectId"));
    const part = await prisma.pricebookItem.findFirst({ where: { id: text(formData, "partId"), companyId: ctx.company.id, active: true, type: { in: ["MATERIAL", "PRODUCT"] } } });
    const quantity = Math.max(0, Number(formData.get("quantity") || 0));
    if (!project || !part || !Number.isInteger(quantity) || quantity < 1) return fail("Choose a Parts Bank item and quantity.");
    const material = await prisma.projectMaterial.create({ data: { companyId: ctx.company.id, projectId: project.id, phaseId: optional(formData, "phaseId"), partId: part.id, quantity, unitCostCents: part.internalCostCents || 0, status: "NEEDED", neededBy: date(formData, "neededBy"), notes: optional(formData, "notes"), createdById: ctx.user.id } });
    await activity(ctx.company.id, project.id, ctx.user.id, "MATERIAL_ADDED", `${quantity} × ${part.name} needed`, material.phaseId, { materialId: material.id });
    await emitProjectEvent(ctx.company.id, "PROJECT_MATERIAL_REQUIRED", project.id, project.customerId, material.phaseId, null, material.id);
    refreshProject(project.id);
    return { ok: true, message: "Material added from Parts Bank. Inventory has not been deducted." };
  } catch (error) {
    return actionError(error, "Could not add project material.");
  }
}

export async function updateProjectMaterialAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("projects:manage");
    const material = await prisma.projectMaterial.findFirst({ where: { id: text(formData, "materialId"), companyId: ctx.company.id }, include: { project: true, part: true } });
    const status = text(formData, "status");
    if (!material || !["NEEDED", "REQUESTED", "ORDERED", "RECEIVED", "ALLOCATED", "LOADED", "INSTALLED", "RETURNED"].includes(status)) return fail("Material not found or status invalid.");
    if (material.costTreatment === "INVENTORY_ALLOCATION" && ["ALLOCATED", "LOADED", "INSTALLED"].includes(status) && !material.linkedJobPartId) {
      return fail("Link this item to a project visit. Parts Bank must handle allocation, loading, installation, and inventory cost.");
    }
    await prisma.projectMaterial.update({ where: { id: material.id }, data: { status } });
    await activity(ctx.company.id, material.projectId, ctx.user.id, "MATERIAL_UPDATED", `${material.part.name} changed to ${friendly(status)}`, material.phaseId, { materialId: material.id });
    if (status === "RECEIVED") await emitProjectEvent(ctx.company.id, "PROJECT_MATERIAL_RECEIVED", material.projectId, material.project.customerId, material.phaseId, null, material.id);
    refreshProject(material.projectId);
    return { ok: true, message: "Material status updated." };
  } catch (error) {
    return actionError(error, "Could not update material.");
  }
}

export async function allocateProjectMaterialToVisitAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("projects:manage");
    if (!can(ctx.role, "inventory:use")) return fail("You do not have permission to allocate Parts Bank items.");
    const material = await prisma.projectMaterial.findFirst({ where: { id: text(formData, "materialId"), companyId: ctx.company.id } });
    const job = await prisma.job.findFirst({ where: { id: text(formData, "jobId"), companyId: ctx.company.id, projectId: material?.projectId } });
    if (!material || !job) return fail("Choose a project visit for this material.");
    if (material.linkedJobPartId) return { ok: true, message: "This material is already linked to a visit." };
    await prisma.$transaction(async (tx) => {
      const jobPart = await tx.jobPart.create({ data: { companyId: ctx.company.id, jobId: job.id, partId: material.partId, quantity: material.quantity, status: "NEEDED", unitCostCents: material.unitCostCents, notes: material.notes, createdById: ctx.user.id } });
      await tx.projectMaterial.update({ where: { id: material.id }, data: { linkedJobId: job.id, linkedJobPartId: jobPart.id, status: "ALLOCATED" } });
      await tx.projectActivity.create({ data: { companyId: ctx.company.id, projectId: material.projectId, phaseId: material.phaseId, actorId: ctx.user.id, event: "MATERIAL_ALLOCATED_TO_VISIT", summary: `Material linked to project visit ${job.jobNumber}`, details: { materialId: material.id, jobId: job.id, jobPartId: jobPart.id } } });
    });
    refreshProject(material.projectId);
    revalidatePath(`/jobs/${job.id}`);
    return { ok: true, message: "Material linked to the visit. Reserve and install it through the existing Job Parts workflow." };
  } catch (error) {
    return actionError(error, "Could not allocate material to the visit.");
  }
}

export async function requestProjectMaterialAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("projects:view");
    if (!can(ctx.role, "inventory:use")) return fail("You do not have permission to request materials.");
    const project = await accessibleProject(ctx.company.id, ctx.role, ctx.user.id, text(formData, "projectId"));
    const description = text(formData, "description");
    const quantity = Math.max(0, Number(formData.get("quantity") || 0));
    if (!project || !description || !Number.isInteger(quantity) || quantity < 1) return fail("Add a material and quantity.");
    const request = await prisma.projectMaterialRequest.create({ data: { companyId: ctx.company.id, projectId: project.id, phaseId: optional(formData, "phaseId"), partId: optional(formData, "partId"), description: description.slice(0, 300), quantity, neededBy: date(formData, "neededBy"), urgency: text(formData, "urgency") || "NORMAL", notes: optional(formData, "notes"), requestedById: ctx.user.id } });
    await activity(ctx.company.id, project.id, ctx.user.id, "MATERIAL_REQUESTED", `${quantity} × ${description} requested`, request.phaseId, { materialRequestId: request.id });
    await emitProjectEvent(ctx.company.id, "PROJECT_MATERIAL_REQUIRED", project.id, project.customerId, request.phaseId, null, request.id);
    refreshProject(project.id);
    return { ok: true, message: "Material request sent to the project team." };
  } catch (error) {
    return actionError(error, "Could not request material.");
  }
}

export async function uploadProjectAssetAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("project_assets:manage");
    const project = await accessibleProject(ctx.company.id, ctx.role, ctx.user.id, text(formData, "projectId"));
    const file = formData.get("file");
    if (!project || !(file instanceof File) || !file.size) return fail("Choose a project and file.");
    if (file.size > 15 * 1024 * 1024 || !ALLOWED_ASSETS.includes(file.type)) return fail("Use a JPG, PNG, WebP, or PDF under 15 MB.");
    const kind = text(formData, "kind") === "DOCUMENT" ? "DOCUMENT" : "PHOTO";
    const buffer = Buffer.from(await file.arrayBuffer());
    const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 16);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "project-file";
    const relative = path.join(ctx.company.id, "projects", project.id, `${Date.now()}-${hash}-${safeName}`);
    await mkdir(path.dirname(path.join(process.env.UPLOAD_DIR || "./uploads", relative)), { recursive: true });
    await writeFile(path.join(process.env.UPLOAD_DIR || "./uploads", relative), buffer);
    const asset = await prisma.projectAsset.create({ data: { companyId: ctx.company.id, projectId: project.id, phaseId: optional(formData, "phaseId"), jobId: optional(formData, "jobId"), kind, category: text(formData, "category") || "OTHER", title: optional(formData, "title"), note: optional(formData, "note"), fileName: file.name, filePath: relative, mimeType: file.type, fileSizeBytes: file.size, uploadedById: ctx.user.id } });
    await activity(ctx.company.id, project.id, ctx.user.id, `${kind}_ADDED`, `${kind === "PHOTO" ? "Photo" : "Document"} added: ${file.name}`, asset.phaseId, { assetId: asset.id });
    refreshProject(project.id);
    return { ok: true, message: `${kind === "PHOTO" ? "Photo" : "Document"} uploaded.` };
  } catch (error) {
    return actionError(error, "Could not upload the project file.");
  }
}

export async function addProjectIssueAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("projects:view");
    const project = await accessibleProject(ctx.company.id, ctx.role, ctx.user.id, text(formData, "projectId"));
    const title = text(formData, "title");
    if (!project || !title) return fail("Project and issue title are required.");
    const assignedToId = optional(formData, "assignedToId");
    if (assignedToId && !await prisma.membership.findFirst({ where: { companyId: ctx.company.id, userId: assignedToId, status: "ACTIVE" } })) return fail("Assigned team member is not active in your company.");
    const issue = await prisma.projectIssue.create({ data: { companyId: ctx.company.id, projectId: project.id, phaseId: optional(formData, "phaseId"), title: title.slice(0, 200), description: optional(formData, "description"), priority: text(formData, "priority") || "NORMAL", assignedToId, dueDate: date(formData, "dueDate"), createdById: ctx.user.id } });
    await activity(ctx.company.id, project.id, ctx.user.id, "ISSUE_CREATED", `Issue created: ${issue.title}`, issue.phaseId, { issueId: issue.id });
    await emitProjectEvent(ctx.company.id, "PROJECT_ISSUE_CREATED", project.id, project.customerId, issue.phaseId, null, issue.id);
    refreshProject(project.id);
    return { ok: true, message: "Project issue added." };
  } catch (error) {
    return actionError(error, "Could not add the issue.");
  }
}

export async function resolveProjectIssueAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("projects:manage");
    const issue = await prisma.projectIssue.findFirst({ where: { id: text(formData, "issueId"), companyId: ctx.company.id }, include: { project: true } });
    if (!issue) return fail("Issue not found.");
    await prisma.projectIssue.update({ where: { id: issue.id }, data: { status: "RESOLVED", resolvedAt: new Date(), resolutionNotes: optional(formData, "resolutionNotes") } });
    await activity(ctx.company.id, issue.projectId, ctx.user.id, "ISSUE_RESOLVED", `Issue resolved: ${issue.title}`, issue.phaseId, { issueId: issue.id });
    await emitProjectEvent(ctx.company.id, "PROJECT_ISSUE_RESOLVED", issue.projectId, issue.project.customerId, issue.phaseId, null, issue.id);
    refreshProject(issue.projectId);
    return { ok: true, message: "Issue resolved." };
  } catch (error) {
    return actionError(error, "Could not resolve the issue.");
  }
}

export async function addProjectChangeOrderAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("projects:financial_manage");
    const project = await tenantProject(ctx.company.id, text(formData, "projectId"));
    const title = text(formData, "title");
    if (!project || !title) return fail("Project and change-order title are required.");
    const count = await prisma.projectChangeOrder.count({ where: { companyId: ctx.company.id, projectId: project.id } });
    const row = await prisma.projectChangeOrder.create({ data: { companyId: ctx.company.id, projectId: project.id, phaseId: optional(formData, "phaseId"), number: `CO-${String(count + 1).padStart(3, "0")}`, title: title.slice(0, 200), description: optional(formData, "description"), reason: optional(formData, "reason"), revenueChangeCents: signedMoney(formData, "revenueChange"), estimatedCostChangeCents: signedMoney(formData, "estimatedCostChange"), laborMinutesChange: hoursToMinutes(formData.get("laborHoursChange")) || 0, createdById: ctx.user.id } });
    await activity(ctx.company.id, project.id, ctx.user.id, "CHANGE_ORDER_CREATED", `${row.number} created: ${row.title}`, row.phaseId, { changeOrderId: row.id });
    refreshProject(project.id);
    return { ok: true, message: "Change order saved as draft." };
  } catch (error) {
    return actionError(error, "Could not create the change order.");
  }
}

export async function updateProjectChangeOrderStatusAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("projects:financial_manage");
    const row = await prisma.projectChangeOrder.findFirst({ where: { id: text(formData, "changeOrderId"), companyId: ctx.company.id }, include: { project: true } });
    const status = text(formData, "status");
    if (!row || !["SENT", "APPROVED", "DECLINED", "VOID"].includes(status)) return fail("Change order or status invalid.");
    if (row.status === "APPROVED") return { ok: true, message: "This change order is already approved. Project value and budgets were not changed again." };
    await prisma.$transaction(async (tx) => {
      await tx.projectChangeOrder.update({ where: { id: row.id }, data: { status, approvedAt: status === "APPROVED" ? new Date() : null, approvedById: status === "APPROVED" ? ctx.user.id : null } });
      if (status === "APPROVED") {
        await tx.project.update({ where: { id: row.projectId }, data: { laborBudgetMinutes: row.laborMinutesChange ? { increment: row.laborMinutesChange } : undefined } });
      }
      await tx.projectActivity.create({ data: { companyId: ctx.company.id, projectId: row.projectId, phaseId: row.phaseId, actorId: ctx.user.id, event: `CHANGE_ORDER_${status}`, summary: `${row.number} changed to ${friendly(status)}`, details: { changeOrderId: row.id } } });
    });
    if (status === "APPROVED") await emitProjectEvent(ctx.company.id, "PROJECT_CHANGE_ORDER_APPROVED", row.projectId, row.project.customerId, row.phaseId, null, row.id);
    refreshProject(row.projectId);
    return { ok: true, message: `Change order ${friendly(status).toLowerCase()}.` };
  } catch (error) {
    return actionError(error, "Could not update the change order.");
  }
}

export async function addProjectBillingMilestoneAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("projects:financial_manage");
    const project = await tenantProject(ctx.company.id, text(formData, "projectId"));
    const name = text(formData, "name");
    const amountCents = money(formData, "amount");
    if (!project || !name || !amountCents) return fail("Milestone name and amount are required.");
    const row = await prisma.projectBillingMilestone.create({ data: { companyId: ctx.company.id, projectId: project.id, name: name.slice(0, 160), amountCents, percentBps: Number(formData.get("percent") || 0) ? Math.round(Number(formData.get("percent")) * 100) : null, dueAt: date(formData, "dueAt"), createdById: ctx.user.id } });
    await activity(ctx.company.id, project.id, ctx.user.id, "BILLING_MILESTONE_ADDED", `Billing milestone added: ${row.name}`, null, { milestoneId: row.id });
    refreshProject(project.id);
    return { ok: true, message: "Billing milestone added." };
  } catch (error) {
    return actionError(error, "Could not add billing milestone.");
  }
}

export async function markBillingMilestoneReadyAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("projects:financial_manage");
    const row = await prisma.projectBillingMilestone.findFirst({ where: { id: text(formData, "milestoneId"), companyId: ctx.company.id }, include: { project: true } });
    if (!row) return fail("Milestone not found.");
    if (row.status !== "NOT_READY") return { ok: true, message: "This milestone is already ready or billed." };
    await prisma.projectBillingMilestone.update({ where: { id: row.id }, data: { status: "READY_TO_BILL", readyAt: new Date() } });
    await activity(ctx.company.id, row.projectId, ctx.user.id, "BILLING_MILESTONE_READY", `${row.name} is ready to bill`, null, { milestoneId: row.id });
    await emitProjectEvent(ctx.company.id, "PROJECT_BILLING_MILESTONE_READY", row.projectId, row.project.customerId, null, null, row.id);
    refreshProject(row.projectId);
    return { ok: true, message: "Milestone marked ready to bill. No invoice was created automatically." };
  } catch (error) {
    return actionError(error, "Could not update the billing milestone.");
  }
}

export async function linkProjectInvoiceAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("projects:financial_manage");
    const project = await tenantProject(ctx.company.id, text(formData, "projectId"));
    const invoice = await prisma.invoice.findFirst({ where: { id: text(formData, "invoiceId"), companyId: ctx.company.id } });
    if (!project || !invoice || invoice.customerId !== project.customerId) return fail("Choose an invoice for this project's customer.");
    const milestoneId = optional(formData, "milestoneId");
    if (milestoneId && !await prisma.projectBillingMilestone.findFirst({ where: { id: milestoneId, projectId: project.id, companyId: ctx.company.id } })) return fail("Milestone not found.");
    await prisma.$transaction(async (tx) => {
      await tx.invoice.update({ where: { id: invoice.id }, data: { projectId: project.id } });
      if (milestoneId) await tx.projectBillingMilestone.update({ where: { id: milestoneId }, data: { invoiceId: invoice.id, status: invoice.amountPaidCents >= invoice.totalCents ? "PAID" : invoice.amountPaidCents > 0 ? "PARTIALLY_PAID" : "BILLED" } });
      await tx.projectActivity.create({ data: { companyId: ctx.company.id, projectId: project.id, actorId: ctx.user.id, event: "INVOICE_LINKED", summary: `Invoice ${invoice.invoiceNumber} linked to project`, details: { invoiceId: invoice.id, milestoneId } } });
    });
    refreshProject(project.id);
    return { ok: true, message: "Invoice linked. Billing and collections now roll into Project 360." };
  } catch (error) {
    return actionError(error, "Could not link the invoice.");
  }
}

export async function completeProjectAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("projects:manage");
    const project = await prisma.project.findFirst({ where: { id: text(formData, "projectId"), companyId: ctx.company.id }, include: { phases: true, issues: true, laborEntries: { where: { endedAt: null } } } });
    if (!project) return fail("Project not found.");
    const blockers = [
      project.phases.some((phase) => phase.status !== "COMPLETE") ? "all phases are not complete" : null,
      project.issues.some((issue) => issue.status !== "RESOLVED" && issue.priority === "CRITICAL") ? "critical issues remain open" : null,
      project.laborEntries.length ? "labor clocks remain active" : null,
    ].filter(Boolean);
    const overrideReason = optional(formData, "overrideReason");
    if (blockers.length && !overrideReason) return fail(`Cannot complete yet: ${blockers.join(", ")}. An authorized override requires a reason.`);
    const now = new Date();
    const finalView = await loadProject360({ companyId: ctx.company.id, projectId: project.id, role: ctx.role, userId: ctx.user.id });
    await prisma.project.update({
      where: { id: project.id },
      data: {
        status: "COMPLETE",
        completedAt: now,
        completionOverrideReason: overrideReason,
        finalSnapshot: finalView ? {
          completedAt: now.toISOString(),
          financials: finalView.financials,
          laborMinutes: finalView.actualLaborMinutes,
          laborCostCents: finalView.actualLaborCents,
          phases: finalView.project.phases.map((phase) => ({ id: phase.id, name: phase.name, status: phase.status, actualStart: phase.actualStart?.toISOString() || null, actualCompletion: phase.actualCompletion?.toISOString() || null })),
          visits: finalView.project.jobs.map((job) => ({ id: job.id, jobNumber: job.jobNumber, status: job.status })),
          issueCount: finalView.project.issues.length,
          receiptCount: finalView.project.receipts.length,
          assetCount: finalView.project.assets.length,
        } as Prisma.InputJsonValue : undefined,
      },
    });
    await activity(ctx.company.id, project.id, ctx.user.id, "PROJECT_COMPLETED", `Project completed${overrideReason ? ` with override: ${overrideReason}` : ""}`);
    await emitProjectEvent(ctx.company.id, "PROJECT_COMPLETED", project.id, project.customerId);
    refreshProject(project.id);
    return { ok: true, message: "Project completed. Its operational history remains permanent." };
  } catch (error) {
    return actionError(error, "Could not complete the project.");
  }
}

async function tenantProject(companyId: string, id: string) {
  return prisma.project.findFirst({ where: { id, companyId } });
}
async function accessibleProject(companyId: string, role: Parameters<typeof projectAccessFilter>[0], userId: string, id: string) {
  return prisma.project.findFirst({ where: { id, companyId, ...projectAccessFilter(role, userId) } });
}
async function tenantPhase(companyId: string, id: string) {
  return prisma.projectPhase.findFirst({ where: { id, companyId }, include: { project: true } });
}
async function activity(companyId: string, projectId: string, actorId: string, event: string, summary: string, phaseId?: string | null, details?: Record<string, unknown>) {
  return prisma.projectActivity.create({ data: { companyId, projectId, phaseId: phaseId || null, actorId, event, summary, details: details as Prisma.InputJsonValue | undefined } });
}
async function emitProjectEvent(companyId: string, type: string, projectId: string, customerId: string, phaseId?: string | null, jobId?: string | null, instanceId?: string | null) {
  await emitDomainEvent({ companyId, type: type as never, sourceType: "Project", sourceId: projectId, customerId, jobId, idempotencyKey: `${type.toLowerCase()}:${projectId}:${instanceId || jobId || phaseId || "project"}`, payload: { projectId, phaseId: phaseId || null, jobId: jobId || null, instanceId: instanceId || null } }).catch(() => null);
}
async function maybeEmitLaborOverBudget(companyId: string, projectId: string, instanceId: string) {
  const [project, total] = await Promise.all([
    prisma.project.findFirst({ where: { id: projectId, companyId }, select: { customerId: true, laborBudgetMinutes: true } }),
    prisma.projectLaborEntry.aggregate({ where: { companyId, projectId }, _sum: { totalMinutes: true } }),
  ]);
  if (project?.laborBudgetMinutes != null && (total._sum.totalMinutes || 0) > project.laborBudgetMinutes) {
    await emitProjectEvent(companyId, "PROJECT_LABOR_OVER_BUDGET", projectId, project.customerId, null, null, instanceId);
  }
}
function refreshProject(projectId: string) {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
}
function text(formData: FormData, key: string) {
  return String(formData.get(key) || "").trim();
}
function optional(formData: FormData, key: string) {
  return text(formData, key) || null;
}
function date(formData: FormData, key: string) {
  const value = text(formData, key);
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}
function localDateTime(formData: FormData, key: string, timeZone: string) {
  const value = text(formData, key);
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;
  return zonedLocalDateTime(timeZone, match[1], Number(match[2]) * 60 + Number(match[3]));
}
function money(formData: FormData, key: string) {
  return Math.max(0, dollarsToCents(text(formData, key)));
}
function signedMoney(formData: FormData, key: string) {
  return dollarsToCents(text(formData, key));
}
function optionalMoney(formData: FormData, key: string) {
  const value = text(formData, key);
  return value ? Math.max(0, dollarsToCents(value)) : null;
}
function hoursToMinutes(value: FormDataEntryValue | null) {
  const hours = Number(value || 0);
  return Number.isFinite(hours) && hours !== 0 ? Math.round(hours * 60) : null;
}
function workDateForTimeZone(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value || 0);
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
}
function friendly(value: string) {
  return value.toLowerCase().replaceAll("_", " ");
}
function fail(error: string): ActionResult {
  return { ok: false, error };
}
function actionError(error: unknown, fallback: string): ActionResult {
  if (error instanceof AuthError) return fail(error.message);
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return fail("That record already exists or an employee already has an active clock. Nothing was duplicated.");
  }
  return fail(error instanceof Error ? error.message : fallback);
}
function laborSnapshot(entry: { startedAt: Date; endedAt: Date | null; breakMinutes: number; totalMinutes: number | null; internalCostRateCents: number; internalLaborCostCents: number | null; notes: string | null; source: string }) {
  return { startedAt: entry.startedAt.toISOString(), endedAt: entry.endedAt?.toISOString() || null, breakMinutes: entry.breakMinutes, totalMinutes: entry.totalMinutes, internalCostRateCents: entry.internalCostRateCents, internalLaborCostCents: entry.internalLaborCostCents, notes: entry.notes, source: entry.source };
}
