import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { parseFields } from "@/lib/integrations/forms";
import { PublicLeadForm } from "@/components/marketing/public-lead-form";

export default async function PublicLandingPage({
  params,
}: {
  params: Promise<{ pageId: string }>;
}) {
  const { pageId } = await params;
  const page = await prisma.landingPage.findFirst({
    where: { id: pageId, status: "PUBLISHED" },
    include: { company: true, form: true },
  });
  if (!page) notFound();

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
        {page.company.businessName}
      </p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight text-[var(--cy-navy)]">
        {page.headline}
      </h1>
      <p className="mt-4 whitespace-pre-wrap text-[var(--muted-foreground)]">{page.body}</p>
      {page.form ? (
        <div className="mt-8 rounded-2xl border border-[var(--border)] bg-white p-5">
          <PublicLeadForm
            formId={page.form.id}
            landingPageId={page.id}
            fields={parseFields(page.form.fields)}
            submitLabel={page.ctaLabel}
          />
        </div>
      ) : null}
    </div>
  );
}
