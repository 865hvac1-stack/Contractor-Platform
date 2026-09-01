import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { requirePermission } from "@/lib/tenant";
import { searchCustomers } from "@/lib/customers/search";
import { customerLabel } from "@/lib/tech/today";

function propertyLabel(property: { address: string; city: string; name?: string | null }) {
  return `${property.address}, ${property.city}${property.name ? ` (${property.name})` : ""}`;
}

function matchesPropertyQuery(query: string, property: { address: string; city: string; zip: string }) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return false;
  const haystack = `${property.address} ${property.city} ${property.zip}`.toLowerCase();
  return haystack.includes(normalized);
}

export async function GET(request: Request) {
  try {
    const ctx = await requirePermission("customers:view");
    const url = new URL(request.url);
    const q = url.searchParams.get("q") ?? "";
    if (q.trim().length < 2) return NextResponse.json({ items: [] });
    const rows = await searchCustomers({
      companyId: ctx.company.id,
      role: ctx.role,
      userId: ctx.user.id,
      query: q,
      take: 12,
    });
    return NextResponse.json({
      items: rows.map((customer) => {
        const matchedProperty =
          customer.properties.find((property) => matchesPropertyQuery(q, property)) ??
          customer.properties[0] ??
          null;
        const openEstimate = customer.estimates?.[0];
        const membership = customer.customerMemberships?.[0];
        return {
          id: customer.id,
          name: customerLabel(customer),
          phone: customer.phone,
          email: customer.email,
          company: customer.businessName,
          address: matchedProperty ? propertyLabel(matchedProperty) : null,
          propertyId: matchedProperty?.id ?? null,
          matchedProperty: matchedProperty
            ? { id: matchedProperty.id, label: propertyLabel(matchedProperty) }
            : null,
          properties: customer.properties.map((property) => ({
            id: property.id,
            label: propertyLabel(property),
          })),
          openEstimate: openEstimate
            ? {
                id: openEstimate.id,
                label: "Open estimate",
                totalCents: openEstimate.totalCents,
              }
            : null,
          membershipPlan: membership?.plan.name ?? null,
        };
      }),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
