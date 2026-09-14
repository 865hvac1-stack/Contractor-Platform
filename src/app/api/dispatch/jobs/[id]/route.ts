import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { loadDispatchJobPanel } from "@/lib/dispatch/job-panel";
import { jobAccessFilter, requirePermission } from "@/lib/tenant";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("schedule:view");
    const { id } = await params;
    const panel = await loadDispatchJobPanel(prisma, {
      companyId: ctx.company.id,
      jobId: id,
      role: ctx.role,
      access: jobAccessFilter(ctx.role, ctx.user.id),
    });
    if (!panel) return NextResponse.json({ error: "Job not found." }, { status: 404 });
    return NextResponse.json(panel);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unable to load dispatch job context." }, { status: 500 });
  }
}
