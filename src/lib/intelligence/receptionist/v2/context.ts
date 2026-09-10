export const RECEPTIONIST_HISTORY_LIMIT = 8;
export const RECEPTIONIST_HISTORY_BODY_CHARS = 240;

export function boundConversationHistory(
  rows: Array<{ direction: string; body?: string | null }>,
  options?: { newestFirst?: boolean }
) {
  const limited = (options?.newestFirst ? rows.slice(0, RECEPTIONIST_HISTORY_LIMIT) : rows.slice(-RECEPTIONIST_HISTORY_LIMIT));
  const chronological = options?.newestFirst ? [...limited].reverse() : limited;
  return chronological.map((row) => ({
    direction: row.direction,
    body: (row.body || "").slice(0, RECEPTIONIST_HISTORY_BODY_CHARS),
  }));
}

export function historyUnderTokenBudget(rows: Array<{ direction: string; body: string }>) {
  return rows.length <= RECEPTIONIST_HISTORY_LIMIT && rows.every((row) => row.body.length <= RECEPTIONIST_HISTORY_BODY_CHARS);
}
