import { diagnosticAppliesToCanonicalLocation } from "@/lib/highlevel/canonical-connection";
import type { HighLevelConversationsDiagnostic } from "@/lib/highlevel/conversations-diagnostic";
import { operationalHealthFromConversationsDiagnostic } from "@/lib/highlevel/conversations-diagnostic";

export function highlevelSettingsHealth(input: {
  authenticated: boolean;
  operationalTokens: boolean;
  connectionStatus?: string | null;
  testGrant?: boolean;
  diagnostic?: HighLevelConversationsDiagnostic | null;
  canonicalLocationId?: string | null;
  socialAccounts?: number;
}) {
  const diagnostic = diagnosticAppliesToCanonicalLocation(input.diagnostic, input.canonicalLocationId)
    ? input.diagnostic
    : input.canonicalLocationId
      ? null
      : input.diagnostic;
  const liveHealth = operationalHealthFromConversationsDiagnostic(diagnostic);
  const operational = Boolean(input.operationalTokens && liveHealth.conversationsOk);
  const headerStatus = input.testGrant
    ? "TEST ONLY"
    : operational
      ? input.connectionStatus ?? "CONNECTED"
      : input.authenticated
        ? "AUTHENTICATED — NEEDS ATTENTION"
        : input.connectionStatus ?? "NOT_CONNECTED";
  const verifiedKeys = [
    liveHealth.contactsOk ? "contacts" : null,
    liveHealth.conversationsOk ? "conversations" : null,
    liveHealth.conversationsOk ? "sms" : null,
    liveHealth.conversationsOk ? "phone" : null,
    (input.socialAccounts ?? 0) > 0 ? "social" : null,
  ].filter((key): key is string => Boolean(key));
  const errorKeys = [
    liveHealth.contactsFailed ? "contacts" : null,
    liveHealth.conversationsFailed || liveHealth.locationInactive ? "conversations" : null,
    liveHealth.conversationsFailed || liveHealth.locationInactive ? "sms" : null,
    liveHealth.conversationsFailed || liveHealth.locationInactive ? "phone" : null,
  ].filter((key): key is string => Boolean(key));
  return {
    liveHealth,
    operational,
    headerStatus,
    verifiedKeys,
    errorKeys,
  };
}
