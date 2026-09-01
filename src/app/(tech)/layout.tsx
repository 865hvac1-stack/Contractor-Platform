import { redirect } from "next/navigation";
import { getSessionUser, getTenantContext } from "@/lib/auth";
import { isFieldRole } from "@/lib/permissions";
import { TechShell } from "@/components/tech-shell";

export default async function TechLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const tenant = await getTenantContext();
  if (!tenant) redirect("/onboarding");
  if (tenant.company.status === "ONBOARDING") redirect("/onboarding");
  if (!isFieldRole(tenant.role)) redirect("/dashboard");

  return (
    <TechShell
      companyName={tenant.company.businessName}
      userName={`${tenant.user.firstName} ${tenant.user.lastName}`}
      isDemo={tenant.company.isDemo}
    >
      {children}
    </TechShell>
  );
}
