import { emailFromAddress } from "@/lib/email/resend";
import { ROLE_LABELS } from "@/lib/permissions";
import type { CompanyRole } from "@prisma/client";

export function inviteSetupUrl(appUrl: string, token: string) {
  return `${appUrl.replace(/\/$/, "")}/invite/${encodeURIComponent(token)}`;
}

export function inviteEmailCopy(input: {
  companyName: string;
  role: CompanyRole;
  setupUrl: string;
}) {
  const role = ROLE_LABELS[input.role] ?? "team member";
  const subject = `You've been invited to join ${input.companyName} on ContractorYou`;
  const text = [
    `You've been invited to join ${input.companyName} on ContractorYou.`,
    `You'll sign in as a ${role}.`,
    `Set up your account: ${input.setupUrl}`,
    `This link expires and can be used once.`,
  ].join("\n\n");
  const html = `<!doctype html>
<html>
<body style="margin:0;background:#F4F2EE;font-family:Inter,system-ui,sans-serif;color:#0B1220;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F2EE;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;padding:32px 28px;border:1px solid #E8E6E1;">
          <tr><td style="font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#F87000;font-weight:700;">ContractorYou</td></tr>
          <tr><td style="padding-top:12px;font-size:22px;font-weight:700;line-height:1.3;">You've been invited to join ${escapeHtml(input.companyName)}</td></tr>
          <tr><td style="padding-top:12px;font-size:15px;line-height:1.5;color:#5C6570;">Set up your account to work jobs in the field as a ${escapeHtml(role)}.</td></tr>
          <tr>
            <td style="padding-top:24px;">
              <a href="${input.setupUrl}" style="display:inline-block;background:#F87000;color:#ffffff;text-decoration:none;font-weight:600;padding:14px 20px;border-radius:12px;">Set up my account</a>
            </td>
          </tr>
          <tr><td style="padding-top:20px;font-size:12px;color:#5C6570;">This invitation expires and can be used once. If you were not expecting this, ignore the email.</td></tr>
          <tr><td style="padding-top:8px;font-size:11px;color:#8A9199;">Sent via ${escapeHtml(emailFromAddress())}</td></tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  return { subject, text, html };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
