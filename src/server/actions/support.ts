"use server";

import { requireTenant } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { publicActionError } from "@/lib/action-errors";
import { sendTransactionalEmail } from "@/lib/email/resend";
import { supportEmail } from "@/lib/support";
import type { ActionResult } from "@/server/actions/auth";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export async function submitSupportRequestAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requireTenant();
    const subject = String(formData.get("subject") || "").trim();
    const message = String(formData.get("message") || "").trim();
    if (subject.length < 3) return { ok: false, error: "Enter a short subject." };
    if (message.length < 10) return { ok: false, error: "Enter a message with enough detail for us to help." };

    const name = `${ctx.user.firstName} ${ctx.user.lastName}`.trim();
    const company = ctx.company.businessName;
    const email = ctx.user.email;
    const destination = supportEmail();
    const text = [
      `Name: ${name}`,
      `Company: ${company}`,
      `Email: ${email}`,
      `Role: ${ctx.role}`,
      `Subject: ${subject}`,
      "",
      message,
    ].join("\n");
    const html = `<pre style="font-family:system-ui,sans-serif;white-space:pre-wrap;">${escapeHtml(text)}</pre>`;

    const sent = await sendTransactionalEmail({
      to: destination,
      replyTo: email,
      subject: `[ContractorYou Support] ${subject}`.slice(0, 200),
      html,
      text,
      companyId: ctx.company.id,
    });

    if (!sent.ok) {
      return {
        ok: false,
        error: sent.configured
          ? sent.error
          : `Support email is not configured on the server. Email ${destination} directly. Nothing was sent.`,
      };
    }

    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "support.request.sent",
      entityType: "SupportRequest",
      metadata: { subject, destination },
    });
    return { ok: true, message: `Your message was sent to ContractorYou support (${destination}).` };
  } catch (error) {
    return { ok: false, error: publicActionError(error) };
  }
}
