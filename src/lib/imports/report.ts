import { csvEscape } from "@/lib/imports/security";
import type { RowIssue } from "@/lib/imports/types";

export function buildErrorReportCsv(
  rows: {
    rowNumber: number;
    status: string;
    action: string;
    issues: RowIssue[] | null;
    rawData: Record<string, string>;
  }[]
): string {
  const headers = ["Row", "Status", "Action", "Issues", "Raw data"];
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    const issues = (row.issues ?? []).map((issue) => `${issue.level}: ${issue.message}`).join(" | ");
    lines.push(
      [
        String(row.rowNumber),
        row.status,
        row.action,
        issues,
        JSON.stringify(row.rawData),
      ]
        .map(csvEscape)
        .join(",")
    );
  }
  return lines.join("\n");
}

export function buildSkippedReportCsv(
  rows: {
    rowNumber: number;
    action: string;
    issues: RowIssue[] | null;
    rawData: Record<string, string>;
  }[]
): string {
  return buildErrorReportCsv(
    rows.map((row) => ({
      ...row,
      status: "SKIPPED",
    }))
  );
}
