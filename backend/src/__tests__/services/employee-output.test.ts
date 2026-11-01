/**
 * Efficiency maths, and proof that per-employee output never reaches the
 * company (work-order) production KPIs.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/prismaClient', () => {
  const model = () => ({
    count: vi.fn().mockResolvedValue(0),
    groupBy: vi.fn().mockResolvedValue([]),
    aggregate: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
  });
  return {
    prisma: {
      workOrder: model(),
      workOrderOutput: model(),
      employeeDailyOutput: model(),
      $transaction: vi.fn((fns: unknown[]) => Promise.all(fns as Promise<unknown>[])),
    },
  };
});

import { prisma } from '../../lib/prismaClient';
import { calculateEfficiency } from '../../utils/efficiency';

const { Prisma } = await import('@prisma/client');
const { ProductionRepository } = await import('../../repositories/production.repository');

describe('calculateEfficiency', () => {
  it('is produced / expected × 100, to one decimal', () => {
    expect(calculateEfficiency(200, 180)).toBe(90);
    expect(calculateEfficiency(3, 2)).toBe(66.7);
    expect(calculateEfficiency(100, 125)).toBe(125);
    expect(calculateEfficiency(50, 0)).toBe(0);
  });

  it.each([
    [0, 10],
    [null, 10],
    [undefined, 10],
    [10, null],
    [-5, 10],
    [Number.NaN, 10],
    [Number.POSITIVE_INFINITY, 10],
  ])('is null (shown as N/A) for expected=%s produced=%s', (expected, produced) => {
    expect(calculateEfficiency(expected, produced)).toBeNull();
  });
});

describe('company production KPIs', () => {
  it('come only from work-order output, never from employee daily output', async () => {
    const workOrder = prisma.workOrder as unknown as Record<string, ReturnType<typeof vi.fn>>;
    const woOutput = prisma.workOrderOutput as unknown as Record<string, ReturnType<typeof vi.fn>>;
    const empOutput = prisma.employeeDailyOutput as unknown as Record<
      string,
      ReturnType<typeof vi.fn>
    >;

    woOutput['aggregate']!.mockResolvedValue({
      _sum: {
        goodQty: new Prisma.Decimal(500),
        rejectedQty: new Prisma.Decimal(20),
        scrapQty: new Prisma.Decimal(5),
      },
    });
    // One order closed this month at 840 of 1000: completed short
    workOrder['findMany']!.mockResolvedValue([
      {
        status: 'COMPLETED',
        targetQuantity: new Prisma.Decimal(1000),
        outputs: [{ goodQty: new Prisma.Decimal(840) }],
      },
    ]);

    const kpis = await new ProductionRepository().getKPIs();

    expect(kpis.totalProducedQty).toBe('500.000');
    expect(kpis.overallCompletionRate).toBe('84.0%');
    expect(kpis.completedThisMonth).toBe(1);
    expect(kpis.completedShortThisMonth).toBe(1);
    expect(kpis.rejectionRate).toBe('3.8%');
    // Output is counted by the date it was recorded, not when the order was created
    expect(woOutput['aggregate']).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ recordedAt: expect.anything() }),
      }),
    );
    for (const fn of Object.values(empOutput)) expect(fn).not.toHaveBeenCalled();
  });
});

describe('production KPIs early in the month', () => {
  it('report "nothing yet" (null) rather than 0.0% when no output is recorded', async () => {
    const workOrder = prisma.workOrder as unknown as Record<string, ReturnType<typeof vi.fn>>;
    const woOutput = prisma.workOrderOutput as unknown as Record<string, ReturnType<typeof vi.fn>>;
    workOrder['findMany']!.mockResolvedValue([]);
    woOutput['aggregate']!.mockResolvedValue({
      _sum: { goodQty: null, rejectedQty: null, scrapQty: null },
      _count: { _all: 0 },
    });

    const kpis = await new ProductionRepository().getKPIs();

    expect(kpis.overallCompletionRate).toBeNull();
    expect(kpis.rejectionRate).toBeNull();
    expect(kpis.outputRecords).toBe(0);
  });
});
