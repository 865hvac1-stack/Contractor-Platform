import type { IntegrationAccount, IntegrationConnection } from "@prisma/client";

type Conn = IntegrationConnection & { accounts: IntegrationAccount[] };

export async function listTikTokAccounts(accessToken: string) {
  const res = await fetch(
    "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const json = (await res.json()) as {
    data?: { user?: { open_id?: string; display_name?: string; username?: string } };
    error?: { message?: string };
  };
  if (!res.ok || !json.data?.user?.open_id) {
    return {
      error: json.error?.message || "TikTok user info is not available for this app.",
      accounts: [] as { id: string; name: string; kind: string }[],
    };
  }
  const user = json.data.user;
  return {
    accounts: [
      {
        id: user.open_id!,
        name: user.display_name || user.username || "TikTok account",
        kind: "user",
      },
    ],
  };
}

export async function syncTikTokProvider(input: { connection: Conn; accessToken: string }) {
  const listed = await listTikTokAccounts(input.accessToken);
  if (listed.error) throw new Error(listed.error);
  return listed.accounts.length;
}
