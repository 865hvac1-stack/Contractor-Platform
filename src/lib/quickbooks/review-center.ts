import type { PrismaClient } from "@prisma/client";
import type { QuickBooksScope } from "@/lib/quickbooks/ownership";
import { customerFieldComparison } from "@/lib/quickbooks/analysis-classification";

type ReviewView = "review" | "duplicates" | "conflicts";

type CustomerPayload = {
  DisplayName?: string;
  GivenName?: string;
  FamilyName?: string;
  CompanyName?: string;
  PrimaryEmailAddr?: { Address?: string };
  PrimaryPhone?: { FreeFormNumber?: string };
  BillAddr?: Address;
  ShipAddr?: Address;
};

type Address = {
  Line1?: string;
  Line2?: string;
  City?: string;
  CountrySubDivisionCode?: string;
  PostalCode?: string;
};

function addressText(address?: Address | null) {
  return [
    address?.Line1,
    address?.Line2,
    address?.City,
    address?.CountrySubDivisionCode,
    address?.PostalCode,
  ]
    .filter(Boolean)
    .join(", ");
}

export async function loadQuickBooksReviewRows(
  prisma: PrismaClient,
  scope: QuickBooksScope,
  input: { view: ReviewView; filter?: string | null; search?: string | null }
) {
  const filterMap: Record<string, string> = {
    exact: "EXACT",
    high: "HIGH",
    possible: "POSSIBLE",
    new: "NONE",
    conflict: "CONFLICT",
  };
  const rows = await prisma.quickBooksImportReview.findMany({
    where: {
      companyId: scope.companyId,
      environment: scope.environment,
      realmId: scope.realmId,
      status: { in: ["OPEN", "READY", "APPROVED", "FAILED"] },
      ...(input.view === "review" ? { objectType: "CUSTOMER" } : {}),
      ...(input.view === "duplicates" ? { objectType: "CUSTOMER", confidence: "POSSIBLE" } : {}),
      ...(input.view === "conflicts"
        ? { OR: [{ confidence: "CONFLICT" }, { status: "FAILED" }] }
        : {}),
      ...(input.filter && filterMap[input.filter] ? { confidence: filterMap[input.filter] } : {}),
    },
    orderBy: [{ objectType: "asc" }, { updatedAt: "desc" }],
    take: input.search ? 4_000 : 150,
  });
  const customerIds = rows.map((row) => row.proposedInternalId).filter((id): id is string => Boolean(id));
  const customers = customerIds.length
    ? await prisma.customer.findMany({
        where: { companyId: scope.companyId, id: { in: customerIds } },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          businessName: true,
          phone: true,
          email: true,
          properties: { select: { address: true, city: true, state: true, zip: true }, take: 5 },
        },
      })
    : [];
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));
  const presented = rows.map((row) => {
    const payload = row.payload as CustomerPayload;
    const customer = row.proposedInternalId ? customerById.get(row.proposedInternalId) ?? null : null;
    const qbo = {
      name: payload.DisplayName || `${payload.GivenName || ""} ${payload.FamilyName || ""}`.trim() || row.displayName,
      company: payload.CompanyName || null,
      phone: payload.PrimaryPhone?.FreeFormNumber || null,
      email: payload.PrimaryEmailAddr?.Address || null,
      billingAddress: addressText(payload.BillAddr) || null,
      serviceAddress: addressText(payload.ShipAddr) || null,
    };
    const contractorYou = customer
      ? {
          id: customer.id,
          name: `${customer.firstName} ${customer.lastName}`.trim(),
          company: customer.businessName,
          phone: customer.phone,
          email: customer.email,
          serviceAddress:
            customer.properties
              .map((property) => `${property.address}, ${property.city}, ${property.state} ${property.zip}`)
              .join(" · ") || null,
        }
      : null;
    const storedSignals =
      row.matchSignals && typeof row.matchSignals === "object" && !Array.isArray(row.matchSignals)
        ? (row.matchSignals as { matched?: unknown; differing?: unknown; conflictReasons?: unknown })
        : null;
    const comparison =
      row.objectType === "CUSTOMER" && customer
        ? customerFieldComparison(
            {
              displayName: payload.DisplayName,
              givenName: payload.GivenName,
              familyName: payload.FamilyName,
              companyName: payload.CompanyName,
              email: payload.PrimaryEmailAddr?.Address,
              phone: payload.PrimaryPhone?.FreeFormNumber,
              billingAddress: addressText(payload.BillAddr),
              serviceAddress: addressText(payload.ShipAddr),
            },
            customer
          )
        : { matched: [] as string[], differing: [] as string[] };
    return {
      ...row,
      qbo,
      contractorYou,
      matchedFields: Array.isArray(storedSignals?.matched)
        ? storedSignals.matched.map(String)
        : comparison.matched,
      differingFields: Array.isArray(storedSignals?.differing)
        ? storedSignals.differing.map(String)
        : comparison.differing,
      conflictReasons: Array.isArray(storedSignals?.conflictReasons)
        ? storedSignals.conflictReasons.map(String)
        : row.confidence === "CONFLICT"
          ? [row.reason]
          : [],
    };
  });
  const search = input.search?.trim().toLowerCase();
  if (!search) return presented;
  return presented
    .filter((row) =>
      [
        row.qbo.name,
        row.qbo.company,
        row.qbo.phone,
        row.qbo.email,
        row.qbo.billingAddress,
        row.qbo.serviceAddress,
        row.contractorYou?.name,
        row.contractorYou?.company,
        row.contractorYou?.phone,
        row.contractorYou?.email,
        row.contractorYou?.serviceAddress,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(search)
    )
    .slice(0, 150);
}
