export const INTELLIGENCE_MODELS = {
  default: "gpt-4o-mini",
  reasoning: "gpt-4o-mini",
} as const;

export const INTELLIGENCE_FEATURE = {
  ask: "ask",
  brief: "daily_brief",
  job: "job_assistant",
  insight: "insight",
} as const;

export function openaiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function getOpenAIApiKey() {
  const key = process.env.OPENAI_API_KEY?.trim();
  return key || null;
}

/** True when the server can construct the OpenAI client. Never logs or returns the key. */
export async function openaiProviderCanInitialize() {
  const key = getOpenAIApiKey();
  if (!key) return false;
  try {
    const OpenAI = (await import("openai")).default;
    const client = new OpenAI({ apiKey: key });
    return Boolean(client);
  } catch {
    return false;
  }
}

/** gpt-4o-mini list prices used only for internal usage estimates (micro-USD). */
export function estimateCostMicrousd(inputTokens: number, outputTokens: number) {
  const input = Math.round((inputTokens / 1_000_000) * 150_000);
  const output = Math.round((outputTokens / 1_000_000) * 600_000);
  return input + output;
}
