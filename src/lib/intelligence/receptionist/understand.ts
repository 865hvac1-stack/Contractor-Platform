import { getOpenAIApiKey, INTELLIGENCE_MODELS } from "@/lib/intelligence/config";
import { wrapUntrustedData } from "@/lib/intelligence/provider";
import { interpretSchedulingIntent } from "@/lib/scheduling/intent";
import {
  RECEPTIONIST_INTENTS,
  type ReceptionistIntent,
  type ReceptionistPlan,
} from "@/lib/intelligence/receptionist/types";

const INTENT_SET = new Set<string>(RECEPTIONIST_INTENTS);

function asIntent(value: unknown): ReceptionistIntent {
  return INTENT_SET.has(String(value)) ? (value as ReceptionistIntent) : "unknown";
}

export function fallbackReceptionistPlan(input: {
  text: string;
  timeZone: string;
  hasActiveScheduling?: boolean;
}): ReceptionistPlan {
  const intent = interpretSchedulingIntent({ text: input.text, timeZone: input.timeZone });
  if (intent.humanRequested) return { intent: "human_handoff", requiresHuman: true, confidence: "high" };
  if (intent.cancelIntent) return { intent: "cancel_appointment", confidence: intent.confidence };
  if (intent.rescheduleIntent) return { intent: "reschedule_appointment", confidence: intent.confidence };
  if (intent.maintenanceIntent) return { intent: "maintenance_question", confidence: intent.confidence };
  if (input.hasActiveScheduling) {
    if (intent.requestedDaypart || intent.requestedDate || intent.requestedWindowId) {
      return { intent: "choose_appointment_slot", selectedSlotHint: input.text, confidence: "high" };
    }
    return { intent: "provide_customer_info", confidence: "medium" };
  }
  if (intent.serviceIntent || intent.availabilityAsk || intent.requestedDate) {
    return {
      intent: "schedule_service",
      concern: input.text.slice(0, 180),
      confidence: intent.confidence,
    };
  }
  return { intent: "unknown", confidence: "low", requiresHuman: false };
}

export async function understandReceptionistTurn(input: {
  text: string;
  timeZone: string;
  assistantName: string;
  history?: Array<{ direction: string; body: string }>;
  hasActiveScheduling?: boolean;
  offeredSlots?: Array<{ date: string; display?: string }>;
}): Promise<{ plan: ReceptionistPlan; usedAi: boolean; errorCode?: string }> {
  const fallback = fallbackReceptionistPlan(input);
  const key = getOpenAIApiKey();
  if (!key) {
    return { plan: fallback, usedAi: false, errorCode: fallback.intent === "unknown" ? "MISSING_AI_KEY" : undefined };
  }
  try {
    const OpenAI = (await import("openai")).default;
    const client = new OpenAI({ apiKey: key });
    const model = process.env.RECEPTIONIST_MODEL?.trim() || INTELLIGENCE_MODELS.default;
    const response = await client.chat.completions.create({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            `You are ${input.assistantName}, an office receptionist planner for a contractor.`,
            "Return JSON only. Do not invent appointment times, prices, diagnoses, or technician names.",
            "Choose one intent. Scheduling actions are requests only; the application validates them.",
            `Valid intents: ${RECEPTIONIST_INTENTS.join(", ")}.`,
            'Schema: {"intent":"","serviceType":null,"concern":null,"customerName":null,"serviceAddress":null,"selectedSlotHint":null,"needs":[],"requiresHuman":false,"confidence":"high"}',
          ].join(" "),
        },
        {
          role: "user",
          content: wrapUntrustedData("inbound_sms", {
            text: input.text,
            history: (input.history || []).slice(-8),
            offeredSlots: input.offeredSlots || [],
            hasActiveScheduling: Boolean(input.hasActiveScheduling),
          }),
        },
      ],
    });
    const raw = JSON.parse(response.choices[0]?.message.content || "{}") as Record<string, unknown>;
    const plan: ReceptionistPlan = {
      intent: asIntent(raw.intent) === "unknown" && fallback.intent !== "unknown" ? fallback.intent : asIntent(raw.intent),
      serviceType: typeof raw.serviceType === "string" ? raw.serviceType : null,
      concern: typeof raw.concern === "string" ? raw.concern : fallback.concern ?? null,
      customerName: typeof raw.customerName === "string" ? raw.customerName : null,
      serviceAddress: typeof raw.serviceAddress === "string" ? raw.serviceAddress : null,
      selectedSlotHint: typeof raw.selectedSlotHint === "string" ? raw.selectedSlotHint : null,
      needs: Array.isArray(raw.needs) ? raw.needs.filter((row): row is string => typeof row === "string") : [],
      requiresHuman: Boolean(raw.requiresHuman),
      confidence: raw.confidence === "low" || raw.confidence === "medium" ? raw.confidence : "high",
    };
    return { plan, usedAi: true };
  } catch {
    return { plan: fallback, usedAi: false, errorCode: "AI_UNDERSTAND_FAILED" };
  }
}
