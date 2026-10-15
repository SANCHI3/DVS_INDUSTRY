import { describe, expect, it } from 'vitest';
import {
  buildSupplierScorecard,
  compositeScore,
  gradeFor,
  scoreSupplier,
  type ScorecardPoRow,
  type ScorecardSupplierRow,
} from '../../analytics/supplierMath';

const NOW = new Date('2026-10-11T00:00:00Z');
const day = (n: number) => new Date(Date.UTC(2026, 6, 1) + n * 86_400_000);

const supplier = (over: Partial<ScorecardSupplierRow> = {}): ScorecardSupplierRow => ({
  id: 1,
  name: 'Acme Steel',
  code: 'SUP-1',
  rating: 4,
  leadTimeDays: 7,
  isActive: true,
  ...over,
});

/** Delivered PO ordered on `start`, promised in 7 days, delivered `lead` days later. */
const delivered = (start: number, lead: number, supplierId = 1): ScorecardPoRow => ({
  supplierId,
  status: 'DELIVERED',
  orderDate: day(start),
  expectedDelivery: day(start + 7),
  actualDelivery: day(start + lead),
  totalCost: 1000,
});

describe('supplier scorecard', () => {
  it('measures on-time rate with a one-day grace period', () => {
    const s = scoreSupplier(
      supplier(),
      [delivered(0, 7), delivered(10, 8), delivered(20, 12)],
      NOW,
    );
    expect(s.onTimeRate).toBeCloseTo(66.7, 1); // 7 and 8 days are on time, 12 is 5 days late
    expect(s.averageDelayDays).toBe(5);
  });

  it('reports lead-time drift and variability', () => {
    const s = scoreSupplier(supplier(), [delivered(0, 9), delivered(10, 9), delivered(20, 9)], NOW);
    expect(s.leadTimeMeanDays).toBe(9);
    expect(s.leadTimeDriftDays).toBe(2);
    expect(s.leadTimeCv).toBe(0);
  });

  it('counts cancellations against fulfilment and flags overdue open POs', () => {
    const pos: ScorecardPoRow[] = [
      delivered(0, 7),
      { ...delivered(5, 7), status: 'CANCELLED', actualDelivery: null },
      {
        ...delivered(200, 7),
        status: 'CONFIRMED',
        actualDelivery: null,
        expectedDelivery: day(90),
      },
    ];
    const s = scoreSupplier(supplier(), pos, NOW);
    expect(s.fulfilmentRate).toBe(50);
    expect(s.overdueOpen).toBe(1);
    expect(s.spend).toBe(2000); // cancelled PO excluded
  });

  it('does not grade a supplier without enough deliveries', () => {
    const s = scoreSupplier(supplier(), [delivered(0, 7)], NOW);
    expect(s.score).not.toBeNull();
    expect(s.grade).toBeNull();
    expect(s.enoughHistory).toBe(false);
  });

  it('rescales weights when components are missing', () => {
    expect(
      compositeScore([
        { value: 80, weight: 0.4 },
        { value: null, weight: 0.6 },
      ]),
    ).toBe(80);
    expect(compositeScore([{ value: null, weight: 1 }])).toBeNull();
  });

  it('maps scores to grades', () => {
    expect([gradeFor(90), gradeFor(75), gradeFor(60), gradeFor(40)]).toEqual(['A', 'B', 'C', 'D']);
  });

  it('ranks suppliers and produces insights', () => {
    const reliable = [delivered(0, 7), delivered(10, 7), delivered(20, 6), delivered(30, 7)];
    const late = [2, 3, 4, 5].map((k) => delivered(k * 10, 14, 2));
    const card = buildSupplierScorecard({
      suppliers: [supplier(), supplier({ id: 2, name: 'Slow Metals', code: 'SUP-2', rating: 3 })],
      purchaseOrders: [...reliable, ...late],
      historyDays: 180,
      now: NOW,
    });
    expect(card.suppliers.map((s) => s.name)).toEqual(['Acme Steel', 'Slow Metals']);
    expect(card.suppliers[0]?.grade).toBe('A');
    expect(card.summary.overallOnTimeRate).toBe(50);
    const titles = card.insights.map((i) => i.title).join(' | ');
    expect(titles).toContain('Slow Metals delivers on time only 0%');
    expect(titles).toContain('real lead time 14 days vs 7 promised');
    expect(card.insights.at(-1)?.severity).toBe('positive');
  });
});
