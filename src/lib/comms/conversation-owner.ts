import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";

export const CUSTOMER_CONVERSATION_OWNERS = ["MANUAL", "HIGHLEVEL_AI", "CONTRACTORYOU"] as const;
export type CustomerConversationOwner = (typeof CUSTOMER_CONVERSATION_OWNERS)[number];

export type OutboundCommunicationOrigin =
  | "MANUAL_OFFICE"
  | "HIGHLEVEL_AI"
  | "CONTRACTORYOU_AUTOMATION"
  | "SCHEDULING_CONFIRMATION"
  | "WAITING_BOARD"
  | "SYSTEM_AUTOMATION";

export function parseCustomerConversationOwner(value: unknown): CustomerConversationOwner {
  if (value === "MANUAL" || value === "HIGHLEVEL_AI" || value === "CONTRACTORYOU") return value;
  return "CONTRACTORYOU";
}

export function contractorYouMayAutoreply(owner: CustomerConversationOwner) {
  return owner === "CONTRACTORYOU";
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
    return "HighLevel Conversation AI talks to the customer. ContractorYou remains the source of truth for scheduling and business data.";
  }
  if (owner === "MANUAL") {
    return "Neither AI replies automatically. The office sends customer texts from ContractorYou.";
  }
  return "ContractorYou Regina (or your company assistant) replies through HighLevel SMS. Turn HighLevel Conversation AI off for this location so customers are not double-texted.";
}
