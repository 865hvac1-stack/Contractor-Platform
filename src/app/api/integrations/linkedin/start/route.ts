import { startOAuth } from "@/lib/integrations/oauth/start";

export async function GET() {
  await startOAuth("linkedin");
}
