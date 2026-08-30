import type { IntegrationAccount, IntegrationConnection } from "@prisma/client";
import { metaGet } from "@/lib/integrations/oauth/meta";
import { upsertExternalLead, upsertMarketingSpend } from "@/lib/integrations/ingest";

type Conn = IntegrationConnection & { accounts: IntegrationAccount[] };

export async function listMetaAccounts(providerKey: string, accessToken: string) {
  if (providerKey === "facebook" || providerKey === "instagram") {
    const pages = await metaGet(accessToken, "me/accounts?fields=id,name,access_token,instagram_business_account");
    if (!pages.ok) {
      return {
        error:
          (pages.json.error as { message?: string } | undefined)?.message ||
          "Meta did not return Pages. Confirm the app has pages_show_list and that this user is a Page admin.",
        accounts: [] as { id: string; name: string; kind: string }[],
      };
    }
    const data = (pages.json.data as {
      id?: string;
      name?: string;
      instagram_business_account?: { id?: string };
    }[]) ?? [];
    if (providerKey === "instagram") {
      return {
        accounts: data
          .filter((page) => page.instagram_business_account?.id)
          .map((page) => ({
            id: page.instagram_business_account!.id!,
            name: `${page.name || "Page"} Instagram`,
            kind: "instagram",
          })),
      };
    }
    return {
      accounts: data
        .filter((page) => page.id)
        .map((page) => ({ id: page.id!, name: page.name || page.id!, kind: "page" })),
    };
  }

  const ads = await metaGet(accessToken, "me/adaccounts?fields=id,name,account_id");
  if (!ads.ok) {
    return {
      error:
        (ads.json.error as { message?: string } | undefined)?.message ||
        "Meta Ads accounts are not available. ads_read and App Review may be required.",
      accounts: [],
    };
  }
  const data = (ads.json.data as { id?: string; name?: string; account_id?: string }[]) ?? [];
  return {
    accounts: data
      .filter((row) => row.id)
      .map((row) => ({
        id: row.id!,
        name: row.name || row.account_id || row.id!,
        kind: "ad_account",
      })),
  };
}

export async function syncMetaProvider(input: { connection: Conn; accessToken: string }) {
  const { connection, accessToken } = input;
  let count = 0;
  if (connection.providerKey === "meta_ads") {
    const accounts = connection.accounts.filter((a) => a.kind === "ad_account" && a.selected);
    if (accounts.length === 0) throw new Error("Select a Meta ad account before syncing.");
    const since = new Date();
    since.setDate(since.getDate() - 7);
    const until = new Date();
    for (const account of accounts) {
      const insights = await metaGet(
        accessToken,
        `${account.externalId}/insights?fields=campaign_name,spend,impressions,clicks,actions&time_range={'since':'${since.toISOString().slice(0, 10)}','until':'${until.toISOString().slice(0, 10)}'}&level=campaign`
      );
      if (!insights.ok) {
        throw new Error(
          (insights.json.error as { message?: string } | undefined)?.message ||
            "Meta Ads insights are not available. App Review may still be required."
        );
      }
      const rows = (insights.json.data as {
        campaign_id?: string;
        campaign_name?: string;
        spend?: string;
        date_start?: string;
      }[]) ?? [];
      for (const row of rows) {
        const externalId = `${account.externalId}:${row.campaign_name || "campaign"}:${row.date_start || "range"}`;
        await upsertMarketingSpend({
          companyId: connection.companyId,
          source: "META_ADS",
          provider: "meta_ads",
          externalId,
          campaignName: row.campaign_name ?? null,
          periodStart: row.date_start ? new Date(`${row.date_start}T00:00:00.000Z`) : since,
          periodEnd: until,
          amountCents: Math.round(Number(row.spend || 0) * 100),
        });
        count += 1;
      }

      const leads = await metaGet(accessToken, `${account.externalId}/leads?fields=id,created_time,field_data`);
      if (leads.ok) {
        const leadRows = (leads.json.data as {
          id?: string;
          created_time?: string;
          field_data?: { name?: string; values?: string[] }[];
        }[]) ?? [];
        for (const lead of leadRows) {
          if (!lead.id) continue;
          const fields = Object.fromEntries(
            (lead.field_data ?? []).map((field) => [field.name || "", field.values?.[0] || ""])
          );
          const full = (fields.full_name || `${fields.first_name || ""} ${fields.last_name || ""}`).trim();
          const [first, ...rest] = full.split(" ");
          await upsertExternalLead({
            companyId: connection.companyId,
            provider: "meta_ads",
            externalLeadId: lead.id,
            source: "META_ADS",
            firstName: first || "Meta",
            lastName: rest.join(" ") || "Lead",
            phone: fields.phone_number || null,
            email: fields.email || null,
            receivedAt: lead.created_time ? new Date(lead.created_time) : new Date(),
          });
          count += 1;
        }
      }
    }
  }
  return count;
}
