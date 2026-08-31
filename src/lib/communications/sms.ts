export function smsProviderConfigured() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
      process.env.TWILIO_AUTH_TOKEN?.trim() &&
      twilioFromNumber()
  );
}

export function twilioFromNumber() {
  return process.env.TWILIO_FROM_NUMBER?.trim() || process.env.TWILIO_PHONE_NUMBER?.trim() || "";
}

export type SmsSendResult =
  | { ok: true; providerId: string | null }
  | { ok: false; configured: boolean; error: string };

export async function sendCompanySms(input: { to: string; body: string }): Promise<SmsSendResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = twilioFromNumber();
  if (!sid || !token || !from) {
    return {
      ok: false,
      configured: false,
      error: "Company communications are not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER.",
    };
  }
  const to = input.to.trim();
  if (!to) return { ok: false, configured: true, error: "No customer phone number to text." };

  const body = new URLSearchParams({ To: to, From: from, Body: input.body });
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!response.ok) {
    return { ok: false, configured: true, error: `SMS provider rejected the send (${response.status}).` };
  }
  const data = (await response.json().catch(() => ({}))) as { sid?: string };
  return { ok: true, providerId: data.sid ?? null };
}
