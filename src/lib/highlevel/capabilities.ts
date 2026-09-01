import { HIGHLEVEL_SCOPES } from "@/lib/highlevel/config";

export type CapabilityStatus = "CONNECTED" | "AVAILABLE" | "NOT_AUTHORIZED" | "NOT_CONFIGURED";

export type HighLevelCapability = {
  key: string;
  label: string;
  status: CapabilityStatus;
  scopes: string[];
};

const CAPABILITIES: { key: string; label: string; scopes: string[]; verified?: boolean }[] = [
  { key: "contacts", label: "Contacts", scopes: ["contacts.readonly", "contacts.write"] },
  { key: "conversations", label: "Conversations", scopes: ["conversations.readonly"] },
  { key: "sms", label: "SMS", scopes: ["conversations/message.write", "conversations.write"] },
  { key: "phone", label: "Phone", scopes: ["conversations.readonly"] },
  { key: "email", label: "Email", scopes: ["conversations/message.write"] },
  { key: "opportunities", label: "Opportunities / Leads", scopes: ["opportunities.readonly"] },
  { key: "calendars", label: "Calendars", scopes: ["calendars.readonly"] },
  { key: "workflows", label: "Workflows", scopes: ["workflows.readonly"] },
  { key: "reviews", label: "Reviews", scopes: [] },
];

function hasScope(granted: string[], needed: string[]) {
  if (needed.length === 0) return false;
  const set = new Set(granted.map((scope) => scope.toLowerCase()));
  if (set.has("private_token")) return true;
  return needed.some((scope) => set.has(scope.toLowerCase()));
}

export function highlevelCapabilities(input: {
  connected: boolean;
  scopes: string[];
  verifiedKeys?: string[];
}): HighLevelCapability[] {
  const verified = new Set(input.verifiedKeys ?? []);
  return CAPABILITIES.map((capability) => {
    if (!input.connected) {
      return { ...capability, status: "NOT_CONFIGURED" as const };
    }
    const authorized = capability.scopes.length === 0 ? false : hasScope(input.scopes, capability.scopes);
    if (verified.has(capability.key)) {
      return { ...capability, status: "CONNECTED" as const };
    }
    if (authorized) {
      return { ...capability, status: "AVAILABLE" as const };
    }
    return { ...capability, status: "NOT_AUTHORIZED" as const };
  });
}

export function defaultHighLevelScopes() {
  return [...HIGHLEVEL_SCOPES];
}
