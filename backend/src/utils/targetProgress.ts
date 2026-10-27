/**
 * Month-target maths. Actual output always comes from recorded work-order
 * output; the target is only what it is compared against. Every result is
 * null when it cannot be calculated, so the UI shows "N/A", never a guess.
 */

/** "2026-10" → 2026-10-01T00:00:00.000Z; null for anything else. */
export function monthStart(month: string): Date | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (m === null) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
}

export function nextMonthStart(start: Date): Date {
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
}

export function monthKey(start: Date): string {
  return start.toISOString().slice(0, 7);
}

/** Percentage to one decimal; null when the denominator is not above zero. */
export function percent(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

export type Pace = 'NOT_STARTED' | 'ON_TRACK' | 'BEHIND' | 'MET';

export interface TargetProgress {
  daysInMonth: number;
  /** Days of the month that have begun (today counts); 0 for a future month. */
  daysElapsed: number;
  /** actual ÷ target × 100 */
  progressPct: number | null;
  /** Output a straight-line pace would have reached by now. */
  expectedToDate: number | null;
  pace: Pace | null;
}

export function computeTargetProgress(
  target: number | null,
  actual: number,
  start: Date,
  now: Date = new Date(),
): TargetProgress {
  const end = nextMonthStart(start);
  const daysInMonth = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  const daysElapsed =
    now < start
      ? 0
      : now >= end
        ? daysInMonth
        : Math.floor((now.getTime() - start.getTime()) / 86_400_000) + 1;

  if (target === null || !(target > 0)) {
    return { daysInMonth, daysElapsed, progressPct: null, expectedToDate: null, pace: null };
  }
  const expectedToDate = Math.round(((target * daysElapsed) / daysInMonth) * 1000) / 1000;
  const pace: Pace =
    actual >= target
      ? 'MET'
      : daysElapsed === 0
        ? 'NOT_STARTED'
        : actual >= expectedToDate
          ? 'ON_TRACK'
          : 'BEHIND';
  return { daysInMonth, daysElapsed, progressPct: percent(actual, target), expectedToDate, pace };
}

/** MET / MISSED against a threshold; null when either side is unknown. */
export function checkThreshold(
  actual: number | null,
  threshold: number | null,
  direction: 'atLeast' | 'atMost',
): 'MET' | 'MISSED' | null {
  if (actual === null || threshold === null) return null;
  const met = direction === 'atLeast' ? actual >= threshold : actual <= threshold;
  return met ? 'MET' : 'MISSED';
}
