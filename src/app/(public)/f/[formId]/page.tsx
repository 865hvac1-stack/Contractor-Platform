import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { parseFields } from "@/lib/integrations/forms";
import { PublicLeadForm } from "@/components/marketing/public-lead-form";

export default async function PublicFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ formId: string }>;
  searchParams: Promise<{ thanks?: string; utm_source?: string; utm_medium?: string; utm_campaign?: string; utm_content?: string; utm_term?: string }>;
}) {
  const { formId } = await params;
  const query = await searchParams;
  const form = await prisma.websiteForm.findFirst({
    where: { id: formId, status: "ACTIVE" },
    include: { company: true },
  });
  if (!form) notFound();

  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
        {form.company.businessName}
      </p>
      <h1 className="mt-2 text-3xl font-semibold text-[var(--cy-navy)]">{form.name}</h1>
      {query.thanks ? (
        <p className="mt-6 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-800">
          We received your request. Someone from {form.company.businessName} will be in touch.
        </p>
      ) : (
        <div className="mt-6">
          <PublicLeadForm
            formId={form.id}
            fields={parseFields(form.fields)}
            utm={{
              utm_source: query.utm_source,
              utm_medium: query.utm_medium,
              utm_campaign: query.utm_campaign,
              utm_content: query.utm_content,
              utm_term: query.utm_term,
            }}
          />
        </div>
      )}
    </div>
  );
}
