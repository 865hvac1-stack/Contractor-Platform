export type SyncStartOption = "today" | "month" | "year" | "custom";

export function startOfLocalDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

export function defaultSyncStartDate(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export function resolveSyncStartDate(
  option: SyncStartOption,
  custom?: string | null,
  now = new Date()
): Date {
  if (option === "today") return startOfLocalDay(now);
  if (option === "year") return new Date(now.getFullYear(), 0, 1);
  if (option === "custom" && custom) {
    const parsed = new Date(`${custom}T00:00:00`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return defaultSyncStartDate(now);
}

export function syncStartOptionFromDate(value?: Date | null, now = new Date()): SyncStartOption {
  if (!value) return "month";
  const day = startOfLocalDay(value).getTime();
  if (day === startOfLocalDay(now).getTime()) return "today";
  if (day === new Date(now.getFullYear(), now.getMonth(), 1).getTime()) return "month";
  if (day === new Date(now.getFullYear(), 0, 1).getTime()) return "year";
  return "custom";
}
