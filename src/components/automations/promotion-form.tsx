import type { Promotion } from "@prisma/client";
import { savePromotionAction } from "@/server/actions/conversations";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PromotionForm({ promotion }: { promotion?: Promotion | null }) {
  return (
    <ActionForm
      action={savePromotionAction}
      successMessage={promotion ? "Promotion updated." : "Promotion created."}
      className="space-y-4"
    >
      {promotion ? <input type="hidden" name="promotionId" value={promotion.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <InputField label="Name" name="name" defaultValue={promotion?.name} placeholder="Fall Heating Tune-Up" />
        <InputField label="Offer" name="offer" defaultValue={promotion?.offer} placeholder="$79 Heating Tune-Up" />
      </div>
      <InputField label="Customer-facing headline" name="headline" defaultValue={promotion?.headline} placeholder="Get ready for heating season" />
      <div className="space-y-2">
        <Label htmlFor="customerCopy">Customer-facing copy</Label>
        <textarea id="customerCopy" name="customerCopy" defaultValue={promotion?.customerCopy || ""} rows={3} className={textareaClass} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="internalDescription">Internal description</Label>
        <textarea id="internalDescription" name="internalDescription" defaultValue={promotion?.internalDescription || ""} rows={2} className={textareaClass} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <InputField label="Starts" name="startsAt" type="date" defaultValue={dateValue(promotion?.startsAt)} />
        <InputField label="Ends" name="endsAt" type="date" defaultValue={dateValue(promotion?.endsAt)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="audience">Audience</Label>
          <select id="audience" name="audience" defaultValue={promotion?.audience || "ALL_CUSTOMERS"} className={selectClass}>
            <option value="ALL_CUSTOMERS">All eligible customers</option>
            <option value="RESIDENTIAL">Residential customers</option>
            <option value="COMMERCIAL">Commercial customers</option>
            <option value="MAINTENANCE_DUE">Maintenance due</option>
            <option value="PAST_CUSTOMERS">Past customers</option>
            <option value="UNSOLD_ESTIMATES">Open estimates</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="status">Status</Label>
          <select id="status" name="status" defaultValue={promotion?.status || "DRAFT"} className={selectClass}>
            <option value="DRAFT">Draft</option>
            <option value="SCHEDULED">Scheduled</option>
            <option value="ACTIVE">Active</option>
            <option value="PAUSED">Paused</option>
          </select>
        </div>
      </div>
      <InputField
        label="Eligible services"
        name="eligibleServices"
        defaultValue={promotion?.eligibleServices.join(", ")}
        placeholder="Heating Maintenance, Residential Tune-Up"
      />
      <InputField label="Promo code (optional)" name="promoCode" defaultValue={promotion?.promoCode || ""} />
      <div className="space-y-2">
        <Label htmlFor="terms">Terms</Label>
        <textarea id="terms" name="terms" defaultValue={promotion?.terms || ""} rows={3} className={textareaClass} />
      </div>
      <p className="text-xs text-[var(--muted-foreground)]">
        Regina receives this offer only while status is Active and the current time is inside the date range.
      </p>
      <Button type="submit">{promotion ? "Save promotion" : "Create promotion"}</Button>
    </ActionForm>
  );
}

function InputField({
  label,
  name,
  type = "text",
  defaultValue,
  placeholder,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string | null;
  placeholder?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} defaultValue={defaultValue || ""} placeholder={placeholder} required={["name", "offer", "headline", "startsAt", "endsAt"].includes(name)} />
    </div>
  );
}

function dateValue(value?: Date | null) {
  return value?.toISOString().slice(0, 10) || "";
}

const textareaClass = "w-full rounded-xl border border-[var(--border)] px-3 py-2 text-sm";
const selectClass = "h-10 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-sm";
