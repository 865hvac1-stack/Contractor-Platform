import type { IntegrationAccount, IntegrationConnection } from "@prisma/client";
import { googleGet } from "@/lib/integrations/oauth/google";
import { recordMetricSnapshot, upsertExternalLead, upsertExternalReview, upsertMarketingSpend } from "@/lib/integrations/ingest";

type Conn = IntegrationConnection & { accounts: IntegrationAccount[] };

function selected(connection: Conn, kind: string) {
  return connection.accounts.filter((a) => a.kind === kind && a.selected);
}

export async function listGoogleAccounts(providerKey: string, accessToken: string) {
  if (providerKey === "google_business_profile") {
    const accounts = await googleGet(
      accessToken,
      "https://mybusinessaccountmanagement.googleapis.com/v1/accounts"
    );
    if (!accounts.ok) {
      return {
        error:
          (accounts.json.error as { message?: string } | undefined)?.message ||
          "Google Business Profile API is not enabled or this project is not approved. Request GBP API access in Google Cloud.",
        accounts: [] as { id: string; name: string; kind: string }[],
      };
    }
    const list = ((accounts.json.accounts as { name?: string; accountName?: string }[]) ?? []).map((a) => ({
      id: a.name || "",
      name: a.accountName || a.name || "Google Business account",
      kind: "account",
    }));
    const locations: { id: string; name: string; kind: string }[] = [];
    for (const account of list.filter((a) => a.id)) {
      const locRes = await googleGet(
        accessToken,
        `https://mybusinessbusinessinformation.googleapis.com/v1/${account.id}/locations?readMask=name,title,storefrontAddress`
      );
      const locRows =
        (locRes.json.locations as {
          name?: string;
          title?: string;
          storefrontAddress?: { locality?: string };
        }[]) ?? [];
      for (const loc of locRows) {
        if (!loc.name) continue;
        locations.push({
          id: loc.name,
          name: `${loc.title || loc.name}${loc.storefrontAddress?.locality ? ` — ${loc.storefrontAddress.locality}` : ""}`,
          kind: "location",
        });
      }
    }
    return { accounts: [...list.filter((a) => a.id), ...locations] };
  }

  if (providerKey === "google_ads" || providerKey === "google_lsa") {
    const res = await fetch("https://googleads.googleapis.com/v17/customers:listAccessibleCustomers", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "",
      },
    });
    const json = (await res.json().catch(() => ({}))) as {
      resourceNames?: string[];
      error?: { message?: string };
    };
    if (!res.ok) {
      return {
        error:
          json.error?.message ||
          "Google Ads API denied the request. Confirm GOOGLE_ADS_DEVELOPER_TOKEN and that this Google account can access an Ads customer.",
        accounts: [],
      };
    }
    return {
      accounts: (json.resourceNames ?? []).map((name) => ({
        id: name.replace("customers/", ""),
        name: `Ads customer ${name.replace("customers/", "")}`,
        kind: "ads_customer",
      })),
    };
  }

  if (providerKey === "google_analytics") {
    const res = await googleGet(
      accessToken,
      "https://analyticsadmin.googleapis.com/v1beta/accountSummaries"
    );
    if (!res.ok) {
      return {
        error:
          (res.json.error as { message?: string } | undefined)?.message ||
          "Google Analytics Admin API is not enabled or this account has no GA4 properties.",
        accounts: [],
      };
    }
    const summaries = (res.json.accountSummaries as {
      account?: string;
      displayName?: string;
      propertySummaries?: { property?: string; displayName?: string }[];
    }[]) ?? [];
    const accounts = summaries.flatMap((summary) =>
      (summary.propertySummaries ?? []).map((property) => ({
        id: property.property || "",
        name: `${summary.displayName || "GA4"} / ${property.displayName || property.property}`,
        kind: "ga4_property",
      }))
    );
    return { accounts: accounts.filter((a) => a.id) };
  }

  if (providerKey === "google_search_console") {
    const res = await googleGet(accessToken, "https://searchconsole.googleapis.com/webmasters/v3/sites");
    if (!res.ok) {
      return {
        error:
          (res.json.error as { message?: string } | undefined)?.message ||
          "Search Console API is not enabled or this account has no verified properties.",
        accounts: [],
      };
    }
    const sites = ((res.json.siteEntry as { siteUrl?: string }[]) ?? []).map((site) => ({
      id: site.siteUrl || "",
      name: site.siteUrl || "Search Console property",
      kind: "site",
    }));
    return { accounts: sites.filter((a) => a.id) };
  }

  if (providerKey === "youtube") {
    const res = await googleGet(
      accessToken,
      "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true"
    );
    if (!res.ok) {
      return {
        error:
          (res.json.error as { message?: string } | undefined)?.message ||
          "YouTube Data API is not enabled for this project.",
        accounts: [],
      };
    }
    const items = ((res.json.items as { id?: string; snippet?: { title?: string } }[]) ?? []).map((item) => ({
      id: item.id || "",
      name: item.snippet?.title || "YouTube channel",
      kind: "channel",
    }));
    return { accounts: items.filter((a) => a.id) };
  }

  return { accounts: [] };
}

export async function syncGoogleProvider(input: { connection: Conn; accessToken: string }) {
  const { connection, accessToken } = input;
  let count = 0;
  if (connection.providerKey === "google_business_profile") {
    count += await syncGbp(connection, accessToken);
  } else if (connection.providerKey === "google_ads") {
    count += await syncGoogleAds(connection, accessToken);
  } else if (connection.providerKey === "google_lsa") {
    count += await syncLsaLeads(connection, accessToken);
  } else if (connection.providerKey === "google_analytics") {
    count += await syncGa4(connection, accessToken);
  } else if (connection.providerKey === "google_search_console") {
    count += await syncGsc(connection, accessToken);
  } else if (connection.providerKey === "youtube") {
    count += await syncYoutube(connection, accessToken);
  }
  return count;
}

async function syncGbp(connection: Conn, accessToken: string) {
  const locations = selected(connection, "location");
  if (locations.length === 0) {
    throw new Error("Select a Google Business Profile location before syncing.");
  }
  let imported = 0;
  for (const parent of locations) {
    const reviews = await googleGet(
      accessToken,
      `https://mybusiness.googleapis.com/v4/${parent.externalId}/reviews`
    );
    if (!reviews.ok) {
      throw new Error(
        (reviews.json.error as { message?: string } | undefined)?.message ||
          "Google Business Profile reviews are not available. Confirm API approval and that a location is selected."
      );
    }
    const rows = (reviews.json.reviews as {
      reviewId?: string;
      reviewer?: { displayName?: string };
      starRating?: string;
      comment?: string;
      createTime?: string;
      reviewReply?: { comment?: string; updateTime?: string };
    }[]) ?? [];
    const stars: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
    for (const review of rows) {
      if (!review.reviewId) continue;
      await upsertExternalReview({
        companyId: connection.companyId,
        provider: "google_business_profile",
        externalId: `${parent.externalId}/reviews/${review.reviewId}`,
        rating: stars[review.starRating || ""] ?? 0,
        authorName: review.reviewer?.displayName ?? null,
        body: review.comment ?? null,
        reviewedAt: review.createTime ? new Date(review.createTime) : new Date(),
        respondedAt: review.reviewReply?.updateTime ? new Date(review.reviewReply.updateTime) : null,
      });
      imported += 1;
    }
  }
  return imported;
}

async function googleAdsSearch(accessToken: string, customerId: string, query: string) {
  const login = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/-/g, "");
  const res = await fetch(
    `https://googleads.googleapis.com/v17/customers/${customerId}/googleAds:search`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "",
        ...(login ? { "login-customer-id": login } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    }
  );
  const json = (await res.json().catch(() => ({}))) as {
    results?: Record<string, unknown>[];
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(json.error?.message || "Google Ads query failed.");
  }
  return json.results ?? [];
}

async function syncGoogleAds(connection: Conn, accessToken: string) {
  const customers = selected(connection, "ads_customer");
  if (customers.length === 0) {
    throw new Error("Select a Google Ads customer account before syncing.");
  }
  let imported = 0;
  const start = new Date();
  start.setDate(start.getDate() - 7);
    for (const customer of customers) {
    const rows = await googleAdsSearch(
      accessToken,
      customer.externalId,
      `SELECT campaign.id, campaign.name, campaign.status, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, segments.date FROM campaign WHERE segments.date DURING LAST_7_DAYS`
    );
    for (const row of rows) {
      const campaign = row.campaign as { id?: string; name?: string } | undefined;
      const metrics = row.metrics as { costMicros?: string } | undefined;
      const segment = row.segments as { date?: string } | undefined;
      if (!campaign?.id || !segment?.date) continue;
      const micros = Number(metrics?.costMicros ?? 0);
      await upsertMarketingSpend({
        companyId: connection.companyId,
        source: "GOOGLE_ADS",
        provider: "google_ads",
        externalId: `${customer.externalId}:${campaign.id}:${segment.date}`,
        campaignName: campaign.name ?? null,
        periodStart: new Date(`${segment.date}T00:00:00.000Z`),
        periodEnd: new Date(`${segment.date}T23:59:59.000Z`),
        amountCents: Math.round(micros / 10_000),
      });
      imported += 1;
    }
  }
  return imported;
}

async function syncLsaLeads(connection: Conn, accessToken: string) {
  const customers = selected(connection, "ads_customer");
  if (customers.length === 0) {
    throw new Error("Select a Google Ads customer that owns Local Services Ads.");
  }
  let imported = 0;
  for (const customer of customers) {
    const rows = await googleAdsSearch(
      accessToken,
      customer.externalId,
      `SELECT local_services_lead.id, local_services_lead.lead_type, local_services_lead.lead_status, local_services_lead.category_id, local_services_lead.service_id, local_services_lead.creation_date_time, local_services_lead.contact_details FROM local_services_lead`
    );
    for (const row of rows) {
      const lead = row.localServicesLead as {
        id?: string;
        leadType?: string;
        leadStatus?: string;
        categoryId?: string;
        creationDateTime?: string;
        contactDetails?: { phoneNumber?: string; email?: string; consumerName?: string };
      } | undefined;
      if (!lead?.id) continue;
      const name = (lead.contactDetails?.consumerName || "LSA Lead").split(" ");
      await upsertExternalLead({
        companyId: connection.companyId,
        provider: "google_lsa",
        externalLeadId: String(lead.id),
        source: "GOOGLE_LSA",
        firstName: name[0] || "LSA",
        lastName: name.slice(1).join(" ") || "Lead",
        phone: lead.contactDetails?.phoneNumber ?? null,
        email: lead.contactDetails?.email ?? null,
        sourceDetail: lead.leadType ?? null,
        message: lead.leadStatus ?? null,
        receivedAt: lead.creationDateTime ? new Date(lead.creationDateTime) : new Date(),
      });
      imported += 1;
    }
  }
  return imported;
}

async function syncGa4(connection: Conn, accessToken: string) {
  const properties = selected(connection, "ga4_property");
  if (properties.length === 0) throw new Error("Select a GA4 property before syncing.");
  let imported = 0;
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 7);
  for (const property of properties) {
    const res = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/${property.externalId}:runReport`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dateRanges: [
            { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) },
          ],
          dimensions: [{ name: "sessionSource" }, { name: "sessionMedium" }, { name: "date" }],
          metrics: [{ name: "sessions" }, { name: "totalUsers" }],
        }),
      }
    );
    const json = (await res.json()) as {
      rows?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[];
      error?: { message?: string };
    };
    if (!res.ok) {
      throw new Error(json.error?.message || "Google Analytics Data API request failed.");
    }
    for (const row of json.rows ?? []) {
      const date = row.dimensionValues?.[2]?.value;
      const sessions = Number(row.metricValues?.[0]?.value ?? 0);
      if (!date) continue;
      await recordMetricSnapshot({
        companyId: connection.companyId,
        metricKey: `ga4.sessions.${row.dimensionValues?.[0]?.value || "direct"}`,
        periodStart: new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T00:00:00.000Z`),
        periodEnd: new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T23:59:59.000Z`),
        grain: "day",
        value: sessions,
        sampleSize: sessions,
      });
      imported += 1;
    }
  }
  return imported;
}

async function syncGsc(connection: Conn, accessToken: string) {
  const sites = selected(connection, "site");
  if (sites.length === 0) throw new Error("Select a Search Console property before syncing.");
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 7);
  let imported = 0;
  for (const site of sites) {
    const res = await fetch(
      `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site.externalId)}/searchAnalytics/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate: start.toISOString().slice(0, 10),
          endDate: end.toISOString().slice(0, 10),
          dimensions: ["date"],
        }),
      }
    );
    const json = (await res.json()) as {
      rows?: { keys?: string[]; clicks?: number; impressions?: number }[];
      error?: { message?: string };
    };
    if (!res.ok) {
      throw new Error(json.error?.message || "Search Console query failed.");
    }
    for (const row of json.rows ?? []) {
      const date = row.keys?.[0];
      if (!date) continue;
      await recordMetricSnapshot({
        companyId: connection.companyId,
        metricKey: `gsc.clicks.${site.externalId}`,
        periodStart: new Date(`${date}T00:00:00.000Z`),
        periodEnd: new Date(`${date}T23:59:59.000Z`),
        grain: "day",
        value: row.clicks ?? 0,
        sampleSize: row.impressions ?? 0,
      });
      imported += 1;
    }
  }
  return imported;
}

async function syncYoutube(connection: Conn, accessToken: string) {
  const channels = selected(connection, "channel");
  const query = channels[0]
    ? `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${encodeURIComponent(channels[0].externalId)}&maxResults=10&order=date&type=video`
    : "https://www.googleapis.com/youtube/v3/search?part=snippet&forMine=true&maxResults=10&type=video";
  const res = await googleGet(accessToken, query);
  if (!res.ok) {
    throw new Error(
      (res.json.error as { message?: string } | undefined)?.message ||
        "YouTube Data API request failed."
    );
  }
  return ((res.json.items as unknown[]) ?? []).length;
}
