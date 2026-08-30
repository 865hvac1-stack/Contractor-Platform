import { getProvider } from "@/lib/integrations/catalog";

export function oauthStartHref(providerKey: string) {
  const provider = getProvider(providerKey);
  if (!provider) return "/marketing/channels";
  if (provider.family === "google") return `/api/integrations/google/start?provider=${providerKey}`;
  if (provider.family === "meta") return `/api/integrations/meta/start?provider=${providerKey}`;
  if (provider.family === "tiktok") return `/api/integrations/tiktok/start?provider=${providerKey}`;
  if (provider.family === "linkedin") return `/api/integrations/linkedin/start`;
  return `/marketing/channels/${providerKey}`;
}

export function actionLabel(action: string) {
  switch (action) {
    case "CONNECT":
      return "Connect";
    case "CONFIGURE_INTEGRATION":
      return "Configure integration";
    case "SELECT_ACCOUNT":
      return "Select account";
    case "SYNC_NOW":
      return "Sync now";
    case "RECONNECT":
      return "Reconnect";
    case "MANAGE":
      return "Manage";
    default:
      return "Coming soon";
  }
}
