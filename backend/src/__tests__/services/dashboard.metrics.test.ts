import { describe, it, expect } from 'vitest';
import {
  completedShort,
  percentText,
  summariseAttendanceDay,
  usualWeekOffDays,
} from '../../services/reports/metrics';

const sunday = (weeksAgo: number) => new Date(Date.UTC(2026, 10, 1 - 7 * weeksAgo)); // 1 Nov 2026 is a Sunday

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

describe('weekly offs', () => {
  it("learns each employee's usual off day from their records", () => {
    const usual = usualWeekOffDays([
      { employeeId: 1, date: sunday(1) },
      { employeeId: 1, date: sunday(2) },
      { employeeId: 2, date: sunday(1) }, // only once: not enough to call it usual
    ]);
    expect(usual.get(1)).toBe(0);
    expect(usual.has(2)).toBe(false);
  });

  it('treats a Sunday with no attendance as a weekly off, not 0% attendance', () => {
    const day = summariseAttendanceDay({
      records: [],
      activeEmployeeIds: [1, 2, 3],
      usualOff: new Map([
        [1, 0],
        [2, 0],
        [3, 0],
      ]),
      weekday: 0,
    });
    expect(day.weekOff).toBe(3);
    expect(day.rate).toBeNull();
    expect(day.nonWorkingDay).toBe(true);
  });

  it('leaves week-off records out of the attendance rate on a working day', () => {
    const day = summariseAttendanceDay({
      records: [
        { employeeId: 1, status: 'PRESENT' },
        { employeeId: 2, status: 'LATE' },
        { employeeId: 3, status: 'ABSENT' },
        { employeeId: 4, status: 'WEEK_OFF' },
      ],
      activeEmployeeIds: [1, 2, 3, 4],
      usualOff: new Map(),
      weekday: 2,
    });
    expect(day.rate).toBe('66.7%');
    expect(day.weekOff).toBe(1);
    expect(day.nonWorkingDay).toBe(false);
  });

  it('says nothing about a working day before attendance is entered', () => {
    const day = summariseAttendanceDay({
      records: [],
      activeEmployeeIds: [1, 2],
      usualOff: new Map([[1, 0]]),
      weekday: 1,
    });
    expect(day.rate).toBeNull();
    expect(day.nonWorkingDay).toBe(false);
  });
});
