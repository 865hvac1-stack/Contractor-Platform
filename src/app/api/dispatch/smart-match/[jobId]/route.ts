import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { recommendTechniciansForJob } from "@/lib/smart-dispatch/recommend";
import { requirePermission } from "@/lib/tenant";

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const ctx = await requirePermission("schedule:view");
    const { jobId } = await params;
    const match = await recommendTechniciansForJob({
      companyId: ctx.company.id,
      jobId,
      persist: true,
    });
    return NextResponse.json(match);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unable to load Smart Dispatch match." }, { status: 500 });
  }
}
