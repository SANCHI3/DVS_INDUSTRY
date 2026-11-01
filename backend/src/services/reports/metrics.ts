/**
 * Plant metrics defined once and shared by the dashboard, reports and
 * analytics, so the same number never means two things on two screens.
 */

export type AttendanceStatusName =
  'PRESENT' | 'ABSENT' | 'HALF_DAY' | 'LATE' | 'LEAVE' | 'WEEK_OFF';

/** Percent with one decimal, e.g. "91.3%"; null when there is nothing to divide by. */
export function percentText(part: number, whole: number): string | null {
  return whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : null;
}

// ── Production ───────────────────────────────────────────────────────────────

/**
 * A work order marked COMPLETED before its good output reached the target.
 * `completionPct` is produced / target in percent (null when the target is 0).
 */
export function completedShort(
  status: string,
  producedQty: number,
  targetQty: number,
): { short: boolean; completionPct: number | null } {
  const completionPct = targetQty > 0 ? (producedQty / targetQty) * 100 : null;
  return {
    short: status === 'COMPLETED' && completionPct !== null && completionPct < 100,
    completionPct,
  };
}

// ── Weekly offs ──────────────────────────────────────────────────────────────

/**
 * Each employee's usual weekly-off weekday (0 = Sunday, UTC), learned from
 * their own WEEK_OFF records: the weekday that occurs most, if at least twice.
 * There is no week-off setting per employee or shift, so the attendance
 * sheets are the source.
 */
export function usualWeekOffDays(
  weekOffs: Array<{ employeeId: number; date: Date }>,
): Map<number, number> {
  const counts = new Map<number, number[]>();
  for (const w of weekOffs) {
    const days = counts.get(w.employeeId) ?? [0, 0, 0, 0, 0, 0, 0];
    days[w.date.getUTCDay()] = (days[w.date.getUTCDay()] ?? 0) + 1;
    counts.set(w.employeeId, days);
  }
  const usual = new Map<number, number>();
  for (const [employeeId, days] of counts) {
    const max = Math.max(...days);
    if (max >= 2) usual.set(employeeId, days.indexOf(max));
  }
  return usual;
}

export interface AttendanceDay {
  present: number; // PRESENT + HALF_DAY
  late: number;
  absent: number;
  onLeave: number;
  weekOff: number; // recorded WEEK_OFF, plus unrecorded people whose usual off day it is
  recorded: number; // attendance rows for the day, any status
  /** (present + late) / working-day records; null when nobody was due to work or nothing is recorded */
  rate: string | null;
  /** Most of the active workforce is on its weekly off: no attendance warnings. */
  nonWorkingDay: boolean;
}

export function summariseAttendanceDay(input: {
  records: Array<{ employeeId: number; status: AttendanceStatusName }>;
  activeEmployeeIds: number[];
  usualOff: Map<number, number>;
  weekday: number;
}): AttendanceDay {
  const day: AttendanceDay = {
    present: 0,
    late: 0,
    absent: 0,
    onLeave: 0,
    weekOff: 0,
    recorded: input.records.length,
    rate: null,
    nonWorkingDay: false,
  };
  const seen = new Set<number>();
  for (const r of input.records) {
    seen.add(r.employeeId);
    if (r.status === 'PRESENT' || r.status === 'HALF_DAY') day.present++;
    else if (r.status === 'LATE') day.late++;
    else if (r.status === 'ABSENT') day.absent++;
    else if (r.status === 'LEAVE') day.onLeave++;
    else if (r.status === 'WEEK_OFF') day.weekOff++;
  }
  for (const id of input.activeEmployeeIds) {
    if (!seen.has(id) && input.usualOff.get(id) === input.weekday) day.weekOff++;
  }
  const working = day.recorded - input.records.filter((r) => r.status === 'WEEK_OFF').length;
  day.rate = percentText(day.present + day.late, working);
  const workforce = Math.max(input.activeEmployeeIds.length, day.recorded);
  day.nonWorkingDay = workforce > 0 && day.weekOff * 2 >= workforce;
  return day;
}
