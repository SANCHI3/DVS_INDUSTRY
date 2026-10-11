/**
 * Smart Analytics unit tests — forecasting, inventory policy, anomaly detection,
 * SPC and the plant health index. Pure functions: no database needed.
 */
import { describe, it, expect } from 'vitest';
import { backtest, capOutliers, forecastDemand, toDailySeries } from '../../analytics/forecasting';
import {
  abcClassify,
  economicOrderQuantity,
  modifiedZScores,
  normalQuantile,
  safetyStock,
  stockoutDay,
  xyzClassify,
} from '../../analytics/inventoryMath';
import { oeeProxy, pChart, pearson, safetyScore } from '../../analytics/productionMath';
import {
  buildInventoryIntelligence,
  buildPlantHealth,
  buildProductionPerformance,
  leadTimeFor,
  parseQuantity,
} from '../../analytics/engine';
import type { MaterialRow, TransactionRow, WorkOrderRow } from '../../analytics/engine';

// Deterministic pseudo-random numbers so tests never flake
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

const NOW = new Date('2026-10-10T12:00:00Z');
const DAY = 86_400_000;
const PARAMS = {
  historyDays: 90,
  horizonDays: 30,
  serviceLevel: 0.95,
  defaultLeadTimeDays: 7,
  orderCost: 500,
  holdingRate: 0.2,
};

describe('forecasting', () => {
  it('buckets transactions into UTC days', () => {
    const series = toDailySeries(
      [
        { date: new Date('2026-01-02T10:00:00Z'), quantity: 5 },
        { date: new Date('2026-01-02T15:00:00Z'), quantity: 2 },
        { date: new Date('2026-01-04T00:00:00Z'), quantity: 1 },
      ],
      new Date('2026-01-01T00:00:00Z'),
      5,
    );
    expect(series).toEqual([0, 7, 0, 1, 0]);
  });

  it('uses Holt for regular trending demand and tracks the trend', () => {
    const r = rng(1);
    const series = Array.from({ length: 90 }, (_, i) => 20 + 0.2 * i + (r() - 0.5) * 6);
    const fc = forecastDemand(series, 7);
    expect(fc.method).toBe('HOLT');
    const first = fc.forecast[0] ?? 0;
    expect(first).toBeGreaterThan(34);
    expect(first).toBeLessThan(42);
    expect(backtest(series).totalError ?? 1).toBeLessThan(0.15);
  });

  it('uses Croston-SBA for intermittent demand and recovers the mean rate', () => {
    const r = rng(2);
    const series = Array.from({ length: 120 }, () => (r() < 0.2 ? 30 + r() * 20 : 0));
    const trueRate = series.reduce((a, b) => a + b, 0) / series.length;
    const fc = forecastDemand(series, 7);
    expect(fc.method).toBe('CROSTON_SBA');
    expect(fc.adi).toBeGreaterThan(1.32);
    expect(Math.abs((fc.forecast[0] ?? 0) - trueRate) / trueRate).toBeLessThan(0.3);
  });

  it('caps a single abnormal spike so it does not bend the forecast', () => {
    const series = Array.from({ length: 60 }, (_, i) => 40 + (i % 3));
    series[55] = 600;
    expect(Math.max(...capOutliers(series))).toBeLessThan(100);
    const fc = forecastDemand(series, 5);
    expect(fc.forecast[0] ?? 0).toBeLessThan(55);
  });

  it('reports insufficient data instead of guessing', () => {
    expect(forecastDemand([0, 0, 5, 0, 0, 0, 0, 0, 0, 0], 3).method).toBe('INSUFFICIENT_DATA');
  });
});

describe('inventory maths', () => {
  it('inverse normal matches statistical tables', () => {
    expect(normalQuantile(0.95)).toBeCloseTo(1.6449, 3);
    expect(normalQuantile(0.99)).toBeCloseTo(2.3263, 3);
    expect(normalQuantile(0.5)).toBeCloseTo(0, 6);
  });

  it('computes safety stock, EOQ and stock-out day', () => {
    expect(safetyStock(5, 9, 0.95)).toBeCloseTo(1.6449 * 5 * 3, 1);
    expect(economicOrderQuantity(7300, 500, 20)).toBeCloseTo(Math.sqrt((2 * 7300 * 500) / 20), 6);
    expect(stockoutDay(100, [30, 30, 30, 30])).toBe(3);
    expect(stockoutDay(1000, [30, 30])).toBeNull();
  });

  it('classifies ABC by Pareto value and XYZ by variability', () => {
    const items = [
      { id: 'a', value: 800 },
      { id: 'b', value: 100 },
      { id: 'c', value: 60 },
      { id: 'd', value: 30 },
      { id: 'e', value: 10 },
    ];
    const abc = abcClassify(items);
    expect(items.map((i) => abc.get(i)).join('')).toBe('ABBCC');
    expect(xyzClassify(Array.from({ length: 56 }, () => 10)).cls).toBe('X');
    expect(xyzClassify(Array.from({ length: 56 }, (_, i) => (i % 14 === 0 ? 100 : 0))).cls).toBe('Z');
  });

  it('robust z-score flags the spike and nothing else', () => {
    const z = modifiedZScores([10, 11, 9, 10, 12, 10, 60]);
    expect(z.filter((v) => v > 3.5)).toHaveLength(1);
    expect(z[6] ?? 0).toBeGreaterThan(3.5);
  });
});

describe('production maths', () => {
  it('computes the OEE-style index', () => {
    const r = oeeProxy({ good: 900, rejected: 50, scrap: 50, target: 1000, completedWithDueDate: 4, completedOnTime: 3 });
    expect(r.quality).toBeCloseTo(0.9);
    expect(r.attainment).toBeCloseTo(0.9);
    expect(r.schedule).toBeCloseTo(0.75);
    expect(r.oee).toBeCloseTo(0.6075);
  });

  it('p-chart flags a bad day and a sustained drift', () => {
    const spike = pChart(Array.from({ length: 20 }, (_, i) => ({ date: `d${i}`, inspected: 100, defective: i === 5 ? 25 : 4 })));
    expect(spike.outOfControlDays).toBe(1);
    const drift = pChart(Array.from({ length: 20 }, (_, i) => ({ date: `d${i}`, inspected: 100, defective: i >= 11 ? 7 : 3 })));
    expect(drift.outOfControlDays).toBe(0);
    expect(drift.shiftDetected).toBe(true);
  });

  it('pearson and safety score behave', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1);
    expect(pearson([1, 2], [2, 4])).toBeNull();
    expect(safetyScore([])).toBe(100);
    expect(safetyScore([{ severity: 'CRITICAL' }])).toBeLessThan(safetyScore([{ severity: 'LOW' }]));
  });
});

describe('engine', () => {
  const r = rng(7);
  const materials: MaterialRow[] = [
    { id: 1, code: 'STL', name: 'Steel Sheet', unit: 'kg', category: null, currentStock: 300, minStockLevel: 100, maxStockLevel: null, costPerUnit: 72 },
    { id: 2, code: 'CU', name: 'Copper Wire', unit: 'm', category: null, currentStock: 9000, minStockLevel: 300, maxStockLevel: 3000, costPerUnit: 15 },
    { id: 3, code: 'GSK', name: 'Gasket', unit: 'pcs', category: null, currentStock: 500, minStockLevel: 0, maxStockLevel: null, costPerUnit: 22 },
  ];
  const transactions: TransactionRow[] = [];
  let id = 1;
  for (let d = 89; d >= 0; d--) {
    const date = new Date(NOW.getTime() - d * DAY);
    transactions.push({ id: id++, materialId: 1, type: 'OUT', quantity: 40 * (0.8 + 0.4 * r()), createdAt: date, performedByName: 'A', departmentName: 'Fab' });
    transactions.push({ id: id++, materialId: 2, type: 'OUT', quantity: 100 * (0.8 + 0.4 * r()), createdAt: date, performedByName: 'A', departmentName: 'Fab' });
  }
  transactions.push({ id: id++, materialId: 1, type: 'ADJUSTMENT', quantity: -400, createdAt: new Date(NOW.getTime() - 2 * DAY), performedByName: 'Night', departmentName: 'Stores' });

  const intel = buildInventoryIntelligence({
    materials,
    transactions,
    suppliers: [{ leadTimeDays: 12, materials: 'Steel Sheet, Aluminium Bar' }],
    openPurchaseOrders: [{ material: 'copper wire', quantity: '1,000 m' }],
    params: PARAMS,
    now: NOW,
  });
  const byName = (n: string) => intel.materials.find((m) => m.name === n);

  it('parses PO quantities and supplier lead times', () => {
    expect(parseQuantity('1,200.5 kg')).toBe(1200.5);
    expect(leadTimeFor('Steel Sheet', [{ leadTimeDays: 12, materials: 'Steel Sheet' }])).toBe(12);
    expect(leadTimeFor('Bolt', [{ leadTimeDays: 12, materials: 'Steel Sheet' }])).toBeNull();
  });

  it('flags a material that will run out within its lead time as CRITICAL', () => {
    const steel = byName('Steel Sheet');
    expect(steel?.status).toBe('CRITICAL');
    expect(steel?.leadTimeDays).toBe(12);
    expect(steel?.leadTimeSource).toBe('supplier');
    expect(steel?.suggestedOrderQty ?? 0).toBeGreaterThan(0);
    expect(steel?.predictedStockoutDate).not.toBeNull();
  });

  it('flags overstock, counts open POs and handles items without demand', () => {
    expect(byName('Copper Wire')?.status).toBe('OVERSTOCK');
    expect(byName('Copper Wire')?.onOrder).toBe(1000);
    expect(byName('Gasket')?.status).toBe('NO_DEMAND');
    expect(intel.summary.excessStockValue).toBeGreaterThan(0);
  });

  it('detects the large negative stock adjustment as an anomaly', () => {
    expect(intel.anomalies[0]?.type).toBe('ADJUSTMENT');
    expect(intel.anomalies[0]?.materialName).toBe('Steel Sheet');
    expect(intel.insights.some((i) => i.title.includes('unusual stock movement'))).toBe(true);
  });

  it('builds production performance with department ranking and SPC', () => {
    const wos: WorkOrderRow[] = ['A', 'B'].flatMap((dept, k) =>
      Array.from({ length: 6 }, (_, i) => {
        const start = NOW.getTime() - (40 - i * 5) * DAY;
        return {
          id: k * 10 + i,
          status: 'COMPLETED',
          departmentName: dept,
          targetQuantity: 100,
          scheduledEnd: new Date(start + 3 * DAY),
          actualEnd: new Date(start + (dept === 'A' ? 2 : 5) * DAY),
          updatedAt: new Date(start + 5 * DAY),
          outputs: [{ goodQty: 95, rejectedQty: dept === 'A' ? 2 : 8, scrapQty: 1, recordedAt: new Date(start + DAY) }],
        };
      }),
    );
    const perf = buildProductionPerformance({ workOrders: wos, historyDays: 90, now: NOW });
    expect(perf.departments[0]?.department).toBe('A');
    expect(perf.departments[1]?.schedule).toBe(0);
    expect(perf.overall.workOrders).toBe(12);
    expect(perf.qualityControl.points.length).toBeGreaterThan(0);

    const health = buildPlantHealth({
      inventory: intel,
      production: perf,
      incidents: [{ type: 'FALL', severity: 'HIGH', departmentName: 'B', occurredAt: new Date(NOW.getTime() - 3 * DAY) }],
      attendance: [{ status: 'PRESENT' }, { status: 'LATE' }, { status: 'ABSENT' }],
      now: NOW,
    });
    expect(health.score).toBeGreaterThan(0);
    expect(health.score).toBeLessThanOrEqual(100);
    expect(['A', 'B', 'C', 'D']).toContain(health.grade);
    expect(health.components.map((c) => c.key)).toEqual(['inventory', 'production', 'quality', 'safety', 'workforce']);
  });
});
