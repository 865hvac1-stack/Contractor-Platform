import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePlatformAdmin, getSessionUser } from "@/lib/auth";
import { logoutAction } from "@/server/actions/auth";
import { BrandMark } from "@/components/brand-mark";

export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await requirePlatformAdmin();

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <header className="border-b border-[var(--border)] bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 md:px-8">
          <div>
            <Link href="/platform" className="inline-flex items-center gap-3">
              <BrandMark variant="full" tone="dark" />
              <span className="text-sm font-medium text-[var(--muted-foreground)]">Platform</span>
            </Link>
            <p className="text-xs text-[var(--muted-foreground)]">
              {user.firstName} {user.lastName}
            </p>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <Link
              href="/platform/integrations"
              className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              Integrations
            </Link>
            <Link
              href="/dashboard"
              className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              App
            </Link>
            <form action={logoutAction}>
              <button type="submit" className="text-[var(--muted-foreground)] underline">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8">{children}</main>
    </div>
  );
}
