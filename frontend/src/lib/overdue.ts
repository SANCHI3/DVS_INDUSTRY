const DAY_MS = 86_400_000;
const CLOSED = new Set(["DELIVERED", "CANCELLED"]);

/**
 * Whole days an order is past its due date (required-by for client orders,
 * expected delivery for purchase orders); 0 when it is on time, has no due
 * date, or is already delivered or cancelled. Counted by calendar day.
 */
export function daysOverdue(due: string | null | undefined, status: string, now: Date = new Date()): number {
  if (!due || CLOSED.has(status.toUpperCase())) return 0;
  const dueDay = new Date(due);
  const dueUtc = Date.UTC(dueDay.getUTCFullYear(), dueDay.getUTCMonth(), dueDay.getUTCDate());
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((todayUtc - dueUtc) / DAY_MS));
}

export function overdueLabel(days: number): string {
  return `Overdue by ${days} day${days === 1 ? "" : "s"}`;
}

/** Most overdue first; the rest keep their order. */
export function overdueFirst<T extends { overdueDays: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.overdueDays - a.overdueDays);
}
