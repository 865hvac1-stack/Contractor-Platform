import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/tenant";
import { getAIProvider, wrapUntrustedData } from "@/lib/intelligence/provider";

const inputSchema = z.object({
  message: z.string().min(1).max(1500),
  instruction: z.string().min(2).max(500),
});

export async function POST(request: Request) {
  await requirePermission("marketing:manage");
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Add a message and writing direction." }, { status: 400 });
  const provider = getAIProvider();
  if (!provider) return NextResponse.json({ message: fallbackRewrite(parsed.data.message, parsed.data.instruction), usedAi: false });
  try {
    const result = await provider.complete({
      tools: false,
      messages: [
        {
          role: "system",
          content: "Rewrite one contractor customer SMS. Follow the owner's style direction. Preserve {{tokens}} exactly. Never add prices, discounts, promises, availability, appointment confirmations, diagnoses, warranty claims, links, or facts not already present. Return only the rewritten SMS, under 480 characters.",
        },
        { role: "user", content: wrapUntrustedData("automation_message", parsed.data) },
      ],
    });
    return NextResponse.json({ message: result.text.slice(0, 1500), usedAi: true });
  } catch {
    return NextResponse.json({ message: fallbackRewrite(parsed.data.message, parsed.data.instruction), usedAi: false });
  }
}

function fallbackRewrite(message: string, instruction: string) {
  let result = message.trim();
  if (/short/i.test(instruction)) result = result.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
  if (/professional/i.test(instruction)) result = result.replace(/\bHey\b/i, "Hello").replace(/!+/g, ".");
  if (/warm/i.test(instruction) && !/[!]/.test(result)) result = result.replace(/\.$/, "!");
  if (/don'?t mention (the )?promotion/i.test(instruction)) result = result.replace(/\{\{promotion\.[^}]+\}\}/g, "").replace(/\s{2,}/g, " ").trim();
  return result;
}
