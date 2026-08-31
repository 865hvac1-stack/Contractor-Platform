import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/tenant";
import { AuthError } from "@/lib/auth";
import { createOAuthState } from "@/lib/integrations/oauth/state";
import { upsertConnection } from "@/lib/integrations/store";
import { QUICKBOOKS_PROVIDER_KEY, quickbooksConfigured } from "@/lib/quickbooks/config";
import { createQuickBooksState, quickbooksAuthorizeHref } from "@/lib/quickbooks/oauth";

export async function GET() {
  try {
    const ctx = await requirePermission("accounting:manage");
    if (!quickbooksConfigured()) {
      redirect("/settings/quickbooks?error=missing_credentials");
    }
    const state = createQuickBooksState();
    await createOAuthState({
      companyId: ctx.company.id,
      userId: ctx.user.id,
      providerKey: QUICKBOOKS_PROVIDER_KEY,
      state,
      redirectTo: "/settings/quickbooks",
    });
    await upsertConnection({
      companyId: ctx.company.id,
      providerKey: QUICKBOOKS_PROVIDER_KEY,
      status: "CONNECTING",
      healthMessage: "Waiting for QuickBooks authorization.",
    });
    redirect(quickbooksAuthorizeHref(state));
  } catch (error) {
    if (error instanceof AuthError) redirect("/login?next=/settings/quickbooks");
    throw error;
  }
}
