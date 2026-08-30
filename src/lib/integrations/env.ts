export type ProviderEnvStatus = {
  providerKey: string;
  configured: boolean;
  missing: string[];
  notes: string[];
};

function present(name: string) {
  const value = process.env[name];
  return Boolean(value && value.trim());
}

export function appUrl() {
  return (process.env.APP_URL || "http://127.0.0.1:43123").replace(/\/$/, "");
}

export function oauthCallbackUrl(family: "google" | "meta" | "tiktok" | "linkedin") {
  return `${appUrl()}/api/integrations/${family}/callback`;
}

export function getProviderEnv(providerKey: string): ProviderEnvStatus {
  switch (providerKey) {
    case "google_business_profile":
    case "google_ads":
    case "google_lsa":
    case "google_search_console":
    case "google_analytics":
    case "youtube": {
      const missing: string[] = [];
      if (!present("GOOGLE_CLIENT_ID")) missing.push("GOOGLE_CLIENT_ID");
      if (!present("GOOGLE_CLIENT_SECRET")) missing.push("GOOGLE_CLIENT_SECRET");
      if (providerKey === "google_ads" || providerKey === "google_lsa") {
        if (!present("GOOGLE_ADS_DEVELOPER_TOKEN")) missing.push("GOOGLE_ADS_DEVELOPER_TOKEN");
      }
      const notes: string[] = [];
      if (providerKey === "google_business_profile") {
        notes.push("Google Business Profile API access must be approved on the Google Cloud project.");
      }
      if (providerKey === "google_lsa") {
        notes.push("LSA leads sync through the Google Ads API. A developer token and Ads account are required.");
      }
      return { providerKey, configured: missing.length === 0, missing, notes };
    }
    case "facebook":
    case "instagram":
    case "meta_ads": {
      const missing: string[] = [];
      if (!present("META_APP_ID")) missing.push("META_APP_ID");
      if (!present("META_APP_SECRET")) missing.push("META_APP_SECRET");
      return {
        providerKey,
        configured: missing.length === 0,
        missing,
        notes: ["Meta App Review is required before Page posting, Instagram, and Lead Ads can go live."],
      };
    }
    case "tiktok":
    case "tiktok_ads": {
      const missing: string[] = [];
      if (!present("TIKTOK_CLIENT_KEY")) missing.push("TIKTOK_CLIENT_KEY");
      if (!present("TIKTOK_CLIENT_SECRET")) missing.push("TIKTOK_CLIENT_SECRET");
      return {
        providerKey,
        configured: missing.length === 0,
        missing,
        notes:
          providerKey === "tiktok"
            ? ["video.publish and Content Posting require TikTok app approval."]
            : ["TikTok Ads API access is a separate product approval."],
      };
    }
    case "linkedin": {
      const missing: string[] = [];
      if (!present("LINKEDIN_CLIENT_ID")) missing.push("LINKEDIN_CLIENT_ID");
      if (!present("LINKEDIN_CLIENT_SECRET")) missing.push("LINKEDIN_CLIENT_SECRET");
      return {
        providerKey,
        configured: missing.length === 0,
        missing,
        notes: ["LinkedIn Marketing and Community Management APIs require product access approval."],
      };
    }
    case "business_phone":
    case "sms": {
      const missing: string[] = [];
      if (!present("TWILIO_ACCOUNT_SID")) missing.push("TWILIO_ACCOUNT_SID");
      if (!present("TWILIO_AUTH_TOKEN")) missing.push("TWILIO_AUTH_TOKEN");
      return {
        providerKey,
        configured: missing.length === 0,
        missing,
        notes: ["Numbers are not provisioned until Twilio is configured. Tracking-number records can be stored now."],
      };
    }
    case "email": {
      const missing: string[] = [];
      if (!present("RESEND_API_KEY")) missing.push("RESEND_API_KEY");
      return {
        providerKey,
        configured: missing.length === 0,
        missing,
        notes: ["Set a verified from-address after the API key is present. ContractorYou does not replace Gmail."],
      };
    }
    case "website_forms":
    case "landing_pages":
    case "utm_tracking":
      return { providerKey, configured: true, missing: [], notes: [] };
    case "tracking_numbers": {
      const missing: string[] = [];
      if (!present("TWILIO_ACCOUNT_SID")) missing.push("TWILIO_ACCOUNT_SID");
      if (!present("TWILIO_AUTH_TOKEN")) missing.push("TWILIO_AUTH_TOKEN");
      return {
        providerKey,
        configured: true,
        missing,
        notes: missing.length
          ? ["You can map numbers to sources now. Live call capture waits on a phone provider."]
          : [],
      };
    }
    default:
      return { providerKey, configured: false, missing: [], notes: ["This provider is not implemented."] };
  }
}

export function encryptionConfigured() {
  const secret =
    process.env.INTEGRATION_ENCRYPTION_KEY ||
    process.env.INTEGRATION_SECRET ||
    process.env.SESSION_SECRET;
  return Boolean(secret && secret.length >= 32);
}
