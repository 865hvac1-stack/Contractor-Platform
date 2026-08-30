import { cn } from "@/lib/utils";

const toneMap: Record<string, string> = {
  NEW: "bg-slate-100 text-slate-700",
  UNSCHEDULED: "bg-amber-50 text-amber-800",
  SCHEDULED: "bg-sky-50 text-sky-800",
  DISPATCHED: "bg-indigo-50 text-indigo-800",
  IN_PROGRESS: "bg-teal-50 text-teal-800",
  ON_HOLD: "bg-orange-50 text-orange-800",
  COMPLETED: "bg-emerald-50 text-emerald-800",
  CANCELED: "bg-stone-100 text-stone-500",
  DRAFT: "bg-slate-100 text-slate-700",
  SENT: "bg-sky-50 text-sky-800",
  VIEWED: "bg-violet-50 text-violet-800",
  APPROVED: "bg-emerald-50 text-emerald-800",
  DECLINED: "bg-rose-50 text-rose-800",
  EXPIRED: "bg-stone-100 text-stone-500",
  PARTIALLY_PAID: "bg-amber-50 text-amber-800",
  PAID: "bg-emerald-50 text-emerald-800",
  OVERDUE: "bg-rose-50 text-rose-800",
  VOID: "bg-stone-100 text-stone-500",
  ACTIVE: "bg-emerald-50 text-emerald-800",
  SUSPENDED: "bg-rose-50 text-rose-800",
  ONBOARDING: "bg-amber-50 text-amber-800",
  INACTIVE: "bg-stone-100 text-stone-500",
  LEAD: "bg-sky-50 text-sky-800",
  ARCHIVED: "bg-stone-100 text-stone-500",
  UPLOADED: "bg-slate-100 text-slate-700",
  PROCESSING: "bg-sky-50 text-sky-800",
  REVIEW_REQUIRED: "bg-amber-50 text-amber-800",
  CONFIRMED: "bg-emerald-50 text-emerald-800",
  FAILED: "bg-rose-50 text-rose-800",
  LOW: "bg-slate-100 text-slate-600",
  NORMAL: "bg-stone-100 text-stone-700",
  HIGH: "bg-orange-50 text-orange-800",
  URGENT: "bg-rose-50 text-rose-800",
  CONTACTED: "bg-sky-50 text-sky-800",
  BOOKED: "bg-emerald-50 text-emerald-800",
  ESTIMATE_SCHEDULED: "bg-indigo-50 text-indigo-800",
  ESTIMATE_SENT: "bg-violet-50 text-violet-800",
  WON: "bg-emerald-50 text-emerald-800",
  LOST: "bg-rose-50 text-rose-800",
  SPAM: "bg-stone-100 text-stone-500",
  NOT_CONNECTED: "bg-slate-100 text-slate-600",
  CONNECTING: "bg-amber-50 text-amber-800",
  SELECT_ACCOUNT: "bg-amber-50 text-amber-800",
  SYNCING: "bg-sky-50 text-sky-800",
  CONNECTED: "bg-emerald-50 text-emerald-800",
  PUBLISHED: "bg-emerald-50 text-emerald-800",
  PARTIALLY_PUBLISHED: "bg-amber-50 text-amber-800",
  PUBLISHING: "bg-indigo-50 text-indigo-800",
  CANCELLED: "bg-stone-100 text-stone-500",
  REAUTH_REQUIRED: "bg-orange-50 text-orange-800",
  ERROR: "bg-rose-50 text-rose-800",
  DISABLED: "bg-stone-100 text-stone-500",
  SENDING: "bg-amber-50 text-amber-800",
  PAUSED: "bg-stone-100 text-stone-600",
  ANALYZING: "bg-sky-50 text-sky-800",
  MAPPING_REQUIRED: "bg-amber-50 text-amber-800",
  READY_FOR_PREVIEW: "bg-indigo-50 text-indigo-800",
  READY_TO_IMPORT: "bg-teal-50 text-teal-800",
  IMPORTING: "bg-sky-50 text-sky-800",
  PARTIAL: "bg-amber-50 text-amber-800",
  SKIPPED: "bg-stone-100 text-stone-500",
  VALID: "bg-emerald-50 text-emerald-800",
  WARNING: "bg-amber-50 text-amber-800",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium tracking-wide",
        toneMap[status] ?? "bg-stone-100 text-stone-700",
        className
      )}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}
