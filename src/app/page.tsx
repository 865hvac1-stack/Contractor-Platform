import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, getTenantContext } from "@/lib/auth";
import { brand } from "@/lib/brand";
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
    <div className="relative flex min-h-screen flex-col overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_#CCFBF1_0%,_transparent_55%),linear-gradient(180deg,_#F7F6F3_0%,_#EFEDE8_100%)]"
      />
      <header className="relative z-10 flex items-center justify-between px-6 py-5 md:px-10">
        <p className="font-display text-xl tracking-tight text-[var(--foreground)] md:text-2xl">
          {brand.name}
        </p>
        <Link
          href="/login"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-[var(--muted-foreground)]")}
        >
          Sign in
        </Link>
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-start justify-center px-6 pb-20 pt-8 md:px-10 md:pb-28">
        <div className="max-w-2xl">
          <h1 className="font-display text-5xl leading-[1.05] tracking-tight text-[var(--foreground)] md:text-7xl">
            {brand.name}
          </h1>
          <p className="mt-5 max-w-md text-lg text-[var(--muted-foreground)] md:text-xl">
            {brand.tagline}
          </p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link href="/login" className={cn(buttonVariants({ size: "lg" }), "h-11 px-6")}>
              Log in
            </Link>
            <Link
              href="/register"
              className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-11 px-6")}
            >
              Create account
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
