import { handleAgentToolPost } from "@/lib/agent-tools/http";
import { selectOfferedSlotTool } from "@/lib/agent-tools/select-slot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleAgentToolPost({
    request,
    action: "select_offered_slot",
    run: ({ companyId, body }) => selectOfferedSlotTool({ companyId, body }),
  });
}
