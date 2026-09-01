export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

export function emailFromAddress() {
  return (
    process.env.EMAIL_FROM?.trim() ||
    process.env.RESEND_FROM?.trim() ||
    "ContractorYou <noreply@mail.contractoryou.com>"
  );
}

export type EmailSendResult =
  | { ok: true; providerId: string | null }
  | { ok: false; error: string; configured: boolean };

export async function sendTransactionalEmail(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
  companyId?: string | null;
}): Promise<EmailSendResult> {
  if (input.companyId) {
    const { demoOutboundBlock } = await import("@/lib/demo/guard");
    const blocked = await demoOutboundBlock(input.companyId);
    if (blocked.blocked) return { ok: false, error: blocked.message, configured: true };
  }
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) {
    return { ok: false, configured: false, error: "Email is not configured. Set RESEND_API_KEY (and EMAIL_FROM) on the server." };
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: emailFromAddress(),
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });
  if (!response.ok) {
    await response.text();
    return {
      ok: false,
      configured: true,
      error: `Email provider rejected the send (${response.status}).`,
    };
  }
  const data = (await response.json().catch(() => ({}))) as { id?: string };
  return { ok: true, providerId: data.id ?? null };
}
