import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePlatformAdmin, getSessionUser } from "@/lib/auth";
import { logoutAction } from "@/server/actions/auth";

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
            <Link href="/platform" className="text-sm font-semibold tracking-[0.12em]">
              CONTRACTOR<span className="text-[var(--cy-orange)]"> YOU</span>
              <span className="ml-2 font-medium tracking-normal text-[var(--muted-foreground)]">
                Platform
              </span>
            </Link>
            <p className="text-xs text-[var(--muted-foreground)]">
              {user.firstName} {user.lastName}
            </p>
          </div>
          <div className="flex items-center gap-4 text-sm">
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
