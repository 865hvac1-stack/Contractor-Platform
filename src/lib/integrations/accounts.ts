import { listGoogleAccounts } from "@/lib/integrations/sync/google";
import { listMetaAccounts } from "@/lib/integrations/sync/meta";
import { listTikTokAccounts } from "@/lib/integrations/sync/tiktok";
import { listLinkedInAccounts } from "@/lib/integrations/sync/linkedin";

export async function listProviderAccounts(providerKey: string, accessToken: string) {
  if (providerKey.startsWith("google_") || providerKey === "youtube") {
    return listGoogleAccounts(providerKey, accessToken);
  }
  if (providerKey === "facebook" || providerKey === "instagram" || providerKey === "meta_ads") {
    return listMetaAccounts(providerKey, accessToken);
  }
  if (providerKey.startsWith("tiktok")) return listTikTokAccounts(accessToken);
  if (providerKey === "linkedin") return listLinkedInAccounts(accessToken);
  return { accounts: [], error: "Account listing is not available for this provider." };
}
