import { describe, expect, it } from 'vitest';
import { NO_SCRAP_RECOMMENDATIONS, summariseScrap } from '../scrapAnalytics';
import type { ScrapRecordDto } from '../services/inventory.service';

const now = new Date(2026, 10, 5, 12, 0); // 5 Nov 2026
const rec = (day: number, qty: number, dept: string | null, material = 'MS Sheet 2mm', reason: string | null = null): ScrapRecordDto => ({
  id: day * 100 + qty, materialId: 1, materialName: material, quantity: String(qty), unit: 'kg',
  departmentName: dept, employeeName: null, reason, recoveryValue: null,
  recordedAt: new Date(2026, 10, day, 10, 0).toISOString(),
});

describe('summariseScrap', () => {
  it('gives the empty-state recommendation when nothing is recorded', () => {
    const s = summariseScrap([], now);
    expect(s.recommendations).toEqual([NO_SCRAP_RECOMMENDATIONS]);
    expect(s.worstDepartment).toBeNull();
    expect(s.trend).toHaveLength(7);
    expect(s.trend.every((d) => d.qty === 0)).toBe(true);
  });

  it('totals this month by department and finds the worst one', () => {
    const s = summariseScrap([
      rec(2, 30, 'Press Shop', 'MS Sheet 2mm', 'Edge burr'),
      rec(3, 10, 'Welding', 'CR Coil'),
      rec(4, 20, 'Press Shop', 'MS Sheet 2mm', 'Edge burr'),
      { ...rec(1, 99, 'Welding'), recordedAt: new Date(2026, 9, 28).toISOString() }, // last month
    ], now);
    expect(s.monthTotal).toBe(60);
    expect(s.byDepartment).toEqual([{ dept: 'Press Shop', qty: 50 }, { dept: 'Welding', qty: 10 }]);
    expect(s.worstDepartment).toEqual({ dept: 'Press Shop', qty: 50, share: 83 });
    expect(s.recommendations[0]).toBe("Press Shop recorded 83% of this month's scrap (50 kg). Review its process first.");
    expect(s.recommendations).toContain('MS Sheet 2mm is the most scrapped material this month (50 kg).');
    expect(s.recommendations).toContain('Most scrap this month was recorded as "Edge burr" (50 kg).');
  });

  it('plots the last 7 days, today last', () => {
    const s = summariseScrap([rec(5, 12, 'Welding'), rec(4, 3, 'Welding')], now);
    expect(s.trend.map((d) => d.qty)).toEqual([0, 0, 0, 0, 0, 3, 12]);
  });
});
