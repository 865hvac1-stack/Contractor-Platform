import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, getTenantContext } from "@/lib/auth";
import { brand } from "@/lib/brand";
import { BrandMark } from "@/components/brand-mark";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default async function HomePage() {
  const user = await getSessionUser();
  if (user) {
    const tenant = await getTenantContext();
    if (tenant) {
      if (tenant.company.status === "ONBOARDING") redirect("/onboarding");
      redirect("/dashboard");
    }
    if (user.isPlatformAdmin) redirect("/platform");
    redirect("/onboarding");
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-[var(--cy-navy)] text-white">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(248,112,0,0.22)_0%,_transparent_42%)]"
      />
      <header className="relative z-10 flex items-center justify-between px-6 py-5 md:px-10">
        <BrandMark variant="full" tone="light" priority />
        <Link
          href="/login"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-white/70 hover:bg-white/8 hover:text-white")}
        >
          Sign in
        </Link>
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-start justify-center px-6 pb-20 pt-8 md:px-10 md:pb-28">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--cy-orange)]">
            {brand.positioning}
          </p>
          <h1 className="mt-4 text-5xl font-semibold leading-[1.02] tracking-tight md:text-7xl">
            {brand.headline}
          </h1>
          <p className="mt-5 max-w-md text-lg text-white/65 md:text-xl">{brand.tagline}</p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link href="/register" className={cn(buttonVariants({ size: "lg" }), "h-11 px-6")}>
              Create account
            </Link>
            <Link
              href="/login"
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "h-11 border-white/20 bg-transparent px-6 text-white hover:bg-white/8"
              )}
            >
              Log in
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
