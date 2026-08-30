/**
 * ContractorYou brand and theme tokens.
 * Restyle the product from this file + CSS variables — do not hard-code colors in screens.
 */
export const brand = {
  name: "ContractorYou",
  wordmarkPrimary: "CONTRACTOR",
  wordmarkAccent: "YOU",
  mark: "CY",
  positioning: "The Operating System for Contractors",
  headline: "YOUR BUSINESS. YOUR WAY.",
  tagline: "Less office work. More visibility. Better follow-up. Better margins.",
  colors: {
    navy: "#0B1220",
    navySoft: "#141C2E",
    orange: "#F87000",
    orangeHover: "#E03800",
    orangeDeep: "#D83200",
    orangeBright: "#FFC14D",
    orangeMuted: "#FFF1EA",
    white: "#FFFFFF",
    gray: "#F4F6F8",
    grayBorder: "#E4E7EC",
    text: "#0B1220",
    textSecondary: "#5B6573",
    textMuted: "#8B93A0",
  },
} as const;

export const industries = [
  { value: "HVAC", label: "HVAC" },
  { value: "PLUMBING", label: "Plumbing" },
  { value: "ELECTRICAL", label: "Electrical" },
  { value: "ROOFING", label: "Roofing" },
  { value: "POOL_SERVICE", label: "Pool Service" },
  { value: "EXCAVATION", label: "Excavation" },
  { value: "CONCRETE", label: "Concrete" },
  { value: "LANDSCAPING", label: "Landscaping" },
  { value: "GENERAL_CONTRACTOR", label: "General Contractor" },
  { value: "OTHER", label: "Other" },
] as const;

export const companySizes = [
  { value: "1", label: "Just me" },
  { value: "2-5", label: "2–5 people" },
  { value: "6-15", label: "6–15 people" },
  { value: "16-50", label: "16–50 people" },
  { value: "50+", label: "50+ people" },
] as const;
