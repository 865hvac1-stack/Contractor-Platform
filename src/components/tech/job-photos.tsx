import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { uploadJobPhotoAction } from "@/server/actions/field";

const KINDS = [
  { value: "BEFORE", label: "Before" },
  { value: "AFTER", label: "After" },
  { value: "EQUIPMENT", label: "Equipment" },
  { value: "DATA_PLATE", label: "Data plate" },
  { value: "DIAGNOSTIC", label: "Problem / diagnostic" },
  { value: "OTHER", label: "Other" },
];

export function JobPhotoUpload({
  jobId,
  equipment,
}: {
  jobId: string;
  equipment: { id: string; name: string }[];
}) {
  return (
    <ActionForm action={uploadJobPhotoAction} className="mt-3 space-y-3" successMessage="Photo attached to this job.">
      <input type="hidden" name="jobId" value={jobId} />
      <div className="space-y-2">
        <Label htmlFor="job-photo">Take or upload a photo</Label>
        <input
          id="job-photo"
          name="file"
          type="file"
          accept="image/*"
          capture="environment"
          required
          className="block w-full rounded-xl border border-dashed border-[var(--border)] bg-[var(--muted)] p-4 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--cy-navy)] file:px-4 file:py-2 file:text-white"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="photo-kind">Kind</Label>
          <select
            id="photo-kind"
            name="kind"
            defaultValue="BEFORE"
            className="h-11 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
          >
            {KINDS.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {kind.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="photo-equipment">Equipment</Label>
          <select
            id="photo-equipment"
            name="equipmentId"
            defaultValue=""
            className="h-11 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
          >
            <option value="">This job</option>
            {equipment.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <Button type="submit" className="h-12 w-full">
        Attach photo
      </Button>
    </ActionForm>
  );
}
