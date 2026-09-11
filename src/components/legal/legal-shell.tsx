import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { brand } from "@/lib/brand";
import { LEGAL_LAST_UPDATED, LEGAL_PAGES } from "@/lib/legal";
import { supportEmail, supportMailto } from "@/lib/support";

export function LegalShell({
  page,
  children,
}: {
  page: keyof typeof LEGAL_PAGES;
  children: React.ReactNode;
}) {
  const current = LEGAL_PAGES[page];

  return (
    <div className="min-h-screen bg-[var(--cy-gray)] text-[var(--cy-navy)]">
      <header className="bg-[var(--cy-navy)] text-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-5 md:px-6">
          <Link href="/" aria-label={brand.name}>
            <BrandMark variant="full" tone="light" />
          </Link>
          <Link href="/login" className="text-sm text-white/70 transition hover:text-white">
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-5 py-10 md:px-6 md:py-14">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--cy-orange)]">{current.kicker}</p>
        <h1 className="mt-3 font-display text-4xl tracking-tight text-[var(--cy-navy)] md:text-5xl">{current.heading}</h1>
        <p className="mt-3 text-sm text-[var(--muted-foreground)]">Last updated {LEGAL_LAST_UPDATED}</p>
        <div className="mt-8 rounded-2xl border border-[var(--border)] bg-white px-5 py-8 shadow-sm md:px-10 md:py-10">
          <div className="legal-prose space-y-8 text-[15px] leading-7 text-[var(--cy-text-secondary)] [&_a]:font-medium [&_a]:text-[var(--cy-navy)] [&_a]:underline [&_a]:underline-offset-4 [&_h2]:font-display [&_h2]:text-2xl [&_h2]:tracking-tight [&_h2]:text-[var(--cy-navy)] [&_h3]:mt-5 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-[var(--cy-navy)] [&_li]:pl-1 [&_p]:text-[15px] [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
            {children}
          </div>
        </div>
      </main>

      <footer className="border-t border-[var(--border)] bg-white">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-5 py-6 text-sm text-[var(--muted-foreground)] md:flex-row md:items-center md:justify-between md:px-6">
          <p>
            Questions?{" "}
            <a href={supportMailto()} className="font-medium text-[var(--cy-navy)] underline-offset-4 hover:underline">
              {supportEmail()}
            </a>
          </p>
          <nav className="flex flex-wrap gap-x-4 gap-y-2">
            <Link href={LEGAL_PAGES.terms.href} className="hover:text-[var(--cy-navy)]">
              Terms of Service
            </Link>
            <Link href={LEGAL_PAGES.privacy.href} className="hover:text-[var(--cy-navy)]">
              Privacy Policy
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

export function LegalPublicLinks({ className }: { className?: string }) {
  return (
    <p className={className}>
      <Link href={LEGAL_PAGES.terms.href} className="underline-offset-4 hover:underline">
        Terms of Service
      </Link>
      <span aria-hidden className="mx-2 text-[var(--border)]">
        ·
      </span>
      <Link href={LEGAL_PAGES.privacy.href} className="underline-offset-4 hover:underline">
        Privacy Policy
      </Link>
    </p>
  );
}
