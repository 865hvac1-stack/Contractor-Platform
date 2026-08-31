import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { sellMembershipAction } from "@/server/actions/memberships";

export function TechMembershipSell({
  customerId,
  propertyId,
  jobId,
  plans,
  incentiveHint,
}: {
  customerId: string;
  propertyId: string;
  jobId: string;
  plans: {
    id: string;
    name: string;
    priceCents: number;
    billingFrequency: string;
    lines: string[];
  }[];
  incentiveHint: { amountCents: number; status: string } | null;
}) {
  if (plans.length === 0) {
    return <p className="mt-2 text-sm text-[var(--muted-foreground)]">No membership plans are set up for this company.</p>;
  }

  return (
    <div className="mt-3 space-y-3">
      {incentiveHint ? (
        <p className="rounded-xl bg-[var(--cy-orange-muted)] px-3 py-2 text-sm text-[#9A3412]">
          Potential incentive {formatMoney(incentiveHint.amountCents)} · {incentiveHint.status.toLowerCase()} — not paid
          earnings.
        </p>
      ) : null}
      {plans.map((plan) => (
        <article key={plan.id} className="rounded-xl border border-[var(--border)] p-3">
          <p className="font-medium text-[var(--cy-navy)]">{plan.name}</p>
          <p className="text-sm text-[var(--muted-foreground)]">
            {formatMoney(plan.priceCents)} / {plan.billingFrequency.toLowerCase()}
          </p>
          {plan.lines.length ? (
            <ul className="mt-2 list-disc pl-5 text-sm text-[var(--foreground)]">
              {plan.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
          <ActionForm action={sellMembershipAction} successMessage="Membership recorded.">
            <input type="hidden" name="customerId" value={customerId} />
            <input type="hidden" name="propertyId" value={propertyId} />
            <input type="hidden" name="jobId" value={jobId} />
            <input type="hidden" name="planId" value={plan.id} />
            <input type="hidden" name="activate" value="true" />
            <Button type="submit" className="mt-3 h-11 w-full">
              Add membership
            </Button>
          </ActionForm>
        </article>
      ))}
    </div>
  );
}
