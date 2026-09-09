import { handleAgentToolPost } from "@/lib/agent-tools/http";
import { startSchedulingTool } from "@/lib/agent-tools/scheduling-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleAgentToolPost({
    request,
    action: "start_scheduling",
    run: ({ companyId, body }) => startSchedulingTool({ companyId, body }),
  });
}
