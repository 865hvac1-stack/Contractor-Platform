import type { PrismaClient } from "@prisma/client";
import { DEMO_EMAIL_DOMAIN } from "@/lib/demo/constants";
import { assertResettableDemoCompany } from "@/lib/demo/guard";

export async function wipeDemoCompany(prisma: PrismaClient, companyId: string) {
  const company = await prisma.company.findFirst({
    where: { id: companyId },
    select: { id: true, isDemo: true, businessName: true },
  });
  assertResettableDemoCompany(company);

  await prisma.communicationMessage.deleteMany({ where: { companyId } });
  await prisma.communicationThread.deleteMany({ where: { companyId } });
  await prisma.reviewRequest.deleteMany({ where: { companyId } });
  await prisma.review.deleteMany({ where: { companyId } });
  await prisma.callRecord.deleteMany({ where: { companyId } });
  await prisma.socialPostPublication.deleteMany({ where: { companyId } });
  await prisma.socialPost.deleteMany({ where: { companyId } });
  await prisma.formSubmission.deleteMany({ where: { companyId } });
  await prisma.attributionEvent.deleteMany({ where: { companyId } });
  await prisma.leadActivity.deleteMany({ where: { companyId } });
  await prisma.lead.deleteMany({ where: { companyId } });
  await prisma.marketingSpend.deleteMany({ where: { companyId } });
  await prisma.campaign.deleteMany({ where: { companyId } });
  await prisma.performanceGoal.deleteMany({ where: { companyId } });
  await prisma.compensationEvent.deleteMany({ where: { companyId } });
  await prisma.compensationRuleVersion.deleteMany({ where: { companyId } });
  await prisma.compensationRule.deleteMany({ where: { companyId } });
  await prisma.customerMembership.deleteMany({ where: { companyId } });
  await prisma.payment.deleteMany({ where: { companyId } });
  await prisma.invoice.deleteMany({ where: { companyId } });
  await prisma.estimate.deleteMany({ where: { companyId } });
  await prisma.jobPhoto.deleteMany({ where: { companyId } });
  await prisma.customerNote.deleteMany({ where: { companyId } });
  await prisma.jobCost.deleteMany({ where: { companyId } });
  await prisma.jobWorkflowEvent.deleteMany({ where: { companyId } });
  await prisma.jobChecklistItem.deleteMany({ where: { companyId } });
  await prisma.jobPlaybookSnapshot.deleteMany({ where: { companyId } });
  await prisma.job.deleteMany({ where: { companyId } });
  await prisma.expense.deleteMany({ where: { companyId } });
  await prisma.receipt.deleteMany({ where: { companyId } });
  await prisma.equipment.deleteMany({ where: { companyId } });
  await prisma.property.deleteMany({ where: { companyId } });
  await prisma.customer.deleteMany({ where: { companyId } });
  await prisma.membershipPlan.deleteMany({ where: { companyId } });
  await prisma.pricebookItem.deleteMany({ where: { companyId } });
  await prisma.pricebookCategory.deleteMany({ where: { companyId } });
  await prisma.serviceType.deleteMany({ where: { companyId } });
  await prisma.playbook.updateMany({ where: { companyId }, data: { currentVersionId: null } });
  await prisma.playbookVersion.deleteMany({ where: { companyId } });
  await prisma.playbook.deleteMany({ where: { companyId } });
  await prisma.automation.deleteMany({ where: { companyId } });
  await prisma.insight.deleteMany({ where: { companyId } });
  await prisma.metricSnapshot.deleteMany({ where: { companyId } });
  await prisma.integrationAccount.deleteMany({ where: { companyId } });
  await prisma.integrationEvent.deleteMany({ where: { companyId } });
  await prisma.integrationSync.deleteMany({ where: { companyId } });
  await prisma.integrationCredential.deleteMany({ where: { companyId } });
  await prisma.integrationConnection.deleteMany({ where: { companyId } });
  await prisma.providerIdentityMap.deleteMany({ where: { companyId } });
  await prisma.vehicle.deleteMany({ where: { companyId } });
  await prisma.numberSequence.deleteMany({ where: { companyId } });
  await prisma.aIActionTarget.deleteMany({ where: { companyId } });
  await prisma.aIActionRequest.deleteMany({ where: { companyId } });
  await prisma.companyTask.deleteMany({ where: { companyId } });
  await prisma.aIActionDraft.deleteMany({ where: { companyId } });
  await prisma.aIMessage.deleteMany({ where: { companyId } });
  await prisma.aIUsageEvent.deleteMany({ where: { companyId } });
  await prisma.aIConversation.deleteMany({ where: { companyId } });
  await prisma.auditLog.deleteMany({ where: { companyId } });

  const memberships = await prisma.membership.findMany({
    where: { companyId },
    select: { id: true, userId: true, user: { select: { email: true, isPlatformAdmin: true } } },
  });
  await prisma.membership.deleteMany({ where: { companyId } });
  for (const row of memberships) {
    if (row.user.isPlatformAdmin) continue;
    if (!row.user.email.endsWith(`@${DEMO_EMAIL_DOMAIN}`)) continue;
    const other = await prisma.membership.count({ where: { userId: row.userId } });
    if (other === 0) {
      await prisma.user.delete({ where: { id: row.userId } }).catch(() => undefined);
    }
  }
}
