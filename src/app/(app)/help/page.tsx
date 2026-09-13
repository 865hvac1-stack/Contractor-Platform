import { HelpSupportSection } from "@/components/help/help-support-section";

export default async function HelpPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-3xl tracking-tight">Help</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Contact ContractorYou support from this workspace.
        </p>
      </div>
      <section className="rounded-2xl border border-[var(--border)] bg-white p-6">
        <HelpSupportSection />
      </section>
    </div>
  );
}
