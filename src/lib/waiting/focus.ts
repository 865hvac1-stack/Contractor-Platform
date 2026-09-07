import type { WaitingCard } from "@/lib/waiting/types";

export const WAITING_FOCUS_VALUES = ["waiting", "parts", "ready", "overdue", "due"] as const;
export type WaitingFocus = (typeof WAITING_FOCUS_VALUES)[number];

export type WaitingFocusColumn = {
  id: string;
  key: string;
  kind: string;
};

export type WaitingViewFilters = {
  focus?: WaitingFocus | null;
  columnId?: string;
  overdue?: boolean;
  updateDue?: boolean;
};

const FOCUS_TITLES: Record<WaitingFocus, string> = {
  waiting: "Currently waiting",
  parts: "Waiting on parts",
  ready: "Ready to schedule",
  overdue: "Overdue",
  due: "Updates due today",
};

const FOCUS_EMPTY: Record<WaitingFocus, string> = {
  waiting: "No jobs are currently waiting.",
  parts: "No jobs are waiting on parts.",
  ready: "No jobs are ready to schedule.",
  overdue: "No overdue waiting jobs.",
  due: "No customer updates are due today.",
};

export function parseWaitingFocus(value: string | null | undefined): WaitingFocus | null {
  if (!value) return null;
  return (WAITING_FOCUS_VALUES as readonly string[]).includes(value) ? (value as WaitingFocus) : null;
}

export function waitingFocusTitle(focus: WaitingFocus | null | undefined) {
  return focus ? FOCUS_TITLES[focus] : "Waiting Board";
}

export function waitingFocusEmptyMessage(focus: WaitingFocus | null | undefined) {
  if (!focus) return "No matching waiting jobs.";
  return FOCUS_EMPTY[focus];
}

export function waitingFocusCountLabel(focus: WaitingFocus | null | undefined, count: number) {
  if (focus === "ready") return count === 1 ? "1 job ready" : `${count} jobs ready`;
  if (focus === "due") return count === 1 ? "1 update due today" : `${count} updates due today`;
  if (focus === "overdue") return count === 1 ? "1 overdue job" : `${count} overdue jobs`;
  if (focus === "parts") return count === 1 ? "1 job waiting on a part" : `${count} jobs waiting on parts`;
  return count === 1 ? "1 waiting job" : `${count} waiting jobs`;
}

export function isWaitingUpdateDueToday(
  card: { nextCustomerUpdateAt: Date | null; automationEnabled?: boolean },
  now = new Date()
) {
  if (!card.nextCustomerUpdateAt || card.automationEnabled === false) return false;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return card.nextCustomerUpdateAt >= start && card.nextCustomerUpdateAt <= end;
}

export function resolveWaitingFocusColumnId(
  columns: WaitingFocusColumn[],
  focus: WaitingFocus | null | undefined
) {
  if (focus === "parts") return columns.find((column) => column.key === "WAITING_ON_PART")?.id ?? null;
  if (focus === "ready") {
    return columns.find((column) => column.kind === "READY" || column.key === "READY_TO_SCHEDULE")?.id ?? null;
  }
  return null;
}

export function applyWaitingFocus<T extends WaitingViewFilters>(
  filters: T,
  columns: WaitingFocusColumn[]
): T {
  const focus = filters.focus ?? null;
  if (!focus) return filters;

  const next = { ...filters };
  if (focus === "overdue") next.overdue = true;
  if (focus === "due") next.updateDue = true;

  const focusColumnId = resolveWaitingFocusColumnId(columns, focus);
  if (focusColumnId && !filters.columnId) next.columnId = focusColumnId;
  return next;
}

export function cardMatchesWaitingView(
  card: WaitingCard,
  filters: WaitingViewFilters,
  now = new Date()
) {
  if (filters.columnId && card.columnId !== filters.columnId) return false;
  if (filters.overdue && !card.overdue && !card.urgent) return false;
  if (filters.updateDue && !isWaitingUpdateDueToday(card, now)) return false;
  return true;
}

export function applyWaitingBoardView<T extends WaitingFocusColumn & { cards: WaitingCard[] }>(
  board: { columns: T[]; cards: WaitingCard[] },
  view: WaitingViewFilters,
  now = new Date()
) {
  const applied = applyWaitingFocus(view, board.columns);
  const cards = board.cards.filter((card) => cardMatchesWaitingView(card, applied, now));
  return {
    columns: board.columns.map((column) => ({
      ...column,
      cards: cards.filter((card) => card.columnId === column.id),
    })),
    cards,
  };
}

export function waitingBoardHref(input: {
  focus?: WaitingFocus | null;
  q?: string;
  owner?: string;
  tech?: string;
  column?: string;
  overdue?: boolean;
  due?: boolean;
} = {}) {
  const params = new URLSearchParams();
  if (input.q?.trim()) params.set("q", input.q.trim());
  if (input.owner) params.set("owner", input.owner);
  if (input.tech) params.set("tech", input.tech);
  if (input.focus) params.set("focus", input.focus);
  if (input.column) params.set("column", input.column);
  if (input.overdue) params.set("overdue", "1");
  if (input.due) params.set("due", "1");
  const query = params.toString();
  return query ? `/operations/waiting?${query}` : "/operations/waiting";
}

export function waitingKpiHref(
  focus: WaitingFocus,
  current: { q?: string; owner?: string; tech?: string } = {}
) {
  return waitingBoardHref({
    focus,
    q: current.q,
    owner: current.owner,
    tech: current.tech,
  });
}
