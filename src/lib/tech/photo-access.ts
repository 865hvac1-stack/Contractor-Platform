import { readFile } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/db";

export async function loadAuthorizedJobPhoto(input: {
  companyId: string;
  isDemo: boolean;
  photoId: string;
}) {
  const photo = await prisma.jobPhoto.findFirst({
    where: { id: input.photoId, companyId: input.companyId, deletedAt: null },
  });
  if (!photo) return null;
  const relative = photo.filePath.replace(/^\/+/, "");
  const isDemoAsset = relative.startsWith("demo/");
  if (isDemoAsset) {
    if (!input.isDemo) return null;
    const file = await readFile(path.join(process.cwd(), "public", relative));
    return { photo, file };
  }
  if (!relative.startsWith(`${input.companyId}/`)) return null;
  const root = process.env.UPLOAD_DIR || "./uploads";
  const file = await readFile(path.join(root, relative));
  return { photo, file };
}
