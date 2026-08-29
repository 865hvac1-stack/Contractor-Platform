import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function uploadRoot() {
  const configured = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
  return path.resolve(/* turbopackIgnore: true */ configured);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const tenant = await getTenantContext();
  if (!tenant) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const receipt = await prisma.receipt.findFirst({
    where: { id, companyId: tenant.company.id },
  });
  if (!receipt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const root = uploadRoot();
  const absolute = path.resolve(root, receipt.filePath);
  if (!absolute.startsWith(root + path.sep) && absolute !== root) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    const data = await readFile(/* turbopackIgnore: true */ absolute);
    const safeName = receipt.fileName.replace(/[^\w.\- ()]/g, "_");
    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type": receipt.mimeType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "Content-Length": String(data.byteLength),
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "File missing" }, { status: 404 });
  }
}
