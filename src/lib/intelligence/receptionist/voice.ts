import { getOpenAIApiKey, INTELLIGENCE_MODELS } from "@/lib/intelligence/config";
import { wrapUntrustedData } from "@/lib/intelligence/provider";
import { sanitizeCustomerSms } from "@/lib/intelligence/receptionist/sanitize";

export async function composeReceptionistReply(input: {
  assistantName: string;
  templateText: string;
  facts?: Record<string, unknown>;
}): Promise<string> {
  const safeTemplate = sanitizeCustomerSms(input.templateText);
  const key = getOpenAIApiKey();
  if (!key) return safeTemplate;
  try {
    const OpenAI = (await import("openai")).default;
    const client = new OpenAI({ apiKey: key });
    const model = process.env.RECEPTIONIST_MODEL?.trim() || INTELLIGENCE_MODELS.default;
    const response = await client.chat.completions.create({
      model,
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content: [
            `You are ${input.assistantName}, a warm, concise office receptionist for this contractor.`,
            "Rewrite the approved office message so it sounds like a real person.",
            "Keep every appointment window, address, and name exactly as given. Do not add times, prices, diagnoses, or technician names.",
            "Do not mention AI, APIs, tools, ContractorYou, or HighLevel.",
            "Two to four short sentences max. Return only the customer text.",
          ].join(" "),
        },
        {
          role: "user",
          content: wrapUntrustedData("approved_office_message", {
            templateText: safeTemplate,
            facts: input.facts || {},
          }),
        },
      ],
    });
    return sanitizeCustomerSms(response.choices[0]?.message.content || safeTemplate);
  } catch {
    return safeTemplate;
  }
}
