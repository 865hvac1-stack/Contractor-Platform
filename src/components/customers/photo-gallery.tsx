"use client";

import { useMemo, useState } from "react";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "property", label: "Property" },
  { id: "equipment", label: "Equipment" },
  { id: "jobs", label: "Jobs" },
  { id: "BEFORE", label: "Before" },
  { id: "DIAGNOSTIC", label: "Diagnosis" },
  { id: "AFTER", label: "After" },
  { id: "RECEIPT", label: "Documents" },
] as const;

export function CustomerPhotoGallery({
  photos,
}: {
  photos: {
    id: string;
    kind: string;
    kindLabel: string;
    caption: string | null;
    createdAt: Date;
    equipmentId: string | null;
    job: { jobNumber: string };
    uploadedBy: { firstName: string; lastName: string } | null;
  }[];
}) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const visible = useMemo(() => {
    if (filter === "all" || filter === "jobs" || filter === "property") return photos;
    if (filter === "equipment") return photos.filter((photo) => photo.equipmentId || photo.kind === "EQUIPMENT" || photo.kind === "DATA_PLATE");
    return photos.filter((photo) => photo.kind === filter);
  }, [filter, photos]);
  const pairs = useMemo(() => {
    const byJob = new Map<string, typeof photos>();
    for (const photo of photos) {
      if (photo.kind !== "BEFORE" && photo.kind !== "AFTER") continue;
      const list = byJob.get(photo.job.jobNumber) ?? [];
      list.push(photo);
      byJob.set(photo.job.jobNumber, list);
    }
    return [...byJob.entries()].filter(([, list]) => list.some((p) => p.kind === "BEFORE") && list.some((p) => p.kind === "AFTER"));
  }, [photos]);

  if (photos.length === 0) {
    return <p className="mt-2 text-sm text-[var(--muted-foreground)]">No photos on file for this property yet.</p>;
  }

  return (
    <div className="mt-3 space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setFilter(item.id)}
            className={`rounded-full px-3 py-1 text-xs ${
              filter === item.id ? "bg-[var(--cy-navy)] text-white" : "bg-white text-[var(--cy-navy)] ring-1 ring-[var(--border)]"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {visible.map((photo) => (
          <li key={photo.id}>
            <button type="button" onClick={() => setOpenId(photo.id)} className="block w-full overflow-hidden rounded-2xl bg-[var(--cy-navy)] text-left">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/job-photos/${photo.id}`} alt={photo.kindLabel} className="aspect-square w-full object-cover" />
              <p className="px-3 py-2 text-[11px] text-white/80">
                {photo.kindLabel} · {photo.job.jobNumber}
              </p>
            </button>
          </li>
        ))}
      </ul>
      {pairs.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold text-[var(--cy-navy)]">Before / after</h3>
          <ul className="mt-2 space-y-3">
            {pairs.map(([jobNumber, list]) => (
              <li key={jobNumber} className="rounded-2xl border border-[var(--border)] bg-white p-3">
                <p className="text-xs text-[var(--cy-text-muted)]">Job {jobNumber}</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {["BEFORE", "AFTER"].map((kind) => {
                    const photo = list.find((row) => row.kind === kind);
                    return photo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={kind} src={`/api/job-photos/${photo.id}`} alt={kind} className="aspect-video w-full rounded-xl object-cover" />
                    ) : null;
                  })}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {openId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setOpenId(null)}>
          <figure className="max-w-3xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/job-photos/${openId}`} alt="" className="max-h-[80vh] rounded-2xl" />
            {photos.find((photo) => photo.id === openId) ? (
              <figcaption className="mt-2 text-sm text-white">
                {photos.find((photo) => photo.id === openId)?.kindLabel} ·{" "}
                {photos.find((photo) => photo.id === openId)?.job.jobNumber}
                {photos.find((photo) => photo.id === openId)?.uploadedBy
                  ? ` · ${photos.find((photo) => photo.id === openId)?.uploadedBy?.firstName}`
                  : ""}
              </figcaption>
            ) : null}
          </figure>
        </div>
      ) : null}
    </div>
  );
}
