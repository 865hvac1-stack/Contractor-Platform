"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/tenant";
import { AuthError } from "@/lib/auth";
import { dollarsToCents } from "@/lib/money";
import { applyCompensation } from "@/lib/compensation/apply";
import { isHistoricalImport } from "@/lib/imports/safety";
import type { ActionResult } from "@/server/actions/auth";
import type { CustomerMembershipStatus } from "@prisma/client";

function emptyToNull(v?: string | null) {
  return v && v.trim() ? v.trim() : null;
}

export async function createMembershipPlanAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("memberships:manage");
    const name = String(formData.get("name") || "").trim();
    if (!name) return { ok: false, error: "Plan name is required." };
    const plan = await prisma.membershipPlan.create({
      data: {
        companyId: ctx.company.id,
        name,
        description: emptyToNull(String(formData.get("description") || "")),
        priceCents: dollarsToCents(String(formData.get("price") || "0")),
        billingFrequency: String(formData.get("billingFrequency") || "ANNUAL"),
        includedVisits: String(formData.get("includedVisits") || "")
          ? Number(formData.get("includedVisits"))
          : null,
        discountPercent: Number(formData.get("discountPercent") || 0) || 0,
        priorityService: String(formData.get("priorityService") || "") === "true",
        benefits: emptyToNull(String(formData.get("benefits") || "")),
        terms: emptyToNull(String(formData.get("terms") || "")),
      },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "membership.plan_created",
      entityType: "MembershipPlan",
      entityId: plan.id,
      metadata: { name },
    });
    revalidatePath("/memberships");
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function updateMembershipPlanAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("memberships:manage");
    const id = String(formData.get("id") || "");
    const plan = await prisma.membershipPlan.findFirst({
      where: { id, companyId: ctx.company.id },
    });
    if (!plan) return { ok: false, error: "Plan not found." };
    await prisma.membershipPlan.update({
      where: { id },
      data: {
        name: String(formData.get("name") || plan.name).trim() || plan.name,
        description: emptyToNull(String(formData.get("description") || "")),
        priceCents: dollarsToCents(String(formData.get("price") || plan.priceCents / 100)),
        billingFrequency: String(formData.get("billingFrequency") || plan.billingFrequency),
        includedVisits: String(formData.get("includedVisits") || "")
          ? Number(formData.get("includedVisits"))
          : null,
        discountPercent: Number(formData.get("discountPercent") || plan.discountPercent),
        priorityService: String(formData.get("priorityService") || "") === "true",
        benefits: emptyToNull(String(formData.get("benefits") || "")),
        terms: emptyToNull(String(formData.get("terms") || "")),
        active: String(formData.get("active") || "true") !== "false",
      },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "membership.plan_updated",
      entityType: "MembershipPlan",
      entityId: id,
    });
    revalidatePath("/memberships");
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function sellMembershipAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("memberships:manage");
    const customerId = String(formData.get("customerId") || "");
    const planId = String(formData.get("planId") || "");
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, companyId: ctx.company.id },
    });
    if (!customer) return { ok: false, error: "Customer not found." };
    const plan = await prisma.membershipPlan.findFirst({
      where: { id: planId, companyId: ctx.company.id, active: true },
    });
    if (!plan) return { ok: false, error: "Membership plan not found." };
    const propertyId = emptyToNull(String(formData.get("propertyId") || ""));
    const sourceJobId = emptyToNull(String(formData.get("jobId") || ""));
    const sourceEstimateId = emptyToNull(String(formData.get("estimateId") || ""));
    const sourceInvoiceId = emptyToNull(String(formData.get("invoiceId") || ""));
    const startNow = String(formData.get("activate") || "") === "true";
    const startDate = startNow ? new Date() : null;
    const renewalDate =
      startDate && plan.billingFrequency === "ANNUAL"
        ? new Date(startDate.getTime() + 365 * 24 * 60 * 60 * 1000)
        : startDate && plan.billingFrequency === "MONTHLY"
          ? new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000)
          : null;
    const membership = await prisma.customerMembership.create({
      data: {
        companyId: ctx.company.id,
        customerId,
        propertyId,
        planId: plan.id,
        soldById: ctx.user.id,
        sourceJobId,
        sourceEstimateId,
        sourceInvoiceId,
        status: startNow ? "ACTIVE" : "PENDING",
        priceCents: plan.priceCents,
        startDate,
        renewalDate,
      },
    });
    if (!isHistoricalImport(membership.importMode)) {
      await applyCompensation({
        prisma,
        companyId: ctx.company.id,
        userId: ctx.user.id,
        trigger: "MEMBERSHIP_SOLD",
        sourceType: "MEMBERSHIP",
        sourceId: membership.id,
        saleCents: membership.priceCents,
        jobId: sourceJobId,
        customerId,
        importMode: membership.importMode,
        membershipPlanId: plan.id,
      });
    }
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "membership.sold",
      entityType: "CustomerMembership",
      entityId: membership.id,
      metadata: {
        planId: plan.id,
        customerId,
        soldById: ctx.user.id,
        sourceJobId,
        status: membership.status,
      },
    });
    revalidatePath("/memberships");
    revalidatePath(`/customers/${customerId}`);
    if (sourceJobId) revalidatePath(`/jobs/${sourceJobId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function updateMembershipStatusAction(
  membershipId: string,
  status: CustomerMembershipStatus
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("memberships:manage");
    const membership = await prisma.customerMembership.findFirst({
      where: { id: membershipId, companyId: ctx.company.id },
    });
    if (!membership) return { ok: false, error: "Membership not found." };
    const data: {
      status: CustomerMembershipStatus;
      startDate?: Date;
      renewalDate?: Date | null;
    } = { status };
    if (status === "ACTIVE" && !membership.startDate) {
      data.startDate = new Date();
      data.renewalDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    }
    await prisma.customerMembership.update({ where: { id: membership.id }, data });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "membership.status_changed",
      entityType: "CustomerMembership",
      entityId: membership.id,
      metadata: { from: membership.status, to: status },
    });
    revalidatePath("/memberships");
    revalidatePath(`/customers/${membership.customerId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}
