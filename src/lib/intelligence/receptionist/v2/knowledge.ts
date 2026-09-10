import type { ReceptionistSettings } from "@/lib/intelligence/receptionist/types";

export type CompanyKnowledge = {
  companyName: string | null;
  hours: string | null;
  serviceArea: string | null;
  services: string | null;
  description: string | null;
  emergencyGuidance: string | null;
  faqs: Array<{ question: string; answer: string }>;
};

export function loadCompanyKnowledgeFromSettings(input: {
  businessName?: string | null;
  hoursNote?: string | null;
  serviceArea?: string | null;
  description?: string | null;
  settings: ReceptionistSettings;
}): CompanyKnowledge {
  const faqs = parseFaqs(input.settings.knowledgeJson);
  return {
    companyName: input.businessName ?? null,
    hours: input.settings.businessHoursText || input.hoursNote || null,
    serviceArea: input.settings.serviceAreaNote || input.serviceArea || null,
    services: input.settings.servicesOffered || null,
    description: input.settings.companyDescription || input.description || null,
    emergencyGuidance: input.settings.emergencyGuidance || null,
    faqs,
  };
}

export function faqsToFormText(value: unknown) {
  return parseFaqs(value)
    .map((faq) => `${faq.question} | ${faq.answer}`)
    .join("\n");
}

export function faqsFromFormText(text: string) {
  return text
    .split("\n")
    .flatMap((line) => {
      const [question, ...rest] = line.split("|");
      const answer = rest.join("|").trim();
      if (!question?.trim() || !answer) return [];
      return [{ question: question.trim(), answer }];
    });
}

export function parseFaqs(value: unknown): Array<{ question: string; answer: string }> {
  if (!value || typeof value !== "object") return [];
  const row = value as Record<string, unknown>;
  const raw = Array.isArray(row.faqs) ? row.faqs : Array.isArray(value) ? value : [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const faq = item as Record<string, unknown>;
    const question = typeof faq.question === "string" ? faq.question.trim() : "";
    const answer = typeof faq.answer === "string" ? faq.answer.trim() : "";
    if (!question || !answer) return [];
    return [{ question, answer }];
  });
}

export function answerFromCompanyKnowledge(input: { question: string; knowledge: CompanyKnowledge }): string | null {
  const q = input.question.toLowerCase();
  if (/\bhours?\b/.test(q) && input.knowledge.hours) {
    return `We're typically ${input.knowledge.hours}.`;
  }
  if (/\b(area|knoxville|county|how far)\b/.test(q) && input.knowledge.serviceArea) {
    return `We serve ${input.knowledge.serviceArea}.`;
  }
  if (/\b(brand|trane|carrier|lennox|goodman|rheem|work on)\b/.test(q) && input.knowledge.services) {
    return input.knowledge.services;
  }
  if (/\b(financ|payment plan)\b/.test(q)) {
    const hit = input.knowledge.faqs.find((faq) => /financ/i.test(faq.question) || /financ/i.test(faq.answer));
    return hit?.answer ?? null;
  }
  for (const faq of input.knowledge.faqs) {
    const words = faq.question.toLowerCase().split(/\W+/).filter((word) => word.length > 3);
    if (words.some((word) => q.includes(word))) return faq.answer;
  }
  return null;
}
