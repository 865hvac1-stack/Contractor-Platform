import { prisma } from "@/lib/db";
import { resolveCommunicationProvider } from "@/lib/comms/provider";
import { loadCustomerConversationOwner } from "@/lib/comms/conversation-owner";

type AutomationReadinessInput = {
  companyId: string;
  trigger: string;
  goal: string | null;
  mode: string;
  firstMessage: string | null;
  allowedActions: string[];
  stopConditions: string[];
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
};

export async function automationReadiness(automation: AutomationReadinessInput) {
  const [provider, owner] = await Promise.all([
    resolveCommunicationProvider(automation.companyId),
    loadCustomerConversationOwner(prisma, automation.companyId),
  ]);
  const checks = [
    check("Trigger configured", Boolean(automation.trigger)),
    check("Audience configured", true),
    check("Business goal configured", automation.mode !== "START_CONVERSATION" || Boolean(automation.goal)),
    check("First message configured", Boolean(automation.firstMessage?.trim())),
    check("Regina permissions configured", automation.mode !== "START_CONVERSATION" || automation.allowedActions.length > 0),
    check("SMS provider connected", provider !== "none", "Connect Communications to turn this automation on."),
    check("Customer reply routing configured", automation.mode !== "START_CONVERSATION" || owner === "CONTRACTORYOU", "Set ContractorYou as the customer conversation owner."),
    check("Human takeover available", automation.mode !== "START_CONVERSATION" || automation.allowedActions.includes("REQUEST_HUMAN_HANDOFF")),
    check("Opt-out handling active", automation.stopConditions.includes("CUSTOMER_OPTED_OUT")),
    check("Quiet hours configured", automation.quietHoursStart !== null && automation.quietHoursEnd !== null),
  ];
  return { ready: checks.every((item) => item.ready), checks };
}

function check(label: string, ready: boolean, blocker?: string) {
  return { label, ready, blocker: ready ? null : blocker || `${label} is required.` };
}
