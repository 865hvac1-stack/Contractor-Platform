import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { AuthError } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const ctx = await requirePermission("compensation:manage");
    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const start = from ? new Date(from) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const end = to ? new Date(to) : new Date();
    const events = await prisma.compensationEvent.findMany({
      where: { companyId: ctx.company.id, earnedAt: { gte: start, lte: end } },
      include: {
        user: { select: { firstName: true, lastName: true } },
        rule: { select: { name: true } },
        job: { select: { jobNumber: true } },
      },
      orderBy: [{ userId: "asc" }, { earnedAt: "asc" }],
    });
    const header = [
      "Employee",
      "Period start",
      "Period end",
      "Rule",
      "Source",
      "Job",
      "Amount cents",
      "Status",
      "Approved date",
      "Paid date",
    ];
    const rows = events.map((event) =>
      [
        `${event.user.firstName} ${event.user.lastName}`,
        start.toISOString().slice(0, 10),
        end.toISOString().slice(0, 10),
        event.rule.name,
        `${event.sourceType}:${event.sourceId}`,
        event.job?.jobNumber ?? "",
        String(event.amountCents),
        event.status,
        event.approvedAt?.toISOString() ?? "",
        event.paidAt?.toISOString() ?? "",
      ]
        .map((value) => `"${value.replaceAll('"', '""')}"`)
        .join(",")
    );
    const csv = [header.join(","), ...rows].join("\n");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="compensation-${start.toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
