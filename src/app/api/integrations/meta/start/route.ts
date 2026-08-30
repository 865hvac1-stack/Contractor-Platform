import { startOAuth } from "@/lib/integrations/oauth/start";

export async function GET(request: Request) {
  const provider = new URL(request.url).searchParams.get("provider") || "facebook";
  await startOAuth(provider);
}
