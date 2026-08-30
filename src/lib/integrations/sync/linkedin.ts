import type { IntegrationAccount, IntegrationConnection } from "@prisma/client";

type Conn = IntegrationConnection & { accounts: IntegrationAccount[] };

export async function listLinkedInAccounts(accessToken: string) {
  const res = await fetch("https://api.linkedin.com/v2/organizationalEntityAcls?q=roleAssignee", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = (await res.json()) as {
    elements?: { organizationalTarget?: string }[];
    message?: string;
    serviceErrorCode?: number;
  };
  if (!res.ok) {
    return {
      error:
        json.message ||
        "LinkedIn organization access is not available. Marketing / Community Management product access is required.",
      accounts: [] as { id: string; name: string; kind: string }[],
    };
  }
  return {
    accounts: (json.elements ?? [])
      .map((row) => row.organizationalTarget)
      .filter((id): id is string => Boolean(id))
      .map((id) => ({ id, name: id, kind: "organization" })),
  };
}

export async function syncLinkedInProvider(input: { connection: Conn; accessToken: string }) {
  const listed = await listLinkedInAccounts(input.accessToken);
  if (listed.error) throw new Error(listed.error);
  return listed.accounts.length;
}
