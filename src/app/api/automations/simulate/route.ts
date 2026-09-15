import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/tenant";
import { getAIProvider, wrapUntrustedData } from "@/lib/intelligence/provider";
import { GOAL_ACTIONS } from "@/lib/conversations/custom-automations";

const schema = z.object({
  goal: z.string().max(100),
  allowedActions: z.array(z.string()).max(12),
  customerMessage: z.string().min(1).max(1000),
  history: z.array(z.object({ role: z.enum(["REGINA", "CUSTOMER"]), text: z.string().max(1500) })).max(12),
});

export async function POST(request: Request) {
  await requirePermission("marketing:view");
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Add a test customer message." }, { status: 400 });
  const supported = new Set(GOAL_ACTIONS[parsed.data.goal] || []);
  const actions = parsed.data.allowedActions.filter((action) => supported.has(action));
  const wouldDo = inferDryRunAction(parsed.data.customerMessage, actions);
  const fallback = fallbackResponse(parsed.data.customerMessage, parsed.data.goal, wouldDo);
  const provider = getAIProvider();
  if (!provider) return NextResponse.json({ response: fallback, wouldDo, testMode: true, usedAi: false });
  try {
    const result = await provider.complete({
      tools: false,
      messages: [
        {
          role: "system",
          content: `You are Regina in a clearly non-mutating automation simulation. Goal: ${parsed.data.goal}. Allowed capabilities: ${actions.join(", ")}. Respond naturally in 1-3 SMS sentences. Do not claim an action happened. Do not invent availability, prices, balances, bookings, or customer facts. If an action is needed, say you would check or could help; the UI separately shows the dry-run action. Return only Regina's reply.`,
        },
        { role: "user", content: wrapUntrustedData("test_conversation", { history: parsed.data.history, customerMessage: parsed.data.customerMessage }) },
      ],
    });
    return NextResponse.json({ response: result.text || fallback, wouldDo, testMode: true, usedAi: true });
  } catch {
    return NextResponse.json({ response: fallback, wouldDo, testMode: true, usedAi: false });
  }
}

function inferDryRunAction(text: string, actions: string[]) {
  if (/(manager|person|office|human|angry|refund)/i.test(text) && actions.includes("REQUEST_HUMAN_HANDOFF")) return "Escalate to a human";
  if (/(thursday|friday|monday|morning|afternoon|available|come|schedule)/i.test(text)) {
    if (actions.includes("CHECK_AVAILABILITY")) return "Check real scheduling availability (read-only)";
    if (actions.includes("RESCHEDULE_APPOINTMENT")) return "Validate a reschedule request";
  }
  if (/(book|that works|take it)/i.test(text) && actions.includes("BOOK_APPOINTMENT")) return "Book the selected appointment after validation";
  if (/(estimate|proposal)/i.test(text) && actions.includes("READ_ESTIMATE")) return "Read the confirmed estimate status";
  if (/(pay|payment|invoice|balance)/i.test(text) && actions.includes("READ_INVOICE")) return "Read the confirmed invoice balance";
  return "Continue the configured conversation";
}

function fallbackResponse(text: string, goal: string, wouldDo: string) {
  if (/thursday|friday|monday|morning|afternoon/i.test(text)) return `Absolutely. In a live conversation, I would check the real schedule before offering any times.`;
  if (/human|person|manager/i.test(text)) return "Of course. I would pause here and get the office involved.";
  return `Thanks for letting me know. I would continue working toward ${goal.toLowerCase().replaceAll("_", " ")}. Next: ${wouldDo.toLowerCase()}.`;
}
