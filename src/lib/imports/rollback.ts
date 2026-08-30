import type { PrismaClient } from "@prisma/client";

export async function rollbackImportSession(input: {
  prisma: PrismaClient;
  companyId: string;
  sessionId: string;
}): Promise<{ customersRemoved: number; propertiesRemoved: number; blocked: number }> {
  const customers = await input.prisma.customer.findMany({
    where: { companyId: input.companyId, importSessionId: input.sessionId },
    include: {
      _count: { select: { jobs: true, estimates: true, invoices: true } },
    },
  });
  let blocked = 0;
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
    blocked,
  };
}
