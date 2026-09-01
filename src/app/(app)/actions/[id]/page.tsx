import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/tenant";
import { getActionRequestForCompany } from "@/lib/actions/approvals";
import { toPublicActionRequest } from "@/lib/actions/public";
import { ActionCard } from "@/components/action-card";

export default async function ActionRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission("intelligence:view");
  const { id } = await params;
  const request = await getActionRequestForCompany(ctx.company.id, id);
  if (!request) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/actions" className="text-sm text-[var(--cy-orange)]">
        Back to Action Center
      </Link>
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--cy-orange)]">Approval</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--cy-navy)]">{request.title}</h1>
      </header>
      <ActionCard request={toPublicActionRequest(request, { isDemo: ctx.company.isDemo })} onNavy={false} />
    </div>
  );
}
