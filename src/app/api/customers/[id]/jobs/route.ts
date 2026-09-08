import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { requirePermission } from "@/lib/tenant";
import { searchCustomerJobs } from "@/lib/customers/jobs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("jobs:view");
    const { id } = await params;
    const url = new URL(request.url);
    const q = url.searchParams.get("q") ?? "";
    const items = await searchCustomerJobs({
      companyId: ctx.company.id,
      customerId: id,
      query: q,
      take: 20,
    });
    return NextResponse.json({ items });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
