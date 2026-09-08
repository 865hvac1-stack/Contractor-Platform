import { prisma } from "@/lib/db";
import { can, type Permission } from "@/lib/permissions";
import type { CompanyRole } from "@prisma/client";
import { customerSearchWhere } from "@/lib/customers/search";
import { leadSearchWhere } from "@/lib/leads/search";
import { LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS } from "@/lib/leads/sources";
import { jobAccessFilter } from "@/lib/tenant";
import { customerLabel } from "@/lib/tech/today";
import { scoreAddressMatch, scoreCodeMatch, scoreNameMatch, scorePhoneMatch } from "@/lib/search/rank";

export type GlobalSearchHit = {
  type: "customer" | "job" | "estimate" | "invoice" | "property" | "lead";
  href: string;
  title: string;
  detail: string;
  score: number;
};

export type GlobalSearchGroup = {
  type: GlobalSearchHit["type"];
  label: string;
  items: GlobalSearchHit[];
  moreHref?: string | null;
};

const GROUP_LIMIT = 5;

export async function globalSearch(input: {
  companyId: string;
  role: CompanyRole;
  userId: string;
  query: string;
}) {
  const q = input.query.trim();
  if (q.length < 2) return { items: [] as GlobalSearchHit[], groups: [] as GlobalSearchGroup[] };

  const access = jobAccessFilter(input.role, input.userId);
  const assignedOnly = Boolean(access.assignments) || can(input.role, "jobs:assigned_only");
  const customerHref = (id: string) => (assignedOnly ? `/tech/customers/${id}` : `/customers/${id}`);
  const jobHref = (id: string) => (assignedOnly ? `/tech/jobs/${id}` : `/jobs/${id}`);
  const digits = q.replace(/\D/g, "");

  const groups: GlobalSearchGroup[] = [];

  if (can(input.role, "customers:view")) {
    const phoneIds = digits.length >= 3 ? await customerIdsByNormalizedPhone(input.companyId, digits) : [];
    const customerWhere = customerSearchWhere(input.companyId, q);
    if (phoneIds.length) {
      customerWhere.OR = [...(customerWhere.OR ?? []), { id: { in: phoneIds } }];
    }
    const customers = await prisma.customer.findMany({
      where: {
        ...customerWhere,
        ...(assignedOnly ? { jobs: { some: { companyId: input.companyId, ...access } } } : {}),
      },
      take: 24,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        businessName: true,
        phone: true,
        email: true,
        properties: {
          take: 3,
          orderBy: [{ isPrimary: "desc" }, { address: "asc" }],
          select: { id: true, address: true, city: true, state: true, zip: true },
        },
      },
    });

    const customerHits = customers
      .map((customer) => {
        const name = customerLabel(customer);
        const person = `${customer.firstName} ${customer.lastName}`.trim();
        const address = customer.properties[0]
          ? [customer.properties[0].address, customer.properties[0].city].filter(Boolean).join(", ")
          : "";
        const score = Math.max(
          scoreNameMatch(q, name),
          scoreNameMatch(q, person),
          scoreNameMatch(q, customer.businessName),
          scorePhoneMatch(q, customer.phone),
          scoreAddressMatch(q, address)
        );
        const detail = [customer.phone, address].filter(Boolean).join(" · ") || "Customer";
        return {
          type: "customer" as const,
          href: customerHref(customer.id),
          title: name || person,
          detail,
          score,
        };
      })
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

    const topCustomers = customerHits.slice(0, GROUP_LIMIT);
    if (topCustomers.length) {
      groups.push({
        type: "customer",
        label: "Customers",
        items: topCustomers,
        moreHref: customerHits.length > GROUP_LIMIT ? `/customers?q=${encodeURIComponent(q)}` : null,
      });
    }

    if (can(input.role, "leads:view") && !assignedOnly) {
      const leads = await prisma.lead.findMany({
        where: leadSearchWhere(input.companyId, q),
        take: 12,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          source: true,
          status: true,
          phone: true,
          email: true,
        },
      });
      const leadHits = leads
        .map((lead) => {
          const name = `${lead.firstName} ${lead.lastName}`.trim();
          return {
            type: "lead" as const,
            href: `/marketing/leads/${lead.id}`,
            title: name,
            detail: `${LEAD_SOURCE_LABELS[lead.source]} · ${LEAD_STATUS_LABELS[lead.status]}`,
            score: Math.max(scoreNameMatch(q, name), scorePhoneMatch(q, lead.phone), scoreNameMatch(q, lead.email)),
          };
        })
        .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
      const topLeads = leadHits.slice(0, GROUP_LIMIT);
      if (topLeads.length) {
        groups.push({
          type: "lead",
          label: "Leads",
          items: topLeads,
          moreHref: leadHits.length > GROUP_LIMIT ? `/marketing/leads?q=${encodeURIComponent(q)}` : null,
        });
      }
    }

    if (can(input.role, "customers:view")) {
      const propertyHits = customers
        .flatMap((customer) =>
          customer.properties.map((property) => {
            const line = [property.address, property.city, property.state].filter(Boolean).join(", ");
            const score = scoreAddressMatch(q, line);
            if (score < 70) return null;
            return {
              type: "property" as const,
              href: `${customerHref(customer.id)}?property=${property.id}`,
              title: line,
              detail: customerLabel(customer),
              score,
            };
          })
        )
        .filter((row): row is NonNullable<typeof row> => Boolean(row))
        .sort((a, b) => b.score - a.score)
        .slice(0, GROUP_LIMIT);
      if (propertyHits.length) {
        groups.push({ type: "property", label: "Properties", items: propertyHits });
      }
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
          { description: { contains: q, mode: "insensitive" } },
          { serviceType: { name: { contains: q, mode: "insensitive" } } },
          { customer: { firstName: { contains: q, mode: "insensitive" } } },
          { customer: { lastName: { contains: q, mode: "insensitive" } } },
          { customer: { businessName: { contains: q, mode: "insensitive" } } },
          { customer: { phone: { contains: q, mode: "insensitive" } } },
          ...(q.split(/\s+/).filter((token) => token.length >= 2).length >= 2
            ? [
                {
                  customer: {
                    AND: [
                      { firstName: { contains: q.split(/\s+/)[0], mode: "insensitive" as const } },
                      { lastName: { contains: q.split(/\s+/).slice(1).join(" "), mode: "insensitive" as const } },
                    ],
                  },
                },
              ]
            : []),
          { property: { address: { contains: q, mode: "insensitive" } } },
          { property: { city: { contains: q, mode: "insensitive" } } },
        ],
      },
      take: 16,
      select: {
        id: true,
        jobNumber: true,
        jobType: true,
        serviceType: { select: { name: true } },
        customer: { select: { firstName: true, lastName: true, businessName: true } },
      },
    });
    const jobHits = jobs
      .map((job) => {
        const name = customerLabel(job.customer);
        const context = job.serviceType?.name || job.jobType || "Job";
        return {
          type: "job" as const,
          href: jobHref(job.id),
          title: job.jobNumber,
          detail: `${name} · ${context}`,
          score: Math.max(scoreCodeMatch(q, job.jobNumber), scoreNameMatch(q, name)),
        };
      })
      .sort((a, b) => b.score - a.score);
    const topJobs = jobHits.slice(0, GROUP_LIMIT);
    if (topJobs.length) {
      groups.push({
        type: "job",
        label: "Jobs",
        items: topJobs,
        moreHref: jobHits.length > GROUP_LIMIT ? `/jobs?q=${encodeURIComponent(q)}` : null,
      });
    }
  }

  if (can(input.role, "estimates:view") && !assignedOnly) {
    const estimates = await prisma.estimate.findMany({
      where: {
        companyId: input.companyId,
        OR: [
          { estimateNumber: { contains: q, mode: "insensitive" } },
          { customer: { firstName: { contains: q, mode: "insensitive" } } },
          { customer: { lastName: { contains: q, mode: "insensitive" } } },
          { customer: { businessName: { contains: q, mode: "insensitive" } } },
        ],
      },
      take: 12,
      select: {
        id: true,
        estimateNumber: true,
        status: true,
        customer: { select: { firstName: true, lastName: true, businessName: true } },
      },
    });
    const estimateHits = estimates
      .map((estimate) => ({
        type: "estimate" as const,
        href: `/estimates/${estimate.id}`,
        title: estimate.estimateNumber,
        detail: `${customerLabel(estimate.customer)} · ${estimate.status}`,
        score: Math.max(scoreCodeMatch(q, estimate.estimateNumber), scoreNameMatch(q, customerLabel(estimate.customer))),
      }))
      .sort((a, b) => b.score - a.score);
    const topEstimates = estimateHits.slice(0, GROUP_LIMIT);
    if (topEstimates.length) {
      groups.push({
        type: "estimate",
        label: "Estimates",
        items: topEstimates,
        moreHref: estimateHits.length > GROUP_LIMIT ? `/estimates` : null,
      });
    }
  }

  if (can(input.role, "invoices:view" as Permission) && !assignedOnly) {
    const invoices = await prisma.invoice.findMany({
      where: {
        companyId: input.companyId,
        OR: [
          { invoiceNumber: { contains: q, mode: "insensitive" } },
          { customer: { firstName: { contains: q, mode: "insensitive" } } },
          { customer: { lastName: { contains: q, mode: "insensitive" } } },
          { customer: { businessName: { contains: q, mode: "insensitive" } } },
        ],
      },
      take: 12,
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        customer: { select: { firstName: true, lastName: true, businessName: true } },
      },
    });
    const invoiceHits = invoices
      .map((invoice) => ({
        type: "invoice" as const,
        href: `/invoices/${invoice.id}`,
        title: invoice.invoiceNumber,
        detail: `${customerLabel(invoice.customer)} · ${invoice.status}`,
        score: Math.max(scoreCodeMatch(q, invoice.invoiceNumber), scoreNameMatch(q, customerLabel(invoice.customer))),
      }))
      .sort((a, b) => b.score - a.score);
    const topInvoices = invoiceHits.slice(0, GROUP_LIMIT);
    if (topInvoices.length) {
      groups.push({
        type: "invoice",
        label: "Invoices",
        items: topInvoices,
        moreHref: invoiceHits.length > GROUP_LIMIT ? `/invoices` : null,
      });
    }
  }

  const items = groups.flatMap((group) => group.items);
  return { items, groups };
}

async function customerIdsByNormalizedPhone(companyId: string, digits: string) {
  const like = `%${digits.slice(-10)}%`;
  try {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Customer"
      WHERE "companyId" = ${companyId}
        AND (
          regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') LIKE ${like}
          OR regexp_replace(coalesce("secondaryPhone", ''), '[^0-9]', '', 'g') LIKE ${like}
        )
      LIMIT 8
    `;
    return rows.map((row) => row.id);
  } catch {
    return [];
  }
}
