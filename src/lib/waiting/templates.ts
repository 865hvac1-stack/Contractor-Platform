import { formatWaitingDate } from "@/lib/waiting/schedule";
import { itemNameFromMetadata, parseWaitingMetadata, type WaitingMetadata } from "@/lib/waiting/types";

const VAR_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export type WaitingTemplateVars = {
  firstName: string;
  companyName: string;
  itemName: string;
  jobNumber: string;
  waitingReason: string;
  waitingFor: string;
  expectedDate: string;
  expectedDateSentence: string;
  ownerName: string;
};

export function buildWaitingTemplateVars(input: {
  firstName: string;
  companyName: string;
  jobNumber: string;
  waitingReason: string;
  ownerName?: string | null;
  metadata?: WaitingMetadata | unknown;
  expectedResolutionAt?: Date | null;
  timezone?: string;
}): WaitingTemplateVars {
  const meta = parseWaitingMetadata(input.metadata);
  const expectedDate = formatWaitingDate(input.expectedResolutionAt ?? null, input.timezone);
  return {
    firstName: input.firstName.trim() || "there",
    companyName: input.companyName.trim() || "our team",
    itemName: itemNameFromMetadata(meta, "item"),
    jobNumber: input.jobNumber,
    waitingReason: input.waitingReason,
    waitingFor: meta.waitingFor?.trim() || meta.customerWait?.needed?.trim() || input.waitingReason,
    expectedDate: expectedDate ?? "",
    expectedDateSentence: expectedDate ? ` Expected arrival is ${expectedDate}.` : "",
    ownerName: input.ownerName?.trim() || "our office",
  };
}

export function renderWaitingTemplate(body: string, vars: WaitingTemplateVars): string {
  const rendered = body.replace(VAR_RE, (_, key: string) => {
    const value = vars[key as keyof WaitingTemplateVars];
    return typeof value === "string" ? value : "";
  });
  return rendered
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function templateMentionsUnverifiedDate(body: string, expectedResolutionAt: Date | null | undefined) {
  if (expectedResolutionAt) return false;
  return /\{\{\s*expectedDate(Sentence)?\s*\}\}/.test(body) === false && /\b(arrive[sd]?|arrival|expected)\b/i.test(body)
    ? false
    : false;
}
