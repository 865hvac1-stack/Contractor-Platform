import { format } from "date-fns";
import { formatMoney } from "@/lib/money";
import { firstNameOf } from "@/lib/actions/eligibility";

function companyVoice(companyName: string) {
  return companyName.trim() || "our office";
}

export function draftEstimateFollowup(input: {
  companyName: string;
  customer: { firstName: string; businessName?: string | null };
  estimateNumber: string;
  totalCents: number;
  issueDate: Date;
}) {
  const weekday = format(input.issueDate, "EEEE");
  return `Hi ${firstNameOf(input.customer)}, this is ${companyVoice(input.companyName)}. I wanted to follow up on estimate ${input.estimateNumber} (${formatMoney(input.totalCents)}) we sent ${weekday}. Let us know if you have any questions or if you'd like us to go over the options with you.`;
}

export function draftInvoiceReminder(input: {
  companyName: string;
  customer: { firstName: string; businessName?: string | null };
  invoiceNumber: string;
  balanceCents: number;
  daysOverdue: number;
}) {
  return `Hi ${firstNameOf(input.customer)}, this is ${companyVoice(input.companyName)}. Invoice ${input.invoiceNumber} for ${formatMoney(input.balanceCents)} is ${input.daysOverdue} day${input.daysOverdue === 1 ? "" : "s"} past due. Reply here or call the office if you have a question or need a copy of the invoice.`;
}

export function draftMembershipRenewal(input: {
  companyName: string;
  customer: { firstName: string; businessName?: string | null };
  planName: string;
  renewalDate: Date | null;
  priceCents: number;
}) {
  const when = input.renewalDate ? format(input.renewalDate, "MMMM d") : "soon";
  return `Hi ${firstNameOf(input.customer)}, this is ${companyVoice(input.companyName)}. Your ${input.planName} membership comes up for renewal ${when}. The current plan is ${formatMoney(input.priceCents)}. Reply if you'd like us to keep you on the schedule.`;
}

export function draftReviewRequest(input: {
  companyName: string;
  customer: { firstName: string; businessName?: string | null };
}) {
  return `Hi ${firstNameOf(input.customer)}, this is ${companyVoice(input.companyName)}. Thanks for trusting us with your home. If the visit went well, a short review helps other homeowners find us.`;
}

export function draftSocialPost(input: { companyName: string; topic?: string | null }) {
  const topic = input.topic?.trim() || "seasonal maintenance";
  return `${companyVoice(input.companyName)} is booking ${topic}. If your system is due for a tune-up, reply or call the office and we will get you on the schedule.`;
}

export function draftGenericSms(input: {
  companyName: string;
  customer: { firstName: string; businessName?: string | null };
  purpose: string;
}) {
  return `Hi ${firstNameOf(input.customer)}, this is ${companyVoice(input.companyName)}. ${input.purpose}`;
}
