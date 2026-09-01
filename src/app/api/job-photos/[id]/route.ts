import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { requireAssignedJob } from "@/lib/tech/access";
import { loadAuthorizedJobPhoto } from "@/lib/tech/photo-access";
import { requirePermission } from "@/lib/tenant";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requirePermission("jobs:view");
    const { id } = await params;
    const loaded = await loadAuthorizedJobPhoto({
      companyId: ctx.company.id,
      isDemo: ctx.company.isDemo,
      photoId: id,
    });
    if (!loaded) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await requireAssignedJob(loaded.photo.jobId);
    return new NextResponse(loaded.file, {
      headers: {
        "Content-Type": loaded.photo.mimeType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
