import { estimateCostMicrousd, getOpenAIApiKey, INTELLIGENCE_MODELS } from "@/lib/intelligence/config";
import { wrapUntrustedData } from "@/lib/intelligence/provider";
import {
  RECEPTIONIST_V2_INTENTS,
  type ReceptionistV2Classification,
  type ReceptionistV2Extracted,
  type ReceptionistV2Generation,
  type ReceptionistV2Intent,
  type VerifiedFacts,
} from "@/lib/intelligence/receptionist/v2/types";
import { fallbackClassifyReceptionistV2 } from "@/lib/intelligence/receptionist/v2/intent";
import { composeVerifiedReceptionistSms } from "@/lib/intelligence/receptionist/v2/compose";

export type AiReceptionistProviderResult<T> = {
  ok: boolean;
  usedAi: boolean;
  data: T;
  provider: string;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  costMicrousd: number;
  errorCode?: string;
};

export type AiReceptionistProvider = {
  classifyIntent(input: {
    text: string;
    history: Array<{ direction: string; body: string }>;
    hasActiveScheduling: boolean;
    assistantName: string;
  }): Promise<AiReceptionistProviderResult<ReceptionistV2Classification>>;
  extractStructuredContext(input: {
    text: string;
    history: Array<{ direction: string; body: string }>;
  }): Promise<AiReceptionistProviderResult<ReceptionistV2Extracted>>;
  generateResponse(input: {
    text: string;
    classification: ReceptionistV2Classification;
    facts: VerifiedFacts;
    history: Array<{ direction: string; body: string }>;
    personality: {
      assistantName: string;
      tone: string;
      responseLength: string;
      useCustomerFirstName: boolean;
    };
  }): Promise<AiReceptionistProviderResult<ReceptionistV2Generation>>;
};

const INTENT_SET = new Set<string>(RECEPTIONIST_V2_INTENTS);

function asIntent(value: unknown): ReceptionistV2Intent {
  return INTENT_SET.has(String(value)) ? (value as ReceptionistV2Intent) : "UNKNOWN";
}

function emptyUsage(provider: string, errorCode?: string) {
  return { provider, model: null, inputTokens: 0, outputTokens: 0, costMicrousd: 0, errorCode };
}

export class FallbackReceptionistProvider implements AiReceptionistProvider {
  async classifyIntent(input: {
    text: string;
    history: Array<{ direction: string; body: string }>;
    hasActiveScheduling: boolean;
    assistantName: string;
  }): Promise<AiReceptionistProviderResult<ReceptionistV2Classification>> {
    return {
      ok: true,
      usedAi: false,
      data: fallbackClassifyReceptionistV2(input),
      ...emptyUsage("fallback"),
    };
  }

  async extractStructuredContext(input: { text: string; history: Array<{ direction: string; body: string }> }) {
    const data = fallbackClassifyReceptionistV2({
      text: input.text,
      history: input.history,
      hasActiveScheduling: false,
      assistantName: "Regina",
    }).extractedContext;
    return { ok: true, usedAi: false, data, ...emptyUsage("fallback") };
  }

  async generateResponse(input: {
    text: string;
    classification: ReceptionistV2Classification;
    facts: VerifiedFacts;
    history: Array<{ direction: string; body: string }>;
    personality: {
      assistantName: string;
      tone: string;
      responseLength: string;
      useCustomerFirstName: boolean;
    };
  }) {
    const responseText = composeVerifiedReceptionistSms({
      text: input.text,
      classification: input.classification,
      facts: input.facts,
      personality: input.personality,
    });
    return {
      ok: true,
      usedAi: false,
      data: {
        intent: input.classification.intent,
        responseText,
        requestedAction: input.classification.shouldHandoff ? "requestHumanHandoff" : "continue_workflow",
        extractedFields: input.classification.extractedContext,
        confidence: input.classification.confidence,
        shouldHandoff: input.classification.shouldHandoff,
        handoffReason: input.classification.handoffReason ?? null,
      } satisfies ReceptionistV2Generation,
      ...emptyUsage("fallback"),
    };
  }
}

export class OpenAiReceptionistProvider implements AiReceptionistProvider {
  constructor(private readonly fallback = new FallbackReceptionistProvider()) {}

  async classifyIntent(input: {
    text: string;
    history: Array<{ direction: string; body: string }>;
    hasActiveScheduling: boolean;
    assistantName: string;
  }): Promise<AiReceptionistProviderResult<ReceptionistV2Classification>> {
    const key = getOpenAIApiKey();
    const fallback = await this.fallback.classifyIntent(input);
    if (!key) return { ...fallback, errorCode: "MISSING_AI_KEY" };
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
              `You classify inbound HVAC office SMS for ${input.assistantName}.`,
              "Return JSON only. Do not invent appointments, prices, or diagnoses.",
              `Valid intents: ${RECEPTIONIST_V2_INTENTS.join(", ")}.`,
              'Schema: {"intent":"UNKNOWN","confidence":0.5,"concern":null,"customerName":null,"serviceAddress":null,"slotHint":null,"casualAck":false,"interruptingQuestion":null,"shouldHandoff":false,"handoffReason":null}',
            ].join(" "),
          },
          {
            role: "user",
            content: wrapUntrustedData("inbound_sms", {
              text: input.text,
              history: input.history.slice(-8),
              hasActiveScheduling: input.hasActiveScheduling,
            }),
          },
        ],
      });
      const raw = JSON.parse(response.choices[0]?.message.content || "{}") as Record<string, unknown>;
      const intent = asIntent(raw.intent) === "UNKNOWN" && fallback.data.intent !== "UNKNOWN" ? fallback.data.intent : asIntent(raw.intent);
      const inputTokens = response.usage?.prompt_tokens ?? 0;
      const outputTokens = response.usage?.completion_tokens ?? 0;
      return {
        ok: true,
        usedAi: true,
        data: {
          intent,
          confidence: clampConfidence(raw.confidence, fallback.data.confidence),
          extractedContext: {
            concern: asNullableString(raw.concern) ?? fallback.data.extractedContext.concern,
            customerName: asNullableString(raw.customerName),
            serviceAddress: asNullableString(raw.serviceAddress),
            slotHint: asNullableString(raw.slotHint),
            casualAck: Boolean(raw.casualAck),
            interruptingQuestion: asNullableString(raw.interruptingQuestion),
          },
          shouldHandoff: Boolean(raw.shouldHandoff) || fallback.data.shouldHandoff,
          handoffReason: asNullableString(raw.handoffReason) ?? fallback.data.handoffReason,
        },
        provider: "openai",
        model,
        inputTokens,
        outputTokens,
        costMicrousd: estimateCostMicrousd(inputTokens, outputTokens),
      };
    } catch {
      return { ...fallback, errorCode: "AI_CLASSIFY_FAILED" };
    }
  }

  async extractStructuredContext(input: { text: string; history: Array<{ direction: string; body: string }> }): Promise<AiReceptionistProviderResult<ReceptionistV2Extracted>> {
    const classified = await this.classifyIntent({
      text: input.text,
      history: input.history,
      hasActiveScheduling: false,
      assistantName: "Regina",
    });
    return { ...classified, data: classified.data.extractedContext };
  }

  async generateResponse(input: {
    text: string;
    classification: ReceptionistV2Classification;
    facts: VerifiedFacts;
    history: Array<{ direction: string; body: string }>;
    personality: {
      assistantName: string;
      tone: string;
      responseLength: string;
      useCustomerFirstName: boolean;
    };
  }): Promise<AiReceptionistProviderResult<ReceptionistV2Generation>> {
    const key = getOpenAIApiKey();
    const fallback = await this.fallback.generateResponse(input);
    if (!key) return { ...fallback, errorCode: "MISSING_AI_KEY" };
    try {
      const OpenAI = (await import("openai")).default;
      const client = new OpenAI({ apiKey: key });
      const model = process.env.RECEPTIONIST_MODEL?.trim() || INTELLIGENCE_MODELS.default;
      const response = await client.chat.completions.create({
        model,
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              `You are ${input.personality.assistantName}, a friendly virtual office receptionist.`,
              `Tone: ${input.personality.tone}. Keep SMS short, generally 1-3 sentences.`,
              "Use only verified facts. Never invent availability, appointments, prices, balances, parts, or job status.",
              "If a workflow question is outstanding, acknowledge any casual reply and still ask that question.",
              "If asked something not in verified facts, say you do not want to guess and offer the office.",
              "Do not mention AI, ContractorYou, HighLevel, tools, or APIs.",
              'Return JSON: {"responseText":"","requestedAction":"continue_workflow","shouldHandoff":false,"handoffReason":null,"confidence":0.8}',
            ].join(" "),
          },
          {
            role: "user",
            content: wrapUntrustedData("verified_receptionist_context", {
              inbound: input.text,
              history: input.history.slice(-8),
              intent: input.classification.intent,
              facts: input.facts,
              useFirstName: input.personality.useCustomerFirstName,
            }),
          },
        ],
      });
      const raw = JSON.parse(response.choices[0]?.message.content || "{}") as Record<string, unknown>;
      const parsed = parseReceptionistStructuredOutput(raw);
      if (!parsed.ok) return { ...fallback, errorCode: parsed.reason };
      const responseText = parsed.responseText;
      const inputTokens = response.usage?.prompt_tokens ?? 0;
      const outputTokens = response.usage?.completion_tokens ?? 0;
      return {
        ok: true,
        usedAi: true,
        data: {
          intent: input.classification.intent,
          responseText,
          requestedAction: fallback.data.requestedAction,
          extractedFields: input.classification.extractedContext,
          confidence: clampConfidence(raw.confidence, input.classification.confidence),
          shouldHandoff: Boolean(raw.shouldHandoff) || input.classification.shouldHandoff,
          handoffReason: asNullableString(raw.handoffReason) ?? input.classification.handoffReason,
        },
        provider: "openai",
        model,
        inputTokens,
        outputTokens,
        costMicrousd: estimateCostMicrousd(inputTokens, outputTokens),
      };
    } catch {
      return { ...fallback, errorCode: "AI_GENERATE_FAILED" };
    }
  }
}

export function parseReceptionistStructuredOutput(raw: unknown) {
  if (!raw || typeof raw !== "object") {
    return { ok: false as const, reason: "invalid_structured_response" };
  }
  const row = raw as Record<string, unknown>;
  const responseText = asNullableString(row.responseText);
  if (!responseText) return { ok: false as const, reason: "invalid_structured_response" };
  return {
    ok: true as const,
    responseText,
    shouldHandoff: Boolean(row.shouldHandoff),
    handoffReason: asNullableString(row.handoffReason),
    confidence: row.confidence,
  };
}

function asNullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function clampConfidence(value: unknown, fallback: number) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

export function getAiReceptionistProvider(): AiReceptionistProvider {
  return getOpenAIApiKey() ? new OpenAiReceptionistProvider() : new FallbackReceptionistProvider();
}
