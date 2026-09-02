import { createHighLevelLocation } from "@/lib/highlevel/client";

/**
 * Agency Pro can create a HighLevel sub-account/location via POST /locations/.
 * Long-term onboarding:
 *   new ContractorYou company → create/link location → apply snapshot → Marketplace OAuth
 *   → location-scoped token → sync phone/SMS.
 * PIT remains a controlled testing fallback only. This helper is never called automatically.
 */
export async function provisionHighLevelSubAccount(input: {
  agencyAccessToken: string;
  name: string;
  phone?: string;
  companyName?: string;
}) {
  return createHighLevelLocation({
    accessToken: input.agencyAccessToken,
    name: input.name,
    phone: input.phone,
    companyName: input.companyName,
  });
}
