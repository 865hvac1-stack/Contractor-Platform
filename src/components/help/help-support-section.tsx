import { requireTenant } from "@/lib/auth";
import { SupportContactForm } from "@/components/help/support-contact-form";
import { emailConfigured } from "@/lib/email/resend";
import { supportEmail } from "@/lib/support";

export async function HelpSupportSection() {
  const ctx = await requireTenant();
  return (
    <SupportContactForm
      name={`${ctx.user.firstName} ${ctx.user.lastName}`.trim()}
      company={ctx.company.businessName}
      email={ctx.user.email}
      supportAddress={supportEmail()}
      emailConfigured={emailConfigured()}
    />
  );
}
