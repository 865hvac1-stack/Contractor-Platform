export type ActivePromotionContext = {
  id: string;
  headline: string;
  offer: string;
  terms?: string | null;
  startsAt: Date;
  endsAt: Date;
  status: string;
};

export function promotionIsActive(promotion: ActivePromotionContext | null | undefined, at = new Date()) {
  return Boolean(
    promotion &&
      promotion.status === "ACTIVE" &&
      promotion.startsAt.getTime() <= at.getTime() &&
      promotion.endsAt.getTime() >= at.getTime()
  );
}

export type PersonalizationContext = {
  customerFirstName?: string | null;
  companyName: string;
  assistantName: string;
  propertyAddress?: string | null;
  appointmentWindow?: string | null;
  technicianFirstName?: string | null;
  eta?: string | null;
  reviewLink?: string | null;
  promotion?: ActivePromotionContext | null;
};

export function renderFirstMessage(template: string, context: PersonalizationContext, at = new Date()) {
  const activePromotion = promotionIsActive(context.promotion, at) ? context.promotion : null;
  const values: Record<string, string> = {
    "customer.firstName": safeFirstName(context.customerFirstName),
    "company.name": context.companyName,
    "assistant.name": context.assistantName,
    "property.address": context.propertyAddress || "your property",
    "job.appointmentWindow": context.appointmentWindow || "your scheduled appointment",
    "technician.firstName": context.technicianFirstName || "your technician",
    "job.etaClause": context.eta ? ` with an ETA around ${context.eta}` : "",
    "company.reviewLink": context.reviewLink || "",
    "promotion.headline": activePromotion?.headline || "",
    "promotion.offer": activePromotion?.offer || "",
    "promotion.offerClause": activePromotion ? `, and ${activePromotion.offer} is available right now` : "",
  };

  return template
    .replace(/\{\{([^}]+)\}\}/g, (_match, key: string) => values[key.trim()] ?? "")
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function safeFirstName(name?: string | null) {
  const trimmed = name?.trim();
  if (!trimmed || /^(unknown|caller|lead|customer)$/i.test(trimmed)) return "there";
  return trimmed.slice(0, 80);
}
