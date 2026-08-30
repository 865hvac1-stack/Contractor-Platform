export type ProviderCategory =
  | "SEARCH_GOOGLE"
  | "SOCIAL"
  | "COMMUNICATION"
  | "WEBSITE";

export type ProviderReadiness = "coming_soon" | "not_configured";

export type IntegrationProvider = {
  key: string;
  name: string;
  category: ProviderCategory;
  description: string;
  value: string;
  readiness: ProviderReadiness;
  oauthReady: boolean;
  futureCapabilities: string[];
};

export const INTEGRATION_PROVIDERS: IntegrationProvider[] = [
  {
    key: "google_business_profile",
    name: "Google Business Profile",
    category: "SEARCH_GOOGLE",
    description: "Reviews, profile performance, and local presence — when Google authorizes the scopes we request.",
    value: "See which GBP interactions become booked jobs and collected revenue.",
    readiness: "coming_soon",
    oauthReady: false,
    futureCapabilities: [
      "Business profile connection",
      "Reviews and responses",
      "Profile performance (API-supported metrics only)",
      "Posts where the API allows",
    ],
  },
  {
    key: "google_lsa",
    name: "Google Local Services Ads",
    category: "SEARCH_GOOGLE",
    description: "LSA leads and spend, normalized into ContractorYou leads. No scraping.",
    value: "LSA spend → lead → job → payment → profit.",
    readiness: "coming_soon",
    oauthReady: false,
    futureCapabilities: ["Lead sync", "Lead cost where Google exposes it", "Dispute status where supported"],
  },
  {
    key: "google_ads",
    name: "Google Ads",
    category: "SEARCH_GOOGLE",
    description: "Campaign spend and clicks, then ContractorYou booking and profit — not just platform conversions.",
    value: "Know which campaigns actually produce sold work.",
    readiness: "coming_soon",
    oauthReady: false,
    futureCapabilities: ["Campaign / ad group reporting", "Spend", "Clicks", "Impressions"],
  },
  {
    key: "google_search_console",
    name: "Google Search Console",
    category: "SEARCH_GOOGLE",
    description: "Organic search performance for contractor websites.",
    value: "Connect search demand to website leads.",
    readiness: "coming_soon",
    oauthReady: false,
    futureCapabilities: ["Queries", "Pages", "Clicks"],
  },
  {
    key: "google_analytics",
    name: "Google Analytics",
    category: "SEARCH_GOOGLE",
    description: "Site sessions and landing-page performance.",
    value: "See which pages produce form leads.",
    readiness: "coming_soon",
    oauthReady: false,
    futureCapabilities: ["Sessions", "Landing pages"],
  },
  {
    key: "facebook",
    name: "Facebook",
    category: "SOCIAL",
    description: "Page connection for future posts, messages, and lead ads.",
    value: "One lead model for Meta and Google.",
    readiness: "coming_soon",
    oauthReady: false,
    futureCapabilities: ["Page", "Lead ads", "Engagement"],
  },
  {
    key: "instagram",
    name: "Instagram",
    category: "SOCIAL",
    description: "Instagram Business account — no fake publishing in this phase.",
    value: "Draft content here; publish only after a real connection exists.",
    readiness: "coming_soon",
    oauthReady: false,
    futureCapabilities: ["Business account", "Engagement"],
  },
  {
    key: "meta_ads",
    name: "Meta Ads",
    category: "SOCIAL",
    description: "Facebook and Instagram ad spend tied to ContractorYou jobs.",
    value: "Meta campaign → booked → sold → gross profit.",
    readiness: "coming_soon",
    oauthReady: false,
    futureCapabilities: ["Campaign reporting", "Ad spend", "Lead ads"],
  },
  {
    key: "tiktok",
    name: "TikTok",
    category: "SOCIAL",
    description: "Future-ready social presence.",
    value: "Keep contractor content in one operating system.",
    readiness: "coming_soon",
    oauthReady: false,
    futureCapabilities: ["Account connection"],
  },
  {
    key: "tiktok_ads",
    name: "TikTok Ads",
    category: "SOCIAL",
    description: "Paid social, when an official integration is configured.",
    value: "Same attribution path as Google and Meta.",
    readiness: "coming_soon",
    oauthReady: false,
    futureCapabilities: ["Spend", "Leads"],
  },
  {
    key: "youtube",
    name: "YouTube",
    category: "SOCIAL",
    description: "Future channel connection.",
    value: "Track video as a lead source when connected.",
    readiness: "coming_soon",
    oauthReady: false,
    futureCapabilities: ["Channel"],
  },
  {
    key: "linkedin",
    name: "LinkedIn",
    category: "SOCIAL",
    description: "Future-ready for commercial contractors.",
    value: "Commercial pipeline source.",
    readiness: "coming_soon",
    oauthReady: false,
    futureCapabilities: ["Page"],
  },
  {
    key: "business_phone",
    name: "Business Phone",
    category: "COMMUNICATION",
    description: "Call tracking foundation. No fake telephony.",
    value: "Missed call → text → booking, when a provider is plugged in.",
    readiness: "coming_soon",
    oauthReady: false,
    futureCapabilities: ["Inbound / outbound", "Missed calls", "Recordings"],
  },
  {
    key: "sms",
    name: "SMS",
    category: "COMMUNICATION",
    description: "Two-way text when a provider is configured.",
    value: "Lead response time you can measure.",
    readiness: "coming_soon",
    oauthReady: false,
    futureCapabilities: ["Send", "Receive", "Delivery"],
  },
  {
    key: "email",
    name: "Email",
    category: "COMMUNICATION",
    description: "Campaign and conversation email — not implemented yet.",
    value: "Reactivation and estimate follow-up with outcomes.",
    readiness: "coming_soon",
    oauthReady: false,
    futureCapabilities: ["Send", "Opens where available"],
  },
  {
    key: "website_chat",
    name: "Website Chat",
    category: "COMMUNICATION",
    description: "Chat widget leads into the same pipeline.",
    value: "Website conversation → booked job.",
    readiness: "coming_soon",
    oauthReady: false,
    futureCapabilities: ["Transcript", "Lead create"],
  },
  {
    key: "website_forms",
    name: "Website Forms",
    category: "WEBSITE",
    description: "Embedded or hosted forms with UTM capture. Manual website leads can be recorded today.",
    value: "Google Ad → landing page → form → job → revenue.",
    readiness: "not_configured",
    oauthReady: false,
    futureCapabilities: ["Hosted form", "Embed", "UTM"],
  },
  {
    key: "landing_pages",
    name: "Landing Pages",
    category: "WEBSITE",
    description: "ContractorYou-hosted pages — not built yet.",
    value: "Attribute every form to a page and campaign.",
    readiness: "coming_soon",
    oauthReady: false,
    futureCapabilities: ["Hosted pages"],
  },
  {
    key: "tracking_numbers",
    name: "Tracking Numbers",
    category: "WEBSITE",
    description: "Source-level numbers once a call provider exists.",
    value: "Know which ad made the phone ring.",
    readiness: "coming_soon",
    oauthReady: false,
    futureCapabilities: ["Number pool", "Source stamp"],
  },
  {
    key: "utm_tracking",
    name: "UTM / Campaign Tracking",
    category: "WEBSITE",
    description: "UTM fields are on every lead and form submission now. Automatic site capture is not.",
    value: "First touch and last touch without guessing.",
    readiness: "not_configured",
    oauthReady: false,
    futureCapabilities: ["Auto-capture", "Session id"],
  },
];

export const PROVIDER_CATEGORIES: { key: ProviderCategory; label: string }[] = [
  { key: "SEARCH_GOOGLE", label: "Search / Google" },
  { key: "SOCIAL", label: "Social" },
  { key: "COMMUNICATION", label: "Communication" },
  { key: "WEBSITE", label: "Website" },
];

export function getProvider(key: string) {
  return INTEGRATION_PROVIDERS.find((p) => p.key === key) ?? null;
}
