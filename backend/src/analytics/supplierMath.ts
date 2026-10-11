/**
 * Supplier scorecard — pure functions over purchase-order history.
 *
 * Per supplier:
 *  - On-time delivery rate: delivered POs with actualDelivery on or before
 *    expectedDelivery (+1 day grace), over delivered POs that had a promised date.
 *  - Lead time: mean and coefficient of variation (CV) of actual lead time
 *    (orderDate → actualDelivery). A low CV means the supplier is predictable,
 *    which directly lowers the safety stock the plant must hold.
 *  - Lead-time drift: actual mean lead time vs the promised leadTimeDays.
 *  - Fulfilment: delivered / (delivered + cancelled) — how often an order that
 *    reached a final state was actually delivered.
 *  - Composite score 0-100 = 40% on-time + 25% lead-time consistency
 *    + 20% fulfilment + 15% buyer rating; grade A ≥ 85, B ≥ 70, C ≥ 55, else D.
 *    Missing components are left out and the remaining weights rescaled, so a
 *    new supplier is not punished for having no history.
 */
import type { Insight, SupplierScore, SupplierScorecard } from '../interfaces/analytics.interface';

const DAY_MS = 86_400_000;
const GRACE_DAYS = 1;
const MIN_DELIVERIES_FOR_GRADE = 3;

export interface ScorecardSupplierRow {
  id: number;
  name: string;
  code: string;
  rating: number | null; // 0-5
  leadTimeDays: number | null; // promised
  isActive: boolean;
}

export interface ScorecardPoRow {
  supplierId: number;
  status: 'PENDING' | 'CONFIRMED' | 'IN_TRANSIT' | 'DELIVERED' | 'CANCELLED';
  orderDate: Date;
  expectedDelivery: Date | null;
  actualDelivery: Date | null;
  totalCost: number | null;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function std(values: number[]): number | null {
  const m = mean(values);
  if (m === null || values.length < 2) return null;
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1));
}

const round = (v: number | null, digits = 1): number | null =>
  v === null ? null : Math.round(v * 10 ** digits) / 10 ** digits;

export function gradeFor(score: number): 'A' | 'B' | 'C' | 'D' {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  return 'D';
}

/** Weighted mean of the components that exist, weights rescaled to sum to 1. */
export function compositeScore(
  parts: Array<{ value: number | null; weight: number }>,
): number | null {
  const present = parts.filter((p) => p.value !== null);
  const total = present.reduce((s, p) => s + p.weight, 0);
  if (total === 0) return null;
  return present.reduce((s, p) => s + (p.value as number) * p.weight, 0) / total;
}

export function scoreSupplier(
  supplier: ScorecardSupplierRow,
  pos: ScorecardPoRow[],
  now: Date,
): SupplierScore {
  const delivered = pos.filter((p) => p.status === 'DELIVERED' && p.actualDelivery !== null);
  const cancelled = pos.filter((p) => p.status === 'CANCELLED');
  const open = pos.filter((p) => p.status !== 'DELIVERED' && p.status !== 'CANCELLED');

  const withPromise = delivered.filter((p) => p.expectedDelivery !== null);
  const delays = withPromise.map(
    (p) => ((p.actualDelivery as Date).getTime() - (p.expectedDelivery as Date).getTime()) / DAY_MS,
  );
  const onTime = delays.filter((d) => d <= GRACE_DAYS).length;
  const lateDelays = delays.filter((d) => d > GRACE_DAYS);
  const onTimeRate = withPromise.length ? onTime / withPromise.length : null;

  const leadTimes = delivered.map(
    (p) => ((p.actualDelivery as Date).getTime() - p.orderDate.getTime()) / DAY_MS,
  );
  const leadMean = mean(leadTimes);
  const leadStd = std(leadTimes);
  const leadCv = leadMean !== null && leadStd !== null && leadMean > 0 ? leadStd / leadMean : null;

  const finished = delivered.length + cancelled.length;
  const fulfilmentRate = finished ? delivered.length / finished : null;

  const overdueOpen = open.filter(
    (p) =>
      p.expectedDelivery !== null &&
      p.expectedDelivery.getTime() + GRACE_DAYS * DAY_MS < now.getTime(),
  ).length;

  // Consistency: CV 0 → 100, CV ≥ 0.6 → 0
  const consistency = leadCv === null ? null : Math.max(0, 1 - leadCv / 0.6) * 100;
  const score = compositeScore([
    { value: onTimeRate === null ? null : onTimeRate * 100, weight: 0.4 },
    { value: consistency, weight: 0.25 },
    { value: fulfilmentRate === null ? null : fulfilmentRate * 100, weight: 0.2 },
    { value: supplier.rating === null ? null : (supplier.rating / 5) * 100, weight: 0.15 },
  ]);
  const enoughHistory = delivered.length >= MIN_DELIVERIES_FOR_GRADE;

  return {
    supplierId: supplier.id,
    name: supplier.name,
    code: supplier.code,
    purchaseOrders: pos.length,
    delivered: delivered.length,
    cancelled: cancelled.length,
    open: open.length,
    overdueOpen,
    spend:
      round(
        pos.reduce((s, p) => s + (p.status === 'CANCELLED' ? 0 : (p.totalCost ?? 0)), 0),
        2,
      ) ?? 0,
    onTimeRate: round(onTimeRate === null ? null : onTimeRate * 100),
    averageDelayDays: round(mean(lateDelays)),
    leadTimeMeanDays: round(leadMean),
    leadTimeCv: round(leadCv, 2),
    promisedLeadTimeDays: supplier.leadTimeDays,
    leadTimeDriftDays:
      leadMean !== null && supplier.leadTimeDays !== null
        ? round(leadMean - supplier.leadTimeDays)
        : null,
    fulfilmentRate: round(fulfilmentRate === null ? null : fulfilmentRate * 100),
    rating: supplier.rating,
    score: round(score),
    grade: score !== null && enoughHistory ? gradeFor(score) : null,
    enoughHistory,
  };
}

function insightsFor(scores: SupplierScore[]): Insight[] {
  const insights: Insight[] = [];
  for (const s of scores) {
    if (s.overdueOpen > 0) {
      insights.push({
        severity: 'critical',
        title: `${s.name}: ${s.overdueOpen} purchase order(s) overdue`,
        detail:
          'Expected delivery date has passed. Chase the supplier and check stock cover for the affected materials.',
      });
    }
    if (s.enoughHistory && s.onTimeRate !== null && s.onTimeRate < 70) {
      insights.push({
        severity: 'warning',
        title: `${s.name} delivers on time only ${s.onTimeRate}% of the time`,
        detail:
          `Late deliveries average ${s.averageDelayDays ?? 0} days. ` +
          'Add this delay to its lead time when planning reorders, or qualify a second source.',
      });
    }
    if (s.leadTimeDriftDays !== null && s.leadTimeDriftDays >= 2) {
      insights.push({
        severity: 'warning',
        title: `${s.name}: real lead time ${s.leadTimeMeanDays} days vs ${s.promisedLeadTimeDays} promised`,
        detail:
          'Update the supplier lead time so reorder points and safety stock are calculated correctly.',
      });
    }
    if (s.enoughHistory && s.leadTimeCv !== null && s.leadTimeCv > 0.4) {
      insights.push({
        severity: 'info',
        title: `${s.name} has unpredictable lead times (CV ${s.leadTimeCv})`,
        detail:
          'High variability forces extra safety stock for every material sourced from this supplier.',
      });
    }
  }
  const best = scores.filter((s) => s.grade === 'A');
  if (best.length) {
    insights.push({
      severity: 'positive',
      title: `${best.map((s) => s.name).join(', ')} rated A`,
      detail: 'Consistently on time with predictable lead times. Preferred for critical materials.',
    });
  }
  const order = { critical: 0, warning: 1, info: 2, positive: 3 };
  return insights.sort((a, b) => order[a.severity] - order[b.severity]);
}

export function buildSupplierScorecard(input: {
  suppliers: ScorecardSupplierRow[];
  purchaseOrders: ScorecardPoRow[];
  historyDays: number;
  now: Date;
}): SupplierScorecard {
  const bySupplier = new Map<number, ScorecardPoRow[]>();
  for (const po of input.purchaseOrders) {
    const list = bySupplier.get(po.supplierId) ?? [];
    list.push(po);
    bySupplier.set(po.supplierId, list);
  }
  const suppliers = input.suppliers
    .filter((s) => s.isActive || bySupplier.has(s.id))
    .map((s) => scoreSupplier(s, bySupplier.get(s.id) ?? [], input.now))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  const delivered = suppliers.reduce((s, x) => s + x.delivered, 0);
  const weightedOnTime = suppliers.reduce(
    (s, x) => s + (x.onTimeRate ?? 0) * (x.onTimeRate === null ? 0 : x.delivered),
    0,
  );
  const deliveredWithRate = suppliers.reduce(
    (s, x) => s + (x.onTimeRate === null ? 0 : x.delivered),
    0,
  );

  return {
    generatedAt: input.now.toISOString(),
    historyDays: input.historyDays,
    summary: {
      suppliers: suppliers.length,
      purchaseOrders: input.purchaseOrders.length,
      delivered,
      overallOnTimeRate: deliveredWithRate ? round(weightedOnTime / deliveredWithRate) : null,
      overdueOpen: suppliers.reduce((s, x) => s + x.overdueOpen, 0),
      spend:
        round(
          suppliers.reduce((s, x) => s + x.spend, 0),
          2,
        ) ?? 0,
    },
    suppliers,
    insights: insightsFor(suppliers),
  };
}
