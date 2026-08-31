import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { allowPaymentAttempt } from "@/lib/payments/rate-limit";
import { invoiceSnapshotForPublicToken, invoiceSnapshotForSession } from "@/lib/payments/sync-api";
import { requirePermission } from "@/lib/tenant";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { invoiceId?: string; token?: string };
  const token = String(body.token || "").trim();
  const invoiceId = String(body.invoiceId || "").trim();

  try {
    if (token) {
      const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "public";
      if (!allowPaymentAttempt(`public-sync:${ip}:${token}`, 12, 60_000)) {
        return NextResponse.json({ ok: false, error: "Too many status checks. Try again shortly." }, { status: 429 });
      }
      const snapshot = await invoiceSnapshotForPublicToken(prisma, token);
      if (!snapshot) return NextResponse.json({ ok: false, error: "Invoice not found." }, { status: 404 });
      return NextResponse.json({ ok: true, ...snapshot });
    }

    if (!invoiceId) {
      return NextResponse.json({ ok: false, error: "Invoice required." }, { status: 400 });
    }
    const ctx = await requirePermission("invoices:view");
    const snapshot = await invoiceSnapshotForSession(prisma, {
      companyId: ctx.company.id,
      invoiceId,
    });
    if (!snapshot) return NextResponse.json({ ok: false, error: "Invoice not found." }, { status: 404 });
    return NextResponse.json({ ok: true, ...snapshot });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    throw error;
  }
}
