import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, getTenantContext } from "@/lib/auth";
import { brand } from "@/lib/brand";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (user) {
    const tenant = await getTenantContext();
    if (tenant && tenant.company.status !== "ONBOARDING") {
      redirect("/dashboard");
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_#CCFBF1_0%,_transparent_50%),linear-gradient(180deg,_#F7F6F3_0%,_#EFEDE8_100%)]"
      />
      <div className="relative z-10 w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" className="font-display text-3xl tracking-tight text-[var(--foreground)]">
            {brand.name}
          </Link>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">{brand.tagline}</p>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm md:p-8">
          {children}
        </div>
      </div>
    </div>
  );
}
