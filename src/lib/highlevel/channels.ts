export function normalizeHighLevelChannel(raw?: string | null) {
  const value = (raw ?? "").toUpperCase();
  if (value.includes("VOICEMAIL")) return "VOICEMAIL";
  if (value.includes("CALL")) return "CALL";
  if (value.includes("EMAIL")) return "EMAIL";
  if (value.includes("SMS") || value.includes("TEXT")) return "SMS";
  if (value.includes("FACEBOOK") || value.includes("FB")) return "FACEBOOK";
  if (value.includes("INSTAGRAM") || value.includes("IG")) return "INSTAGRAM";
  if (value.includes("GMB") || value.includes("GOOGLE")) return "GOOGLE";
  if (value.includes("WHATSAPP")) return "WHATSAPP";
  if (value.includes("LIVE_CHAT") || value.includes("WEBCHAT") || value.includes("CHAT")) return "CHAT";
  return value.replace(/^TYPE_/, "") || "OTHER";
}

export function normalizeHighLevelDirection(raw?: string | null) {
  const value = (raw ?? "").toLowerCase();
  if (value.includes("out")) return "OUTBOUND";
  return "INBOUND";
}

export function highlevelPlatformToChannel(platform?: string | null) {
  const value = (platform ?? "").toLowerCase();
  if (value === "facebook") return "FACEBOOK";
  if (value === "instagram") return "INSTAGRAM";
  if (value === "google" || value === "gmb" || value === "gbp") return "GOOGLE_BUSINESS_PROFILE";
  if (value === "tiktok") return "TIKTOK";
  if (value === "linkedin") return "LINKEDIN";
  if (value === "youtube") return "YOUTUBE";
  return null;
}
