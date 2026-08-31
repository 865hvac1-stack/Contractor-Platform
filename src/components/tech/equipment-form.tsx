import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { upsertEquipmentAction } from "@/server/actions/equipment";

export function EquipmentForm({
  jobId,
  customerId,
  propertyId,
  warrantyJob,
}: {
  jobId: string;
  customerId: string;
  propertyId: string;
  warrantyJob?: boolean;
}) {
  return (
    <ActionForm action={upsertEquipmentAction} className="mt-4 space-y-3" successMessage="Equipment saved.">
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="customerId" value={customerId} />
      <input type="hidden" name="propertyId" value={propertyId} />
      <div className="space-y-1">
        <Label htmlFor="eq-name">Name</Label>
        <Input id="eq-name" name="name" required placeholder="Outdoor unit, water heater…" className="h-11" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="eq-type">Type</Label>
          <Input id="eq-type" name="equipmentType" className="h-11" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="eq-mfr">Manufacturer</Label>
          <Input id="eq-mfr" name="manufacturer" className="h-11" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="eq-model">Model</Label>
          <Input id="eq-model" name="model" className="h-11" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="eq-serial">Serial</Label>
          <Input id="eq-serial" name="serialNumber" className="h-11" />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="eq-install">Install date</Label>
        <Input id="eq-install" name="installDate" type="date" className="h-11" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="eq-notes">Note</Label>
        <Textarea id="eq-notes" name="notes" rows={2} />
      </div>
      {warrantyJob ? (
        <div className="space-y-1">
          <Label htmlFor="eq-warranty">Warranty / failed part notes</Label>
          <Textarea
            id="eq-warranty"
            name="warrantyNotes"
            rows={2}
            placeholder="Failed part, replacement part, and why this is warranty work. Vendor claims are not submitted from here."
          />
        </div>
      ) : null}
      <Button type="submit" className="h-12 w-full">
        Save equipment
      </Button>
    </ActionForm>
  );
}
