export const HIGHLEVEL_PROVIDER_KEY = "highlevel";

export const HIGHLEVEL_API_BASE = "https://services.leadconnectorhq.com";
export const HIGHLEVEL_AUTHORIZE_URL = "https://marketplace.gohighlevel.com/oauth/chooselocation";
export const HIGHLEVEL_AUTHORIZE_URL_WHITELABEL = "https://marketplace.leadconnectorhq.com/oauth/chooselocation";
export const HIGHLEVEL_API_VERSION = "2021-07-28";
export const HIGHLEVEL_CONVERSATIONS_API_VERSION = "2021-04-15";
export const HIGHLEVEL_PHONE_API_VERSION = "v3";
/** Official Get Location docs require Version v3. */
export const HIGHLEVEL_LOCATION_API_VERSION = "v3";
export const HIGHLEVEL_LOCATION_GET_ENDPOINT = "GET /locations/:locationId";

/**
 * Official HighLevel OAuth scopes for Marketplace location (Sub-Account) install.
 * Catalog: https://marketplace.gohighlevel.com/docs/Authorization/Scopes/
 *
 * Excluded after HighLevel rejected them on Marketplace location install:
 * - locations.write — Agency-only
 * - phonenumbers.write — not in the official Scopes catalog
 * - numberpools.read — HighLevel Invalid scope on app v1.0.0
 * - socialplanner/account.write — HighLevel Invalid scope on app v1.0.0
 */
export const HIGHLEVEL_SCOPES = [
  "locations.readonly",
  "contacts.readonly",
  "contacts.write",
  "conversations.readonly",
  "conversations.write",
  "conversations/message.readonly",
  "conversations/message.write",
  "opportunities.readonly",
  "calendars.readonly",
  "workflows.readonly",
  "phonenumbers.read",
  "socialplanner/account.readonly",
  "socialplanner/post.readonly",
  "socialplanner/post.write",
] as const;

/** Scope names that must never be sent on Marketplace location OAuth, including Railway HIGHLEVEL_SCOPES overrides. */
export const HIGHLEVEL_OAUTH_EXCLUDED_SCOPES = [
  "locations.write",
  "phonenumbers.write",
  "numberpools.read",
  "socialplanner/account.write",
] as const;

export const SMS_DEFAULT_CHANNEL = "SMS_DEFAULT";
export const HL_DEFAULT_CHANNEL = "HL_DEFAULT";

export const HIGHLEVEL_MANAGED_CHANNELS = new Set([
  "business_phone",
  "sms",
  "website_chat",
  "facebook",
  "instagram",
  "google_business_profile",
  "tiktok",
  "linkedin",
  "youtube",
]);

export const HIGHLEVEL_DEEP_LINKS = {
  workflows: "https://app.gohighlevel.com/",
  conversations: "https://app.gohighlevel.com/",
  campaigns: "https://app.gohighlevel.com/",
};

export const HIGHLEVEL_ED25519_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=
-----END PUBLIC KEY-----`;

export const HIGHLEVEL_RSA_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAokvo/r9tVgcfZ5DysOSCFrm602qYV0MaAiNnX9O8KxMbiyRKWeL9JpCpVpt4XHIcBOK4u3cLSqJGOLaPuXw6dO0t6Q/ZVdAV5Phz+ZtzPL16iCGeK9po6D6JHBpbi989mmzMryUnQJezlYJ3DVfBcsedpinheNnyYeFXolrJvcsjDtfAeRx5ByHQmTnSdFUzuAnC9/GepgLT9SM4nCpvuxmZMxrJt5Rw+VUaQ9B8JSvbMPpez4peKaJPZHBbU3OdeCVx5klVXXZQGNHOs8gF3kvoV5rTnXV0IknLBXlcKKAQLZcY/Q9rG6Ifi9c+5vqlvHPCUJFT5XUGG5RKgOKUJ062fRtN+rLYZUV+BjafxQauvC8wSWeYja63VSUruvmNj8xkx2zE/Juc+yjLjTXpIocmaiFeAO6fUtNjDeFVkhf5LNb59vECyrHD2SQIrhgXpO4Q3dVNA5rw576PwTzNh/AMfHKIjE4xQA1SZuYJmNnmVZLIZBlQAF9Ntd03rfadZ+yDiOXCCs9FkHibELhCHULgCsnuDJHcrGNd5/Ddm5hxGQ0ASitgHeMZ0kcIOwKDOzOU53lDza6/Y09T7sYJPQe7z0cvj7aE4B+Ax1ZoZGPzpJlZtGXCsu9aTEGEnKzmsFqwcSsnw3JB31IGKAykT1hhTiaCeIY/OwwwNUY2yvcCAwEAAQ==
-----END PUBLIC KEY-----`;

export type HighLevelAuthMode = "oauth" | "private_token";
