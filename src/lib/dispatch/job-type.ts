export type DispatchJobKind =
  | "emergency"
  | "maintenance"
  | "install"
  | "estimate"
  | "callback"
  | "commercial"
  | "service";

export function classifyDispatchJob(input: { jobType?: string | null; priority?: string | null; description?: string | null }) {
  const text = `${input.jobType || ""} ${input.description || ""}`.toLowerCase();
  if (input.priority === "URGENT" || /emergency|no cooling|no heat|after-hours/.test(text)) return "emergency" as const;
  if (/maintenance|tune-?up|comfort club/.test(text)) return "maintenance" as const;
  if (/install|replacement|changeout|change-out/.test(text)) return "install" as const;
  if (/estimate|walkthrough|quote/.test(text)) return "estimate" as const;
  if (/callback|follow-?up/.test(text)) return "callback" as const;
  if (/commercial/.test(text)) return "commercial" as const;
  return "service" as const;
}

export const JOB_KIND_LABEL: Record<DispatchJobKind, string> = {
  emergency: "Emergency",
  maintenance: "Maintenance",
  install: "Install",
  estimate: "Estimate",
  callback: "Callback",
  commercial: "Commercial",
  service: "Service",
};

export const JOB_KIND_ACCENT: Record<DispatchJobKind, string> = {
  emergency: "border-l-rose-500",
  maintenance: "border-l-emerald-500",
  install: "border-l-[var(--cy-navy)]",
  estimate: "border-l-violet-500",
  callback: "border-l-amber-500",
  commercial: "border-l-slate-500",
  service: "border-l-[var(--cy-orange)]",
};
