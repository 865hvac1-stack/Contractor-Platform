import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/tenant";
import { projectAccessFilter } from "@/lib/projects/core";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission("projects:view");
  const { id } = await params;
  const asset = await prisma.projectAsset.findFirst({
    where: {
      id,
      companyId: ctx.company.id,
      project: projectAccessFilter(ctx.role, ctx.user.id),
    },
  });
  if (!asset) return NextResponse.json({ error: "File not found." }, { status: 404 });
  try {
    const file = await readFile(path.join(process.env.UPLOAD_DIR || "./uploads", asset.filePath));
    return new NextResponse(file, {
      headers: {
        "content-type": asset.mimeType,
        "content-disposition": `inline; filename="${asset.fileName.replace(/["\r\n]/g, "_")}"`,
        "cache-control": "private, max-age=300",
      },
    });
  } catch {
    return NextResponse.json({ error: "File unavailable." }, { status: 404 });
  }
}
