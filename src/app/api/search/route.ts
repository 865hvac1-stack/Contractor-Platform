import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { requireTenant } from "@/lib/auth";
import { globalSearch } from "@/lib/search/global";

export async function GET(request: Request) {
  try {
    const ctx = await requireTenant();
    const q = new URL(request.url).searchParams.get("q") ?? "";
    const result = await globalSearch({
      companyId: ctx.company.id,
      role: ctx.role,
      userId: ctx.user.id,
      query: q,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Search unavailable. Try again.", items: [], groups: [] }, { status: 500 });
  }
}
