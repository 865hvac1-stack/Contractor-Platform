import { INTEGRATION_PROVIDERS } from "@/lib/integrations/catalog";
import { encryptionConfigured, getProviderEnv, oauthCallbackUrl } from "@/lib/integrations/env";

export function getIntegrationReadiness() {
  return INTEGRATION_PROVIDERS.map((provider) => {
    const env = getProviderEnv(provider.key);
    let implementation = "NOT IMPLEMENTED";
    if (provider.internalLive) implementation = "LIVE + VERIFIED (ContractorYou-hosted)";
    else if (provider.oauthReady) implementation = "CODE READY";
    else if (provider.family === "twilio" || provider.family === "resend" || provider.family === "stripe") {
      implementation = "CODE READY";
    }

    let status = "ACTION REQUIRED";
    if (provider.internalLive) status = "LIVE";
    else if (!env.configured) status = "NEEDS CREDENTIALS";
    else if (provider.approvalRequired) status = "NEEDS PROVIDER APPROVAL";
    else status = "READY TO CONNECT";

    return {
      provider: provider.name,
      key: provider.key,
      implementation,
      credentialsPresent: env.configured,
      missing: env.missing,
      notes: env.notes,
      approvalRequired: provider.approvalRequired,
      status,
    };
  });
}

export function getOAuthCallbackDocs() {
  return {
    google: oauthCallbackUrl("google"),
    meta: oauthCallbackUrl("meta"),
    tiktok: oauthCallbackUrl("tiktok"),
    linkedin: oauthCallbackUrl("linkedin"),
    encryptionConfigured: encryptionConfigured(),
  };
}
