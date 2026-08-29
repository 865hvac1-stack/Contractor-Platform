/**
 * Centralized brand / theme tokens.
 * Rebrand by changing these values — avoid hard-coding colors in components.
 */
export const brand = {
  name: "Contractor OS",
  tagline: "Less office work. More visibility. Better margins.",
  accent: {
    DEFAULT: "#0F766E", // teal-700 — strong, rebrandable
    hover: "#0D9488",
    muted: "#CCFBF1",
    foreground: "#FFFFFF",
  },
  surface: {
    page: "#F7F6F3",
    card: "#FFFFFF",
    border: "#E7E5E0",
    muted: "#F0EEE9",
  },
  text: {
    primary: "#1C1917",
    secondary: "#57534E",
    muted: "#A8A29E",
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
