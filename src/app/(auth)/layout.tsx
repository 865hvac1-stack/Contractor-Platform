import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, getTenantContext } from "@/lib/auth";
import { BrandMark } from "@/components/brand-mark";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (user) {
    const tenant = await getTenantContext();
    if (tenant && tenant.company.status !== "ONBOARDING") {
      redirect("/dashboard");
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-[var(--cy-gray)] px-4 py-12">
      <div className="relative z-10 w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-flex justify-center">
            <BrandMark variant="stacked" tone="dark" priority />
          </Link>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-white p-6 shadow-sm md:p-8">
          {children}
        </div>
      </div>
    </div>
  );
}
