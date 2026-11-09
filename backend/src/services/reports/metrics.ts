/**
 * Plant metrics defined once and shared by the dashboard, reports and
 * analytics, so the same number never means two things on two screens.
 */

import { weeklyOffFor } from '../../config/plant';

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

/** An active employee and their own weekly off (null = the plant's, Saturday). */
export interface RosterEntry {
  id: number;
  weeklyOffDay: number | null;
}

export interface AttendanceDay {
  present: number; // PRESENT + HALF_DAY
  late: number;
  absent: number;
  onLeave: number;
  weekOff: number; // recorded WEEK_OFF, plus unrecorded people whose weekly off it is
  recorded: number; // attendance rows for the day, any status
  /** (present + late) / working-day records; null when nobody was due to work or nothing is recorded */
  rate: string | null;
  /** Most of the active workforce is on its weekly off: no attendance warnings. */
  nonWorkingDay: boolean;
}

/**
 * One day's attendance. `weekday` is the day's weekday (0 = Sunday,
 * 6 = Saturday). Each employee's weekly off is their own setting, else the
 * plant's (Saturday). Someone marked Present on their weekly off still counts.
 * A Sunday with nothing entered is "not entered yet", like any working day.
 */
export function summariseAttendanceDay(input: {
  records: Array<{ employeeId: number; status: AttendanceStatusName }>;
  roster: RosterEntry[];
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
  for (const e of input.roster) {
    if (!seen.has(e.id) && weeklyOffFor(e.weeklyOffDay) === input.weekday) day.weekOff++;
  }
  const working = day.recorded - input.records.filter((r) => r.status === 'WEEK_OFF').length;
  day.rate = percentText(day.present + day.late, working);
  const workforce = Math.max(input.roster.length, day.recorded);
  day.nonWorkingDay = workforce > 0 && day.weekOff * 2 >= workforce;
  return day;
}
