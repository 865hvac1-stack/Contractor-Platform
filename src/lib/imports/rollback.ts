import type { PrismaClient } from "@prisma/client";

export async function rollbackImportSession(input: {
  prisma: PrismaClient;
  companyId: string;
  sessionId: string;
}): Promise<{
  customersRemoved: number;
  propertiesRemoved: number;
  jobsRemoved: number;
  estimatesRemoved: number;
  invoicesRemoved: number;
  paymentsRemoved: number;
  equipmentRemoved: number;
  expensesRemoved: number;
  blocked: number;
}> {
  const scope = { companyId: input.companyId, importSessionId: input.sessionId };
  const payments = await input.prisma.payment.deleteMany({ where: scope });
  const invoices = await input.prisma.invoice.findMany({
    where: scope,
    include: { _count: { select: { payments: true } } },
  });
  let blocked = 0;
  const safeInvoices = invoices.filter((invoice) => {
    if (invoice._count.payments > 0) {
      blocked += 1;
      return false;
    }
    return true;
  });
  await input.prisma.invoice.deleteMany({
    where: { companyId: input.companyId, id: { in: safeInvoices.map((invoice) => invoice.id) } },
  });
  const estimates = await input.prisma.estimate.deleteMany({ where: scope });
  const jobs = await input.prisma.job.findMany({
    where: scope,
    include: { _count: { select: { invoices: true, estimates: true } } },
  });
  const safeJobs = jobs.filter((job) => {
    if (job._count.invoices + job._count.estimates > 0) {
      blocked += 1;
      return false;
    }
    return true;
  });
  await input.prisma.job.deleteMany({
    where: { companyId: input.companyId, id: { in: safeJobs.map((job) => job.id) } },
  });
  const equipment = await input.prisma.equipment.deleteMany({ where: scope });
  const expenses = await input.prisma.expense.deleteMany({ where: scope });

  const customers = await input.prisma.customer.findMany({
    where: scope,
    include: { _count: { select: { jobs: true, estimates: true, invoices: true } } },
  });
  const removable = customers.filter((customer) => {
    const busy = customer._count.jobs + customer._count.estimates + customer._count.invoices;
    if (busy > 0) {
      blocked += 1;
      return false;
    }
    return true;
  });
  const ids = removable.map((customer) => customer.id);
  const properties = await input.prisma.property.deleteMany({
    where: {
      companyId: input.companyId,
      OR: [{ importSessionId: input.sessionId }, { customerId: { in: ids } }],
    },
  });
  const deleted = await input.prisma.customer.deleteMany({
    where: { companyId: input.companyId, id: { in: ids } },
  });
  await input.prisma.importExternalRef.deleteMany({
    where: { companyId: input.companyId, importSessionId: input.sessionId },
  });
  return {
    customersRemoved: deleted.count,
    propertiesRemoved: properties.count,
    jobsRemoved: safeJobs.length,
    estimatesRemoved: estimates.count,
    invoicesRemoved: safeInvoices.length,
    paymentsRemoved: payments.count,
    equipmentRemoved: equipment.count,
    expensesRemoved: expenses.count,
    blocked,
  };
}
