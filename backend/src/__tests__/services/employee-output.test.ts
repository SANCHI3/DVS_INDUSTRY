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
    workOrder['aggregate']!.mockResolvedValue({
      _sum: { targetQuantity: new Prisma.Decimal(1000) },
    });

    const kpis = await new ProductionRepository().getKPIs();

    expect(kpis.totalProducedQty).toBe('500.000');
    expect(kpis.overallCompletionRate).toBe('50.0%');
    for (const fn of Object.values(empOutput)) expect(fn).not.toHaveBeenCalled();
  });
});
