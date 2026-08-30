import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

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

  const ok = database === "up" && sessionSecret;

  return NextResponse.json(
    {
      ok,
      service: "contractor-os",
      database,
      sessionSecret,
      timestamp: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 }
  );
}
