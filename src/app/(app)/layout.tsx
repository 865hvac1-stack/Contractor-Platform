import { redirect } from "next/navigation";
import { getSessionUser, getTenantContext } from "@/lib/auth";
import { AppSidebar } from "@/components/app-sidebar";

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
    <div className="flex min-h-screen bg-[var(--background)]">
      <AppSidebar
        companyName={tenant.company.businessName}
        userName={`${tenant.user.firstName} ${tenant.user.lastName}`}
      />
      <main className="flex-1 overflow-x-hidden">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8 md:py-8">{children}</div>
      </main>
    </div>
  );
}
