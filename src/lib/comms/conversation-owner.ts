import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";

export const CUSTOMER_CONVERSATION_OWNERS = ["MANUAL", "HIGHLEVEL_AI", "CONTRACTORYOU"] as const;
export type CustomerConversationOwner = (typeof CUSTOMER_CONVERSATION_OWNERS)[number];

export type OutboundCommunicationOrigin =
  | "MANUAL_OFFICE"
  | "HIGHLEVEL_AI"
  | "CONTRACTORYOU_AUTOMATION"
  | "CONTRACTORYOU_ACTION_RESULT"
  | "SCHEDULING_CONFIRMATION"
  | "WAITING_BOARD"
  | "SYSTEM_AUTOMATION";

export function parseCustomerConversationOwner(value: unknown): CustomerConversationOwner {
  if (value === "HIGHLEVEL" || value === "HIGHLEVEL_AI") return "HIGHLEVEL_AI";
  if (value === "OFFICE_ONLY" || value === "MANUAL") return "MANUAL";
  if (value === "CONTRACTORYOU") return "CONTRACTORYOU";
  return "CONTRACTORYOU";
}

export function contractorYouMayAutoreply(owner: CustomerConversationOwner) {
  return owner === "CONTRACTORYOU";
}

export function highLevelOwnsConversation(owner: CustomerConversationOwner) {
  return owner === "HIGHLEVEL_AI";
}

export function contractorYouMaySendActionResult(owner: CustomerConversationOwner) {
  return owner === "CONTRACTORYOU" || owner === "HIGHLEVEL_AI";
}

export async function loadCustomerConversationOwner(
  db: PrismaClient | typeof prisma,
  companyId: string
): Promise<CustomerConversationOwner> {
  const company = await db.company.findFirst({
    where: { id: companyId },
    select: { customerConversationOwner: true },
  });
  return parseCustomerConversationOwner(company?.customerConversationOwner);
}

export function conversationOwnerCopy(owner: CustomerConversationOwner) {
  if (owner === "HIGHLEVEL_AI") {
    return "HighLevel handles the conversation. ContractorYou still controls customers, availability, booking, jobs, and Dispatch.";
  }
  if (owner === "MANUAL") {
    return "Office only. Neither AI replies automatically.";
  }
  return "ContractorYou handles both the conversation and business actions.";
}
