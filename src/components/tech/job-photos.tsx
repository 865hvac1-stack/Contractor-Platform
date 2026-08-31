"use client";

import { useRef, useState, useTransition } from "react";
import { uploadJobPhotoAction } from "@/server/actions/field";
import { JOB_PHOTO_KINDS } from "@/lib/tech/photos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function JobPhotoUpload({
  jobId,
  equipment,
  defaultKind = "BEFORE",
  defaultOpen = false,
}: {
  jobId: string;
  equipment: { id: string; name: string }[];
  defaultKind?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function submit(source: "camera" | "library") {
    const input = source === "camera" ? cameraRef.current : libraryRef.current;
    const files = input?.files;
    if (!files?.length) return;
    const form = new FormData(formRef.current ?? undefined);
    form.set("jobId", jobId);
    form.delete("files");
    for (const file of Array.from(files)) form.append("files", file);
    start(async () => {
      setError(null);
      setMessage(null);
      const result = await uploadJobPhotoAction(null, form);
      if (result.ok) {
        setMessage(files.length > 1 ? `${files.length} photos attached.` : "Photo attached to this job.");
        if (formRef.current) formRef.current.reset();
      } else {
        setError(result.error);
      }
    });
  }

  if (!open) {
    return (
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" className="h-12" onClick={() => setOpen(true)}>
          Take photo
        </Button>
        <Button type="button" variant="outline" className="h-12" onClick={() => setOpen(true)}>
          Choose from library
        </Button>
      </div>
    );
  }

  return (
    <form ref={formRef} className="space-y-3">
      <input type="hidden" name="jobId" value={jobId} />
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="photo-kind">Category</Label>
          <select
            id="photo-kind"
            name="kind"
            defaultValue={defaultKind}
            className="h-11 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
          >
            {JOB_PHOTO_KINDS.map((kind) => (
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
      <div className="space-y-1">
        <Label htmlFor="photo-caption">Note (optional)</Label>
        <Input id="photo-caption" name="caption" placeholder="Outdoor unit data plate" className="h-11" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className={pending ? "pointer-events-none opacity-60" : ""}>
          <span className="inline-flex h-12 w-full items-center justify-center rounded-lg bg-[var(--cy-navy)] text-sm font-medium text-white">
            Take photo
          </span>
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={() => submit("camera")}
          />
        </label>
        <label className={pending ? "pointer-events-none opacity-60" : ""}>
          <span className="inline-flex h-12 w-full items-center justify-center rounded-lg border border-[var(--border)] text-sm font-medium">
            Choose from library
          </span>
          <input
            ref={libraryRef}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            onChange={() => submit("library")}
          />
        </label>
      </div>
      {pending ? <p className="text-sm text-[var(--muted-foreground)]">Uploading… keep this screen open.</p> : null}
      {message ? <p className="text-sm text-emerald-800">{message}</p> : null}
      {error ? (
        <p className="text-sm text-rose-700" role="alert">
          {error} Try again — the photo was not saved.
        </p>
      ) : null}
    </form>
  );
}
