import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { requirePermission } from "@/lib/tenant";
import { searchCustomers } from "@/lib/customers/search";
import { customerLabel } from "@/lib/tech/today";

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
      items: rows.map((customer) => ({
        id: customer.id,
        name: customerLabel(customer),
        phone: customer.phone,
        email: customer.email,
        company: customer.businessName,
        address: customer.properties[0]
          ? `${customer.properties[0].address}, ${customer.properties[0].city}, ${customer.properties[0].state} ${customer.properties[0].zip}`
          : null,
        properties: customer.properties.map((property) => ({
          id: property.id,
          label: `${property.address}, ${property.city}${property.name ? ` (${property.name})` : ""}`,
        })),
      })),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
