import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { uploadReceiptAction } from "@/server/actions/receipts";

export function TechReceiptUpload({
  jobId,
  defaultVehicleId,
}: {
  jobId: string;
  defaultVehicleId: string | null | undefined;
}) {
  return (
    <ActionForm action={uploadReceiptAction} className="mt-3 space-y-3" successMessage="Receipt uploaded.">
      <input type="hidden" name="returnTo" value={`/tech/jobs/${jobId}`} />
      <div className="space-y-2">
        <Label htmlFor="receipt-file">Receipt photo</Label>
        <input
          id="receipt-file"
          name="file"
          type="file"
          accept="image/*,application/pdf"
          capture="environment"
          required
          className="block w-full rounded-xl border border-dashed border-[var(--border)] bg-[var(--muted)] p-4 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--cy-navy)] file:px-4 file:py-2 file:text-white"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="receipt-assign">Assign to</Label>
        <select
          id="receipt-assign"
          name="assignment"
          defaultValue="JOB"
          className="h-11 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
        >
          <option value="JOB">Current job</option>
          <option value="VEHICLE">My truck</option>
          <option value="OVERHEAD">Company expense</option>
        </select>
      </div>
      {defaultVehicleId ? <input type="hidden" name="vehicleId" value={defaultVehicleId} /> : null}
      <input type="hidden" name="jobId" value={jobId} />
      <Button type="submit" className="h-12 w-full">
        Upload receipt
      </Button>
    </ActionForm>
  );
}
