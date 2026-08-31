import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { invoicePaymentSnapshot } from "@/lib/payments/sync";
import { requirePermission } from "@/lib/tenant";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token")?.trim() || "";
  const invoiceId = url.searchParams.get("invoiceId")?.trim() || "";

  try {
    if (token) {
      const invoice = await prisma.invoice.findFirst({ where: { publicToken: token } });
      if (!invoice) return NextResponse.json({ ok: false, error: "Invoice not found." }, { status: 404 });
      return NextResponse.json({ ok: true, ...invoicePaymentSnapshot(invoice) });
    }
    if (!invoiceId) {
      return NextResponse.json({ ok: false, error: "Invoice required." }, { status: 400 });
    }
    const ctx = await requirePermission("invoices:view");
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, companyId: ctx.company.id },
    });
    if (!invoice) return NextResponse.json({ ok: false, error: "Invoice not found." }, { status: 404 });
    return NextResponse.json({ ok: true, ...invoicePaymentSnapshot(invoice) });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    throw error;
  }
}
