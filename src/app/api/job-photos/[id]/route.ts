import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AuthError } from "@/lib/auth";
import { requireAssignedJob } from "@/lib/tech/access";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const photo = await prisma.jobPhoto.findFirst({ where: { id } });
    if (!photo) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await requireAssignedJob(photo.jobId);
    const root = process.env.UPLOAD_DIR || "./uploads";
    const file = await readFile(path.join(root, photo.filePath));
    return new NextResponse(file, {
      headers: {
        "Content-Type": photo.mimeType,
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
