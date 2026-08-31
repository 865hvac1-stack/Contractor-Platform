import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateJobNotesAction } from "@/server/actions/field";

export function JobNotesForm({
  jobId,
  internalNotes,
  customerNotes,
}: {
  jobId: string;
  internalNotes: string | null;
  customerNotes: string | null;
}) {
  return (
    <div className="mt-4 space-y-4">
      <ActionForm action={updateJobNotesAction} successMessage="Internal note saved.">
        <input type="hidden" name="jobId" value={jobId} />
        <input type="hidden" name="audience" value="internal" />
        <Label htmlFor="internal-note">Technician / internal note</Label>
        <p className="mb-2 text-xs text-[var(--muted-foreground)]">
          Stays inside ContractorYou. Never shown on customer estimates or invoices.
        </p>
        <Textarea
          id="internal-note"
          name="note"
          rows={3}
          defaultValue={internalNotes ?? ""}
          placeholder="What the office needs to know"
        />
        <Button type="submit" variant="outline" className="mt-2 h-11 w-full">
          Save internal note
        </Button>
      </ActionForm>
      <ActionForm action={updateJobNotesAction} successMessage="Customer note saved.">
        <input type="hidden" name="jobId" value={jobId} />
        <input type="hidden" name="audience" value="customer" />
        <Label htmlFor="customer-note">Customer-facing note</Label>
        <p className="mb-2 text-xs text-[var(--muted-foreground)]">
          Safe to show the customer. Do not put costs, margins, or office-only detail here.
        </p>
        <Textarea
          id="customer-note"
          name="note"
          rows={3}
          defaultValue={customerNotes ?? ""}
          placeholder="What the customer should see"
        />
        <Button type="submit" variant="outline" className="mt-2 h-11 w-full">
          Save customer note
        </Button>
      </ActionForm>
    </div>
  );
}
