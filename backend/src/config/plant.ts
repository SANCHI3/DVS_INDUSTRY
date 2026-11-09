/**
 * Plant calendar: the one place that says which weekday the plant is closed
 * and which calendar day "today" is.
 *
 * The plant's weekly off is SATURDAY. Sunday is a normal working day.
 * Set PLANT_WEEKLY_OFF to change it; an employee's own weekly off
 * (Employee.weeklyOffDay) overrides it for that person.
 *
 * Attendance and output dates are stored as midnight UTC of the plant's
 * calendar day, so `getUTCDay()` on a stored date is its weekday. "Today" must
 * be the plant's (IST) calendar day, not the server's UTC day: at 00:30 IST on
 * a Saturday it is still Friday in UTC.
 */

/** Index = JavaScript weekday number (Date#getUTCDay): 0 = Sunday … 6 = Saturday. */
export const WEEKDAYS = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
] as const;
export type WeekdayName = (typeof WEEKDAYS)[number];

export const DEFAULT_WEEKLY_OFF: WeekdayName = 'SATURDAY';

/** India Standard Time, UTC+5:30, no daylight saving. */
export const PLANT_UTC_OFFSET_MINUTES = 330;

const DAY_MS = 86_400_000;

/** "saturday" / "SATURDAY" → 6. Empty means the default; anything else throws. */
export function parseWeekday(value: string | undefined): number {
  const text = (value ?? '').trim().toUpperCase();
  if (text === '') return WEEKDAYS.indexOf(DEFAULT_WEEKLY_OFF);
  const day = WEEKDAYS.indexOf(text as WeekdayName);
  if (day < 0) {
    throw new Error(`PLANT_WEEKLY_OFF must be a weekday name such as SATURDAY, not "${value}"`);
  }
  return day;
}

/** The plant's weekly off as a weekday number (6 = Saturday by default). */
export const PLANT_WEEKLY_OFF_DAY: number = parseWeekday(process.env['PLANT_WEEKLY_OFF']);

/** 6 → "Saturday" */
export function weekdayLabel(day: number): string {
  const name = WEEKDAYS[day] ?? 'SATURDAY';
  return name.charAt(0) + name.slice(1).toLowerCase();
}

/** The plant's weekly off in words, e.g. "Saturday". */
export const PLANT_WEEKLY_OFF_LABEL = weekdayLabel(PLANT_WEEKLY_OFF_DAY);

/** An employee's weekly off: their own setting, else the plant's. */
export function weeklyOffFor(override: number | null | undefined): number {
  return override !== null && override !== undefined && override >= 0 && override <= 6
    ? override
    : PLANT_WEEKLY_OFF_DAY;
}

/** The plant's calendar day at `now`, as midnight UTC (the form dates are stored in). */
export function plantToday(now: Date = new Date()): Date {
  const local = new Date(now.getTime() + PLANT_UTC_OFFSET_MINUTES * 60_000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
}

/** Weekday of a stored calendar date (midnight UTC). */
export function weekdayOf(day: Date): number {
  return day.getUTCDay();
}

/** True unless the day is the given weekly off (the plant's by default). */
export function isWorkingDay(day: Date, weeklyOff: number = PLANT_WEEKLY_OFF_DAY): boolean {
  return weekdayOf(day) !== weeklyOff;
}

/** Working days in [from, to) — both midnight UTC calendar dates. */
export function workingDaysBetween(
  from: Date,
  to: Date,
  weeklyOff: number = PLANT_WEEKLY_OFF_DAY,
): number {
  let count = 0;
  for (let t = from.getTime(); t < to.getTime(); t += DAY_MS) {
    if (isWorkingDay(new Date(t), weeklyOff)) count++;
  }
  return count;
}
