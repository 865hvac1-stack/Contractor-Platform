import { handleAgentToolPost } from "@/lib/agent-tools/http";
import { bookAppointmentTool } from "@/lib/agent-tools/book-appointment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleAgentToolPost({
    request,
    action: "book_appointment",
    run: ({ companyId, body, idempotencyKey }) => bookAppointmentTool({ companyId, body, idempotencyKey }),
  });
}
