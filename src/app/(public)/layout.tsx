import { BrandMark } from "@/components/brand-mark";

export default function PublicMarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--background)]">
      <header className="border-b border-[var(--border)] bg-white px-4 py-4">
        <div className="mx-auto max-w-2xl">
          <BrandMark variant="full" tone="dark" />
        </div>
      </header>
      {children}
    </div>
  );
}
