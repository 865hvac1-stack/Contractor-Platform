import type { LeadSource, LeadStatus } from "@prisma/client";

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  GOOGLE_BUSINESS_PROFILE: "Google Business Profile",
  GOOGLE_LSA: "Google Local Services Ads",
  GOOGLE_ADS: "Google Ads",
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  WEBSITE: "Website",
  PHONE: "Phone",
  SMS: "SMS",
  EMAIL: "Email",
  REFERRAL: "Referral",
  REPEAT_CUSTOMER: "Repeat customer",
  ORGANIC_SEARCH: "Organic search",
  DIRECT: "Direct",
  MANUAL: "Manual entry",
  OTHER: "Other",
  TIKTOK: "TikTok",
  LINKEDIN: "LinkedIn",
  YOUTUBE: "YouTube",
  META_ADS: "Meta Ads",
};

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  BOOKED: "Booked",
  ESTIMATE_SCHEDULED: "Estimate scheduled",
  ESTIMATE_SENT: "Estimate sent",
  WON: "Won",
  LOST: "Lost",
  SPAM: "Spam",
};

export const BOOKED_LEAD_STATUSES: LeadStatus[] = [
  "BOOKED",
  "ESTIMATE_SCHEDULED",
  "ESTIMATE_SENT",
  "WON",
];

export const OPEN_LEAD_STATUSES: LeadStatus[] = [
  "NEW",
  "CONTACTED",
  "BOOKED",
  "ESTIMATE_SCHEDULED",
  "ESTIMATE_SENT",
];

export const SOLD_LEAD_STATUSES: LeadStatus[] = ["WON"];

export const LEAD_SOURCES = Object.keys(LEAD_SOURCE_LABELS) as LeadSource[];
export const LEAD_STATUSES = Object.keys(LEAD_STATUS_LABELS) as LeadStatus[];
