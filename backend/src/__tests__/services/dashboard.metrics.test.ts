import { describe, it, expect } from 'vitest';
import {
  completedShort,
  percentText,
  summariseAttendanceDay,
} from '../../services/reports/metrics';
import {
  PLANT_WEEKLY_OFF_DAY,
  PLANT_WEEKLY_OFF_LABEL,
  isWorkingDay,
  parseWeekday,
  plantToday,
  weeklyOffFor,
  weekdayOf,
} from '../../config/plant';

const SATURDAY = 6;
const SUNDAY = 0;
/** n active employees on the plant's weekly off (no own setting) */
const roster = (n: number, own: Record<number, number> = {}) =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, weeklyOffDay: own[i + 1] ?? null }));

describe('completedShort', () => {
  it('flags a completed work order below its target', () => {
    expect(completedShort('COMPLETED', 840, 1000)).toEqual({ short: true, completionPct: 84 });
  });

  it('does not flag full completions or orders still running', () => {
    expect(completedShort('COMPLETED', 1000, 1000).short).toBe(false);
    expect(completedShort('IN_PROGRESS', 200, 1000).short).toBe(false);
    expect(completedShort('COMPLETED', 5, 0)).toEqual({ short: false, completionPct: null });
  });
});

describe('percentText', () => {
  it('returns null instead of a misleading 0.0% when there is no base', () => {
    expect(percentText(0, 0)).toBeNull();
    expect(percentText(45, 50)).toBe('90.0%');
  });
});

describe('the plant calendar', () => {
  it('has Saturday as the weekly off, and Sunday as a working day', () => {
    expect(PLANT_WEEKLY_OFF_DAY).toBe(SATURDAY);
    expect(PLANT_WEEKLY_OFF_LABEL).toBe('Saturday');
    expect(isWorkingDay(new Date('2026-11-14T00:00:00Z'))).toBe(false); // Saturday
    expect(isWorkingDay(new Date('2026-11-15T00:00:00Z'))).toBe(true); // Sunday
  });

  it('reads PLANT_WEEKLY_OFF, and refuses anything that is not a weekday', () => {
    expect(parseWeekday(undefined)).toBe(SATURDAY);
    expect(parseWeekday('')).toBe(SATURDAY);
    expect(parseWeekday('friday')).toBe(5);
    expect(() => parseWeekday('weekend')).toThrow(/weekday name/);
  });

  it("uses an employee's own weekly off, else the plant's", () => {
    expect(weeklyOffFor(null)).toBe(SATURDAY);
    expect(weeklyOffFor(undefined)).toBe(SATURDAY);
    expect(weeklyOffFor(SUNDAY)).toBe(SUNDAY);
  });
});

describe('today is the IST calendar day', () => {
  it('00:30 IST on Saturday is Saturday, although UTC is still Friday', () => {
    const now = new Date('2026-11-13T19:00:00Z'); // Sat 14 Nov 00:30 IST
    expect(now.getUTCDay()).toBe(5);
    const today = plantToday(now);
    expect(today.toISOString()).toBe('2026-11-14T00:00:00.000Z');
    expect(weekdayOf(today)).toBe(SATURDAY);
  });

  it('23:59 IST on Friday is still Friday', () => {
    const today = plantToday(new Date('2026-11-13T18:29:00Z')); // Fri 23:59 IST
    expect(today.toISOString()).toBe('2026-11-13T00:00:00.000Z');
    expect(weekdayOf(today)).toBe(5);
  });

  it('00:00 IST on Sunday is Sunday, a working day', () => {
    const today = plantToday(new Date('2026-11-14T18:30:00Z')); // Sun 00:00 IST
    expect(weekdayOf(today)).toBe(SUNDAY);
    expect(isWorkingDay(today)).toBe(true);
  });

  it('a stored attendance date keeps its own weekday', () => {
    expect(weekdayOf(new Date('2026-11-14T00:00:00.000Z'))).toBe(SATURDAY);
  });
});

describe('weekly offs', () => {
  it('Saturday with no attendance entered is the weekly off, not 0% attendance', () => {
    const day = summariseAttendanceDay({ records: [], roster: roster(3), weekday: SATURDAY });
    expect(day.weekOff).toBe(3);
    expect(day.rate).toBeNull();
    expect(day.nonWorkingDay).toBe(true);
  });

  it('Sunday with no attendance entered is "not entered yet", like any working day', () => {
    const day = summariseAttendanceDay({ records: [], roster: roster(3), weekday: SUNDAY });
    expect(day.weekOff).toBe(0);
    expect(day.recorded).toBe(0);
    expect(day.rate).toBeNull();
    expect(day.nonWorkingDay).toBe(false);
  });

  it('a worker marked Present on Saturday still counts', () => {
    const day = summariseAttendanceDay({
      records: [{ employeeId: 1, status: 'PRESENT' }],
      roster: roster(3),
      weekday: SATURDAY,
    });
    expect(day.present).toBe(1);
    expect(day.weekOff).toBe(2);
    expect(day.rate).toBe('100.0%');
    expect(day.nonWorkingDay).toBe(true);
  });

  it("uses an employee's own weekly off instead of Saturday", () => {
    // Employees 1 and 2 are off on Sundays, so they are due on Saturday
    const own = { 1: SUNDAY, 2: SUNDAY };
    const saturday = summariseAttendanceDay({
      records: [],
      roster: roster(3, own),
      weekday: SATURDAY,
    });
    expect(saturday.weekOff).toBe(1);
    expect(saturday.nonWorkingDay).toBe(false);
    const sunday = summariseAttendanceDay({ records: [], roster: roster(3, own), weekday: SUNDAY });
    expect(sunday.weekOff).toBe(2);
    expect(sunday.nonWorkingDay).toBe(true);
  });

  it('leaves week-off records out of the attendance rate on a working day', () => {
    const day = summariseAttendanceDay({
      records: [
        { employeeId: 1, status: 'PRESENT' },
        { employeeId: 2, status: 'LATE' },
        { employeeId: 3, status: 'ABSENT' },
        { employeeId: 4, status: 'WEEK_OFF' },
      ],
      roster: roster(4),
      weekday: 2,
    });
    expect(day.rate).toBe('66.7%');
    expect(day.weekOff).toBe(1);
    expect(day.nonWorkingDay).toBe(false);
  });
});
