import { redirect } from "next/navigation";
import { getSessionUser, getTenantContext } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const tenant = await getTenantContext();
  if (!tenant) {
    if (user.isPlatformAdmin) redirect("/platform");
    redirect("/onboarding");
  }

  if (tenant.company.status === "ONBOARDING") {
    redirect("/onboarding");
  }

  if (tenant.company.status === "SUSPENDED") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--background)] p-6">
        <div className="max-w-md rounded-2xl border border-[var(--border)] bg-white p-8 text-center">
          <h1 className="font-display text-2xl">Company suspended</h1>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            {tenant.company.suspendedReason ||
              "This workspace is suspended. Contact platform support."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <AppShell
      companyName={tenant.company.businessName}
      userName={`${tenant.user.firstName} ${tenant.user.lastName}`}
      userEmail={tenant.user.email}
    >
      {children}
    </AppShell>
  );
}
