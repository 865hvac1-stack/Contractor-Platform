import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { buildErrorReportCsv } from "@/lib/imports/report";
import type { RowIssue } from "@/lib/imports/types";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx || !can(ctx.role, "imports:manage")) {
    return new NextResponse("Not allowed", { status: 403 });
  }
  const { id } = await params;
  const session = await prisma.importSession.findFirst({
    where: { id, companyId: ctx.company.id },
  });
  if (!session) return new NextResponse("Not found", { status: 404 });
  const rows = await prisma.importRow.findMany({
    where: {
      companyId: ctx.company.id,
      importSessionId: session.id,
      status: { in: ["ERROR", "FAILED", "SKIPPED"] },
    },
    orderBy: { rowNumber: "asc" },
  });
  const csv = buildErrorReportCsv(
    rows.map((row) => ({
      rowNumber: row.rowNumber,
      status: row.status,
      action: row.action,
      issues: (row.issues as RowIssue[] | null) ?? [],
      rawData: row.rawData as Record<string, string>,
    }))
  );
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="import-${session.id}-report.csv"`,
    },
  });
}
