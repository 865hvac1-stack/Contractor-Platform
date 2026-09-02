import { handleHighLevelMarketplaceCallback } from "@/lib/highlevel/oauth-callback";

export async function GET(request: Request) {
  return handleHighLevelMarketplaceCallback(request);
}
