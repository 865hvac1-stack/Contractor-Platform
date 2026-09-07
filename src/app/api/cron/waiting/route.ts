import { NextResponse } from "next/server";
import { processDueWaitingUpdates } from "@/lib/waiting/processor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const header = request.headers.get("authorization") || request.headers.get("x-cron-secret") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  return token === secret;
}

async function run(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  const result = await processDueWaitingUpdates({ limit: 200 });
  return NextResponse.json({ ok: true, result });
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
