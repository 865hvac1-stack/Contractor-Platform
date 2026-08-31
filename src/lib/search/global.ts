import { prisma } from "@/lib/db";
import { can, type Permission } from "@/lib/permissions";
import type { CompanyRole } from "@prisma/client";
import { customerSearchWhere } from "@/lib/customers/search";
import { jobAccessFilter } from "@/lib/tenant";
import { customerLabel } from "@/lib/tech/today";

export async function globalSearch(input: {
  companyId: string;
  role: CompanyRole;
  userId: string;
  query: string;
}) {
  const q = input.query.trim();
  if (q.length < 2) return [];
  const access = jobAccessFilter(input.role, input.userId);
  const items: { type: string; href: string; title: string; detail: string }[] = [];

  if (can(input.role, "customers:view")) {
    const customers = await prisma.customer.findMany({
      where: {
        ...customerSearchWhere(input.companyId, q),
        ...(access.assignments ? { jobs: { some: { companyId: input.companyId, ...access } } } : {}),
      },
      take: 6,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        businessName: true,
        phone: true,
      },
    });
    for (const customer of customers) {
      items.push({
        type: "customer",
        href: can(input.role, "jobs:assigned_only")
          ? `/tech/customers/${customer.id}`
          : can(input.role, "reports:financial")
            ? `/customers/${customer.id}`
            : `/office/customers/${customer.id}`,
        title: customerLabel(customer),
        detail: customer.phone || "Customer",
      });
    }
  }

  if (can(input.role, "jobs:view")) {
    const jobs = await prisma.job.findMany({
      where: {
        companyId: input.companyId,
        ...access,
        OR: [
          { jobNumber: { contains: q, mode: "insensitive" } },
          { jobType: { contains: q, mode: "insensitive" } },
          { customer: { lastName: { contains: q, mode: "insensitive" } } },
        ],
      },
      take: 6,
      select: {
        id: true,
        jobNumber: true,
        jobType: true,
        customer: { select: { firstName: true, lastName: true, businessName: true } },
      },
    });
    for (const job of jobs) {
      items.push({
        type: "job",
        href: can(input.role, "jobs:assigned_only") ? `/tech/jobs/${job.id}` : `/jobs/${job.id}`,
        title: job.jobNumber,
        detail: `${job.jobType || "Job"} · ${customerLabel(job.customer)}`,
      });
    }
  }

  if (can(input.role, "invoices:view" as Permission) && !can(input.role, "jobs:assigned_only")) {
    const invoices = await prisma.invoice.findMany({
      where: { companyId: input.companyId, invoiceNumber: { contains: q, mode: "insensitive" } },
      take: 4,
      select: { id: true, invoiceNumber: true, status: true },
    });
    for (const invoice of invoices) {
      items.push({
        type: "invoice",
        href: `/invoices/${invoice.id}`,
        title: invoice.invoiceNumber,
        detail: invoice.status,
      });
    }
  }

  if (can(input.role, "estimates:view") && !can(input.role, "jobs:assigned_only")) {
    const estimates = await prisma.estimate.findMany({
      where: { companyId: input.companyId, estimateNumber: { contains: q, mode: "insensitive" } },
      take: 4,
      select: { id: true, estimateNumber: true, status: true },
    });
    for (const estimate of estimates) {
      items.push({
        type: "estimate",
        href: `/estimates/${estimate.id}`,
        title: estimate.estimateNumber,
        detail: estimate.status,
      });
    }
  }

  return items.slice(0, 16);
}
