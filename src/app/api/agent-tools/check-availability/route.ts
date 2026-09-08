import { handleAgentToolPost } from "@/lib/agent-tools/http";
import { checkAvailabilityTool } from "@/lib/agent-tools/check-availability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleAgentToolPost({
    request,
    action: "check_availability",
    run: ({ companyId, body }) => checkAvailabilityTool({ companyId, body }),
  });
}
