import { describe, expect, it } from 'vitest';
import { findWeeklyOffFixes, type DemoAttendanceRow } from '../../scripts/fix-demo-weekly-off';
import { systemPrompt } from '../../assistant/prompt';
import { plantDateText } from '../../assistant/assistant.service';
import { createEmployeeSchema, updateEmployeeSchema } from '../../validators/employee.validator';

const row = (id: number, date: string, status: string): DemoAttendanceRow => ({
  id,
  employeeId: 1,
  employeeCode: 'DEMO-EMP-001',
  date: new Date(`${date}T00:00:00.000Z`),
  status,
});

describe('fixing demo rows seeded with Sunday week-offs', () => {
  const now = new Date('2026-11-17T10:00:00Z'); // Tuesday; the seed covers 11 to 17 Nov
  const rows = [
    row(1, '2026-11-01', 'WEEK_OFF'), // old Sunday week-off
    row(2, '2026-11-15', 'WEEK_OFF'), // Sunday week-off in the demo week
    row(3, '2026-11-14', 'PRESENT'), // worked on Saturday in the demo week
    row(4, '2026-11-07', 'PRESENT'), // an older Saturday: left as history
    row(5, '2026-11-16', 'PRESENT'), // Monday: fine
    row(6, '2026-11-14', 'WEEK_OFF'), // already right
  ];

  it('lists Sunday week-offs and Saturdays worked in the demo week, nothing else', () => {
    const fix = findWeeklyOffFixes(rows, now);
    expect(fix.sundayWeekOffs.map((r) => r.id)).toEqual([1, 2]);
    expect(fix.weeklyOffWorked.map((r) => r.id)).toEqual([3]);
  });

  it('finds nothing to fix in demo data that already follows the plant calendar', () => {
    expect(findWeeklyOffFixes([row(6, '2026-11-14', 'WEEK_OFF')], now)).toEqual({
      sundayWeekOffs: [],
      weeklyOffWorked: [],
    });
  });
});

describe('Ask DVS and the weekly off', () => {
  it('is told the weekly off is Saturday and Sunday is a working day', () => {
    const prompt = systemPrompt('Saturday 2026-11-14', 'HR');
    expect(prompt).toMatch(/weekly off is Saturday/);
    expect(prompt).toMatch(/Sunday included, is a working day/);
    expect(prompt).toMatch(/answer Saturday/);
  });

  it('gets the IST date and weekday, even just after midnight', () => {
    expect(plantDateText(new Date('2026-11-13T19:00:00Z'))).toBe('Saturday 2026-11-14');
  });
});

describe("an employee's own weekly off", () => {
  const base = {
    employeeCode: 'E-1',
    firstName: 'Asha',
    joiningDate: '2026-01-05',
    designation: 'Operator',
  };

  it('is optional and empty by default (the plant weekly off)', () => {
    expect(createEmployeeSchema.parse(base).weeklyOffDay).toBeUndefined();
    expect(createEmployeeSchema.parse({ ...base, weeklyOffDay: null }).weeklyOffDay).toBeNull();
  });

  it('takes a weekday from 0 (Sunday) to 6 (Saturday), and can be cleared', () => {
    expect(createEmployeeSchema.parse({ ...base, weeklyOffDay: 0 }).weeklyOffDay).toBe(0);
    expect(updateEmployeeSchema.parse({ weeklyOffDay: null }).weeklyOffDay).toBeNull();
    expect(createEmployeeSchema.safeParse({ ...base, weeklyOffDay: 7 }).success).toBe(false);
    expect(createEmployeeSchema.safeParse({ ...base, weeklyOffDay: 'SAT' }).success).toBe(false);
  });
});
