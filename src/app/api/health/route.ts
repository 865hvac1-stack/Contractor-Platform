import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { openaiProviderCanInitialize } from "@/lib/intelligence/config";

export async function GET() {
  let database: "up" | "down" = "down";
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = "up";
  } catch {
    database = "down";
  }

  const sessionSecret = Boolean(
    process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32
  );
  const openaiConfigured = await openaiProviderCanInitialize();

  const ok = database === "up" && sessionSecret;

  const commit =
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.RAILWAY_GIT_COMMIT ||
    process.env.COMMIT_SHA ||
    null;

  return NextResponse.json(
    {
      ok,
      service: "contractor-os",
      database,
      sessionSecret,
      openaiConfigured,
      commit: commit ? String(commit).slice(0, 40) : null,
      timestamp: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 }
  );
}
