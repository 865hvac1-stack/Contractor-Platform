"use client";

import { useRef, useState, useTransition } from "react";
import { uploadReceiptAction } from "@/server/actions/receipts";
import { Label } from "@/components/ui/label";

export function TechReceiptUpload({
  jobId,
  defaultVehicleId,
  returnTo,
}: {
  jobId?: string;
  defaultVehicleId: string | null | undefined;
  returnTo?: string;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function submit(source: "camera" | "library") {
    const input = source === "camera" ? cameraRef.current : libraryRef.current;
    const file = input?.files?.[0];
    if (!file || !formRef.current) return;
    const form = new FormData(formRef.current);
    form.set("file", file);
    start(async () => {
      setError(null);
      setMessage(null);
      const result = await uploadReceiptAction(null, form);
      if (result && "ok" in result && result.ok) setMessage("Receipt uploaded.");
      else if (result && "ok" in result && !result.ok) setError(result.error);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        className="inline-flex h-12 w-full items-center justify-center rounded-lg bg-[var(--cy-navy)] text-sm font-medium text-white"
        onClick={() => setOpen(true)}
      >
        + Add receipt
      </button>
    );
  }

  return (
    <form ref={formRef} className="space-y-3">
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : jobId ? <input type="hidden" name="returnTo" value={`/tech/jobs/${jobId}`} /> : <input type="hidden" name="returnTo" value="/tech/receipts" />}
      {jobId ? <input type="hidden" name="jobId" value={jobId} /> : null}
      {defaultVehicleId ? <input type="hidden" name="vehicleId" value={defaultVehicleId} /> : null}
      <div className="space-y-1">
        <Label htmlFor="receipt-assign">Assign to</Label>
        <select
          id="receipt-assign"
          name="assignment"
          defaultValue={jobId ? "JOB" : "VEHICLE"}
          className="h-11 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
        >
          {jobId ? <option value="JOB">Current job</option> : null}
          <option value="VEHICLE">My truck</option>
          <option value="OVERHEAD">Company expense</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className={pending ? "pointer-events-none opacity-60" : ""}>
          <span className="inline-flex h-12 w-full items-center justify-center rounded-lg bg-[var(--cy-navy)] text-sm font-medium text-white">
            Take photo
          </span>
          <input ref={cameraRef} type="file" accept="image/*,application/pdf" capture="environment" className="sr-only" onChange={() => submit("camera")} />
        </label>
        <label className={pending ? "pointer-events-none opacity-60" : ""}>
          <span className="inline-flex h-12 w-full items-center justify-center rounded-lg border border-[var(--border)] text-sm font-medium">
            Choose from library
          </span>
          <input ref={libraryRef} type="file" accept="image/*,application/pdf" className="sr-only" onChange={() => submit("library")} />
        </label>
      </div>
      {pending ? <p className="text-sm text-[var(--muted-foreground)]">Uploading…</p> : null}
      {message ? <p className="text-sm text-emerald-800">{message}</p> : null}
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
    </form>
  );
}
