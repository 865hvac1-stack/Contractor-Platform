import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { applyEstimateDiscountAction } from "@/server/actions/field";
import { presentEstimateAction } from "@/server/actions/estimate-options";

export function TechEstimateActions({
  estimateId,
  jobId,
  canDiscount,
  maxDiscountBps,
}: {
  estimateId: string;
  jobId: string;
  canDiscount: boolean;
  maxDiscountBps: number | null;
}) {
  return (
    <div className="space-y-3">
      <form
        action={async () => {
          "use server";
          await presentEstimateAction(estimateId);
        }}
      >
        <Button type="submit" variant="outline" className="h-11 w-full">
          Mark estimate presented
        </Button>
      </form>
      {canDiscount ? (
        <ActionForm action={applyEstimateDiscountAction} successMessage="Discount applied to open lines.">
          <input type="hidden" name="estimateId" value={estimateId} />
          <input type="hidden" name="jobId" value={jobId} />
          <Label htmlFor="discount-percent">
            Discount %{maxDiscountBps != null ? ` (max ${maxDiscountBps / 100}%)` : ""}
          </Label>
          <div className="mt-1 flex gap-2">
            <Input
              id="discount-percent"
              name="percent"
              type="number"
              min={0}
              step="0.1"
              max={maxDiscountBps != null ? maxDiscountBps / 100 : undefined}
              className="h-11"
            />
            <Button type="submit" variant="outline" className="h-11">
              Apply
            </Button>
          </div>
        </ActionForm>
      ) : null}
    </div>
  );
}
