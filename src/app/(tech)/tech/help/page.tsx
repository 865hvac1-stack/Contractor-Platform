import { HelpSupportSection } from "@/components/help/help-support-section";
import Link from "next/link";

export default function TechHelpPage() {
  return (
    <div className="space-y-4">
      <Link href="/tech/more" className="text-sm text-[var(--muted-foreground)]">
        ← More
      </Link>
      <h1 className="font-display text-3xl tracking-tight">Help</h1>
      <section className="rounded-2xl border border-[var(--border)] bg-white p-4">
        <HelpSupportSection />
      </section>
    </div>
  );
}
