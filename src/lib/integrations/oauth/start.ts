import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/tenant";
import { AuthError } from "@/lib/auth";
import { getProvider } from "@/lib/integrations/catalog";
import { getProviderEnv } from "@/lib/integrations/env";
import { createPkce } from "@/lib/integrations/oauth/pkce";
import { createOAuthState } from "@/lib/integrations/oauth/state";
import { googleAuthorizeUrl } from "@/lib/integrations/oauth/google";
import { metaAuthorizeUrl } from "@/lib/integrations/oauth/meta";
import { tiktokAuthorizeUrl } from "@/lib/integrations/oauth/tiktok";
import { linkedinAuthorizeUrl } from "@/lib/integrations/oauth/linkedin";
import { upsertConnection } from "@/lib/integrations/store";

export async function startOAuth(providerKey: string) {
  let ctx;
  try {
    ctx = await requirePermission("marketing:manage");
  } catch (error) {
    if (error instanceof AuthError) redirect("/login?next=/marketing/channels");
    throw error;
  }
  const provider = getProvider(providerKey);
  if (!provider) redirect("/marketing/channels?error=Unknown+provider");
  const env = getProviderEnv(providerKey);
  if (!env.configured) {
    redirect(`/marketing/channels/${providerKey}?error=missing_credentials`);
  }

  const pkce = createPkce();
  const state = await createOAuthState({
    companyId: ctx.company.id,
    userId: ctx.user.id,
    providerKey,
    codeVerifier: pkce.verifier,
    redirectTo: `/marketing/channels/${providerKey}`,
  });

  await upsertConnection({
    companyId: ctx.company.id,
    providerKey,
    status: "CONNECTING",
    healthMessage: "Waiting for provider authorization.",
  });

  if (provider.family === "google") {
    redirect(googleAuthorizeUrl({ state: state.state, codeChallenge: pkce.challenge, providerKey }));
  }
  if (provider.family === "meta") {
    redirect(metaAuthorizeUrl({ state: state.state, providerKey }));
  }
  if (provider.family === "tiktok") {
    redirect(tiktokAuthorizeUrl({ state: state.state, codeChallenge: pkce.challenge, providerKey }));
  }
  if (provider.family === "linkedin") {
    redirect(linkedinAuthorizeUrl({ state: state.state }));
  }
  redirect("/marketing/channels?error=OAuth+is+not+available+for+this+provider");
}
