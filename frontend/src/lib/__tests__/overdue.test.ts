import { describe, expect, it } from 'vitest';
import { daysOverdue, overdueFirst, overdueLabel } from '../overdue';

const now = new Date(2026, 10, 1, 15, 0); // 1 Nov 2026, local afternoon

describe('daysOverdue', () => {
  it('counts whole days past the due date for open orders', () => {
    expect(daysOverdue('2026-10-26T00:00:00.000Z', 'PENDING', now)).toBe(6);
    expect(daysOverdue('2026-10-31T00:00:00.000Z', 'IN_TRANSIT', now)).toBe(1);
  });

  it('is 0 when due today or later, without a date, or when closed', () => {
    expect(daysOverdue('2026-11-01T00:00:00.000Z', 'PENDING', now)).toBe(0);
    expect(daysOverdue('2026-11-20T00:00:00.000Z', 'APPROVED', now)).toBe(0);
    expect(daysOverdue(null, 'PENDING', now)).toBe(0);
    expect(daysOverdue('2026-09-15T00:00:00.000Z', 'DELIVERED', now)).toBe(0);
    expect(daysOverdue('2026-09-15T00:00:00.000Z', 'cancelled', now)).toBe(0);
  });
});

describe('overdue display', () => {
  it('labels and sorts the most overdue first', () => {
    expect(overdueLabel(1)).toBe('Overdue by 1 day');
    expect(overdueLabel(6)).toBe('Overdue by 6 days');
    const rows = [{ id: 'a', overdueDays: 0 }, { id: 'b', overdueDays: 6 }, { id: 'c', overdueDays: 2 }];
    expect(overdueFirst(rows).map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });
});
