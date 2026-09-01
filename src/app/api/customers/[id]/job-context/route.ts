import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/tenant";
import { customerLabel } from "@/lib/tech/today";

function propertyLabel(property: { address: string; city: string; name: string | null }) {
  return `${property.address}, ${property.city}${property.name ? ` (${property.name})` : ""}`;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("customers:view");
    const { id } = await params;
    const customer = await prisma.customer.findFirst({
      where: { id, companyId: ctx.company.id, status: { not: "ARCHIVED" } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        businessName: true,
        phone: true,
        email: true,
        properties: {
          orderBy: [{ isPrimary: "desc" }, { address: "asc" }],
          select: { id: true, name: true, address: true, city: true, state: true, zip: true },
        },
      },
    });
    if (!customer) {
      return NextResponse.json({ error: "Customer not found." }, { status: 404 });
    }
    return NextResponse.json({
      id: customer.id,
      name: customerLabel(customer),
      phone: customer.phone,
      email: customer.email,
      properties: customer.properties.map((property) => ({
        id: property.id,
        label: propertyLabel(property),
      })),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
