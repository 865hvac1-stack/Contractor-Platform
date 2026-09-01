export type ProviderCategory =
  | "SEARCH_GOOGLE"
  | "SOCIAL"
  | "COMMUNICATION"
  | "WEBSITE"
  | "ACCOUNTING"
  | "PAYMENTS";

export type ProviderFamily = "google" | "meta" | "tiktok" | "linkedin" | "internal" | "twilio" | "resend" | "intuit" | "stripe" | "highlevel";

export type IntegrationProvider = {
  key: string;
  name: string;
  category: ProviderCategory;
  family: ProviderFamily;
  description: string;
  value: string;
  oauthReady: boolean;
  internalLive: boolean;
  approvalRequired: boolean;
  comingSoon?: boolean;
  futureCapabilities: string[];
};

export const INTEGRATION_PROVIDERS: IntegrationProvider[] = [
  {
    key: "google_business_profile",
    name: "Google Business Profile",
    category: "SEARCH_GOOGLE",
    family: "google",
    description: "Reviews and location presence through Google's official Business Profile APIs.",
    value: "See which GBP interactions become booked jobs and collected revenue.",
    oauthReady: true,
    internalLive: false,
    approvalRequired: true,
    futureCapabilities: ["Reviews and responses", "Profile performance", "Posts where the API allows"],
  },
  {
    key: "google_lsa",
    name: "Google Local Services Ads",
    category: "SEARCH_GOOGLE",
    family: "google",
    description: "LSA leads through the Google Ads API. No scraping.",
    value: "LSA spend → lead → job → payment → profit.",
    oauthReady: true,
    internalLive: false,
    approvalRequired: true,
    futureCapabilities: ["Lead sync", "Lead cost where Google exposes it"],
  },
  {
    key: "google_ads",
    name: "Google Ads",
    category: "SEARCH_GOOGLE",
    family: "google",
    description: "Campaign spend and clicks. Platform conversions are not ContractorYou revenue.",
    value: "Know which campaigns actually produce sold work.",
    oauthReady: true,
    internalLive: false,
    approvalRequired: false,
    futureCapabilities: ["Campaign reporting", "Spend", "Clicks", "Impressions"],
  },
  {
    key: "google_search_console",
    name: "Google Search Console",
    category: "SEARCH_GOOGLE",
    family: "google",
    description: "Organic search clicks and impressions for contractor websites.",
    value: "Connect search demand to website leads.",
    oauthReady: true,
    internalLive: false,
    approvalRequired: false,
    futureCapabilities: ["Queries", "Pages", "Clicks"],
  },
  {
    key: "google_analytics",
    name: "Google Analytics",
    category: "SEARCH_GOOGLE",
    family: "google",
    description: "GA4 sessions and landing-page performance for attribution.",
    value: "See which pages produce form leads.",
    oauthReady: true,
    internalLive: false,
    approvalRequired: false,
    futureCapabilities: ["Sessions", "Landing pages", "Source / medium"],
  },
  {
    key: "facebook",
    name: "Facebook",
    category: "SOCIAL",
    family: "meta",
    description: "Facebook Page connection through official Meta APIs.",
    value: "One lead model for Meta and Google.",
    oauthReady: true,
    internalLive: false,
    approvalRequired: true,
    futureCapabilities: ["Page", "Lead ads", "Posts"],
  },
  {
    key: "instagram",
    name: "Instagram",
    category: "SOCIAL",
    family: "meta",
    description: "Instagram professional account linked to a Facebook Page.",
    value: "Draft content here; publish only after a real connection exists.",
    oauthReady: true,
    internalLive: false,
    approvalRequired: true,
    futureCapabilities: ["Business account", "Publishing after approval"],
  },
  {
    key: "meta_ads",
    name: "Meta Ads",
    category: "SOCIAL",
    family: "meta",
    description: "Ad account spend and Lead Ads into ContractorYou leads.",
    value: "Meta campaign → booked → sold → gross profit.",
    oauthReady: true,
    internalLive: false,
    approvalRequired: true,
    futureCapabilities: ["Campaign reporting", "Ad spend", "Lead ads"],
  },
  {
    key: "tiktok",
    name: "TikTok",
    category: "SOCIAL",
    family: "tiktok",
    description: "Official TikTok Login Kit. Publishing waits on approved scopes.",
    value: "Keep contractor content in one operating system.",
    oauthReady: true,
    internalLive: false,
    approvalRequired: true,
    futureCapabilities: ["Account connection", "Content posting after approval"],
  },
  {
    key: "tiktok_ads",
    name: "TikTok Ads",
    category: "SOCIAL",
    family: "tiktok",
    description: "Paid social when TikTok Ads API access is approved.",
    value: "Same attribution path as Google and Meta.",
    oauthReady: true,
    internalLive: false,
    approvalRequired: true,
    futureCapabilities: ["Spend", "Leads"],
  },
  {
    key: "youtube",
    name: "YouTube",
    category: "SOCIAL",
    family: "google",
    description: "YouTube channel metadata through the official Data API.",
    value: "Track video as a lead source when connected.",
    oauthReady: true,
    internalLive: false,
    approvalRequired: false,
    futureCapabilities: ["Channel", "Videos"],
  },
  {
    key: "linkedin",
    name: "LinkedIn",
    category: "SOCIAL",
    family: "linkedin",
    description: "Company Page and marketing APIs when LinkedIn grants product access.",
    value: "Commercial pipeline source.",
    oauthReady: true,
    internalLive: false,
    approvalRequired: true,
    futureCapabilities: ["Page", "Campaign analytics"],
  },
  {
    key: "highlevel",
    name: "HighLevel",
    category: "COMMUNICATION",
    family: "highlevel",
    description: "Preferred phone, SMS, conversations, leads, and marketing automation infrastructure.",
    value: "ContractorYou remains the operating system. HighLevel carries the conversations.",
    oauthReady: true,
    internalLive: false,
    approvalRequired: true,
    futureCapabilities: ["SMS", "Calls", "Inbox", "Leads", "Workflows"],
  },
  {
    key: "business_phone",
    name: "Business Phone",
    category: "COMMUNICATION",
    family: "twilio",
    description: "Call records when a telephony provider is configured. No fake ringing.",
    value: "Missed call → text → booking, when a provider is plugged in.",
    oauthReady: false,
    internalLive: false,
    approvalRequired: false,
    futureCapabilities: ["Inbound / outbound", "Missed calls"],
  },
  {
    key: "sms",
    name: "SMS",
    category: "COMMUNICATION",
    family: "twilio",
    description: "Two-way text when Twilio (or another provider) is configured.",
    value: "Lead response time you can measure.",
    oauthReady: false,
    internalLive: false,
    approvalRequired: false,
    futureCapabilities: ["Send", "Receive"],
  },
  {
    key: "email",
    name: "Email",
    category: "COMMUNICATION",
    family: "resend",
    description: "Transactional customer email through Resend.",
    value: "Estimate follow-up and confirmations with delivery status.",
    oauthReady: false,
    internalLive: false,
    approvalRequired: false,
    futureCapabilities: ["Send", "Delivery events"],
  },
  {
    key: "website_chat",
    name: "Website Chat",
    category: "COMMUNICATION",
    family: "internal",
    description: "Chat widget is not built yet. Website forms are live.",
    value: "Website conversation → booked job.",
    oauthReady: false,
    internalLive: false,
    approvalRequired: false,
    comingSoon: true,
    futureCapabilities: ["Transcript", "Lead create"],
  },
  {
    key: "website_forms",
    name: "Website Forms",
    category: "WEBSITE",
    family: "internal",
    description: "Hosted and embeddable lead forms with UTM capture. Live now.",
    value: "Google Ad → landing page → form → job → revenue.",
    oauthReady: false,
    internalLive: true,
    approvalRequired: false,
    futureCapabilities: ["Hosted form", "Embed", "UTM"],
  },
  {
    key: "landing_pages",
    name: "Landing Pages",
    category: "WEBSITE",
    family: "internal",
    description: "Simple ContractorYou-hosted pages with a lead form.",
    value: "Attribute every form to a page and campaign.",
    oauthReady: false,
    internalLive: true,
    approvalRequired: false,
    futureCapabilities: ["Hosted pages"],
  },
  {
    key: "tracking_numbers",
    name: "Tracking Numbers",
    category: "WEBSITE",
    family: "twilio",
    description: "Map numbers to sources. Live call capture waits on telephony credentials.",
    value: "Know which ad made the phone ring.",
    oauthReady: false,
    internalLive: true,
    approvalRequired: false,
    futureCapabilities: ["Number pool", "Source stamp"],
  },
  {
    key: "utm_tracking",
    name: "UTM / Campaign Tracking",
    category: "WEBSITE",
    family: "internal",
    description: "First-touch and last-touch UTMs on every ContractorYou form.",
    value: "First touch and last touch without guessing.",
    oauthReady: false,
    internalLive: true,
    approvalRequired: false,
    futureCapabilities: ["Auto-capture", "Session id"],
  },
  {
    key: "quickbooks_online",
    name: "QuickBooks Online",
    category: "ACCOUNTING",
    family: "intuit",
    description: "Push invoices and recorded payments. QuickBooks stays the accounting system of record.",
    value: "Do the job here, keep the books in QuickBooks.",
    oauthReady: true,
    internalLive: false,
    approvalRequired: true,
    futureCapabilities: ["Customers", "Invoices", "Recorded payments"],
  },
  {
    key: "stripe_connect",
    name: "ContractorYou Payments (Stripe)",
    category: "PAYMENTS",
    family: "stripe",
    description: "Stripe Connect Express for each company. ContractorYou never stores card or bank credentials.",
    value: "Customer pays the contractor. Payouts go to that company's bank.",
    oauthReady: false,
    internalLive: false,
    approvalRequired: true,
    futureCapabilities: ["Connected-account onboarding", "Payment Element", "ACH", "Refunds", "Payouts"],
  },
];

export const PROVIDER_CATEGORIES: { key: ProviderCategory; label: string }[] = [
  { key: "SEARCH_GOOGLE", label: "Search / Google" },
  { key: "SOCIAL", label: "Social" },
  { key: "COMMUNICATION", label: "Communication" },
  { key: "WEBSITE", label: "Website" },
  { key: "ACCOUNTING", label: "Accounting" },
  { key: "PAYMENTS", label: "Payments" },
];

export function getProvider(key: string) {
  return INTEGRATION_PROVIDERS.find((p) => p.key === key) ?? null;
}

export const GOOGLE_SCOPES: Record<string, string[]> = {
  google_business_profile: [
    "openid",
    "email",
    "https://www.googleapis.com/auth/business.manage",
  ],
  google_ads: ["openid", "email", "https://www.googleapis.com/auth/adwords"],
  google_lsa: ["openid", "email", "https://www.googleapis.com/auth/adwords"],
  google_search_console: ["openid", "email", "https://www.googleapis.com/auth/webmasters.readonly"],
  google_analytics: ["openid", "email", "https://www.googleapis.com/auth/analytics.readonly"],
  youtube: ["openid", "email", "https://www.googleapis.com/auth/youtube.readonly"],
};

export const META_SCOPES: Record<string, string[]> = {
  facebook: ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "business_management"],
  instagram: ["pages_show_list", "instagram_basic", "instagram_manage_insights", "business_management"],
  meta_ads: ["ads_read", "pages_show_list", "leads_retrieval", "business_management"],
};

export const TIKTOK_SCOPES: Record<string, string[]> = {
  tiktok: ["user.info.basic", "video.list"],
  tiktok_ads: ["user.info.basic"],
};

export const LINKEDIN_SCOPES: Record<string, string[]> = {
  linkedin: ["openid", "profile", "email", "r_organization_social"],
};
