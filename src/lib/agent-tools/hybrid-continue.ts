import { processSchedulingSessionInbound } from "@/lib/agent-tools/scheduling-session";

export function shouldContinueHybridInbound(input: {
  text: string;
  offeredCount: number;
  matchKind: "match" | "ambiguous" | "none";
  selected: boolean;
  looksLikeName: boolean;
  looksLikeAddress: boolean;
  missingField?: string | null;
}) {
  if (input.matchKind === "match" || input.matchKind === "ambiguous") return true;
  if (input.selected && (input.looksLikeName || input.looksLikeAddress)) return true;
  if (input.selected && (input.missingField === "name" || input.missingField === "address" || input.missingField === "property")) {
    return input.looksLikeName || input.looksLikeAddress;
  }
  return false;
}

export async function continueHybridSchedulingFromInbound(input: {
  companyId: string;
  threadId: string;
  messageId: string;
  phone?: string | null;
  contactId?: string | null;
  body?: string | null;
}) {
  return processSchedulingSessionInbound(input);
}
