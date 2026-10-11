/**
 * Smart Analytics engine — pure functions over plain data (no Prisma, no I/O).
 *
 * The service layer (services/analytics.service.ts) loads rows from PostgreSQL,
 * converts Decimals to numbers and calls these builders. Keeping the logic pure
 * makes every number on the Smart Analytics page reproducible in a unit test.
 */
import type {
  AnalyticsQuery,
  DepartmentPerformance,
  Insight,
  InventoryIntelligence,
  MaterialForecast,
  MaterialIntelligence,
  PlantHealth,
  PlantHealthComponent,
  ProductionPerformance,
  StockMovementAnomaly,
  StockStatus,
} from '../interfaces/analytics.interface';
import { backtest, forecastDemand, toDailySeries } from './forecasting';
import {
  abcClassify,
  economicOrderQuantity,
  modifiedZScores,
  normalQuantile,
  reorderPoint,
  safetyStock,
  stockoutDay,
  xyzClassify,
} from './inventoryMath';
import { oeeProxy, pChart, pearson, safetyScore } from './productionMath';

// ── Input row shapes (numbers already converted from Prisma.Decimal) ─────────

export interface MaterialRow {
  id: number;
  code: string;
  name: string;
  unit: string;
  category: string | null;
  currentStock: number;
  minStockLevel: number;
  maxStockLevel: number | null;
  costPerUnit: number | null;
}

export interface TransactionRow {
  id: number;
  materialId: number;
  type: 'IN' | 'OUT' | 'ADJUSTMENT' | 'SCRAP' | 'RETURN';
  quantity: number;
  createdAt: Date;
  performedByName: string | null;
  departmentName: string | null;
}

export interface SupplierRow {
  leadTimeDays: number | null;
  materials: string | null;
}

export interface OpenPurchaseOrderRow {
  material: string;
  quantity: string;
}

export interface WorkOrderRow {
  id: number;
  status: string;
  departmentName: string | null;
  targetQuantity: number;
  scheduledEnd: Date | null;
  actualEnd: Date | null;
  updatedAt: Date;
  outputs: Array<{ goodQty: number; rejectedQty: number; scrapQty: number; recordedAt: Date }>;
}

export interface IncidentRow {
  type: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  departmentName: string | null;
  occurredAt: Date;
}

export interface AttendanceRow {
  status: 'PRESENT' | 'ABSENT' | 'HALF_DAY' | 'LATE' | 'LEAVE';
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

export function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

function round(v: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function avg(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function inr(v: number): string {
  return `₹${Math.round(v).toLocaleString('en-IN')}`;
}

/** Parse "500 kg" / "1,200" / "75.5 litres" -> number (0 when unparseable). */
export function parseQuantity(text: string): number {
  const match = text.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function norm(text: string): string {
  return text.trim().toLowerCase();
}

/** Shortest supplier lead time for a material (suppliers list materials as comma-separated names). */
export function leadTimeFor(materialName: string, suppliers: SupplierRow[]): number | null {
  const name = norm(materialName);
  let best: number | null = null;
  for (const s of suppliers) {
    if (s.leadTimeDays == null || s.leadTimeDays <= 0 || !s.materials) continue;
    const listed = s.materials.split(',').map(norm).filter(Boolean);
    if (listed.some((m) => m === name || name.includes(m) || m.includes(name))) {
      best = best === null ? s.leadTimeDays : Math.min(best, s.leadTimeDays);
    }
  }
  return best;
}

// ══ Inventory intelligence ══════════════════════════════════════════════════

interface MaterialWork {
  row: MaterialRow;
  daily: number[];
  out: MaterialIntelligence;
}

export function buildInventoryIntelligence(input: {
  materials: MaterialRow[];
  transactions: TransactionRow[];
  suppliers: SupplierRow[];
  openPurchaseOrders: OpenPurchaseOrderRow[];
  params: AnalyticsQuery;
  now: Date;
}): InventoryIntelligence {
  const { params, now } = input;
  const start = addDays(utcMidnight(now), -params.historyDays);

  const outByMaterial = new Map<number, Array<{ date: Date; quantity: number }>>();
  for (const t of input.transactions) {
    if (t.type !== 'OUT') continue;
    const list = outByMaterial.get(t.materialId) ?? [];
    list.push({ date: t.createdAt, quantity: Math.abs(t.quantity) });
    outByMaterial.set(t.materialId, list);
  }

  const onOrderByName = new Map<string, number>();
  for (const po of input.openPurchaseOrders) {
    const key = norm(po.material);
    onOrderByName.set(key, (onOrderByName.get(key) ?? 0) + parseQuantity(po.quantity));
  }

  const work: MaterialWork[] = input.materials.map((m) => {
    const daily = toDailySeries(outByMaterial.get(m.id) ?? [], start, params.historyDays);
    const fc = forecastDemand(daily, Math.max(params.horizonDays, 1));
    const accuracy = backtest(daily);
    const avgDaily = avg(daily);
    const forecastDaily = avg(fc.forecast);
    const supplierLead = leadTimeFor(m.name, input.suppliers);
    const leadTime = supplierLead ?? params.defaultLeadTimeDays;
    const onOrder = onOrderByName.get(norm(m.name)) ?? 0;

    const ss = safetyStock(fc.residualStd, leadTime, params.serviceLevel);
    const rop = reorderPoint(forecastDaily, leadTime, ss);
    const unitCost = m.costPerUnit ?? 0;
    const annualDemand = forecastDaily * 365;
    const eoq = economicOrderQuantity(
      annualDemand,
      params.orderCost,
      params.holdingRate * unitCost,
    );

    // Project far enough ahead to cover the lead time even with a short horizon
    const projectionDays = Math.max(params.horizonDays, leadTime + 1);
    const projection = forecastDemand(daily, projectionDays).forecast;
    const outDay = forecastDaily > 0 ? stockoutDay(m.currentStock, projection) : null;
    const daysOfCover = forecastDaily > 0 ? m.currentStock / forecastDaily : null;
    const position = m.currentStock + onOrder;

    let status: StockStatus;
    if (forecastDaily <= 1e-9 && avgDaily <= 1e-9) {
      status = m.currentStock < m.minStockLevel ? 'REORDER' : 'NO_DEMAND';
    } else if (outDay !== null && outDay < leadTime && position < rop) {
      status = 'CRITICAL';
    } else if (position <= rop || m.currentStock < m.minStockLevel) {
      status = 'REORDER';
    } else if (
      (m.maxStockLevel !== null && m.currentStock > m.maxStockLevel) ||
      (daysOfCover ?? 0) > 180
    ) {
      status = 'OVERSTOCK';
    } else {
      status = 'OK';
    }

    let suggested = 0;
    if (status === 'CRITICAL' || status === 'REORDER') {
      const coverGap = rop + forecastDaily * leadTime - position; // bring position back above ROP for one cycle
      const minLevelGap = m.minStockLevel - position;
      const fallback = eoq > 0 ? eoq : forecastDaily * 30;
      suggested = Math.ceil(Math.max(fallback, coverGap, minLevelGap, 0));
    }

    return {
      row: m,
      daily,
      out: {
        id: m.id,
        code: m.code,
        name: m.name,
        unit: m.unit,
        category: m.category,
        currentStock: round(m.currentStock, 3),
        onOrder: round(onOrder, 3),
        costPerUnit: m.costPerUnit,
        avgDailyDemand: round(avgDaily, 3),
        forecastDailyDemand: round(forecastDaily, 3),
        forecastHorizonDemand: round(
          fc.forecast.reduce((a, b) => a + b, 0),
          2,
        ),
        forecastMethod: fc.method,
        forecastError: accuracy.totalError === null ? null : round(accuracy.totalError, 3),
        daysOfCover: daysOfCover === null ? null : round(daysOfCover, 1),
        predictedStockoutDate: outDay === null ? null : isoDay(addDays(now, outDay + 1)),
        leadTimeDays: leadTime,
        leadTimeSource: supplierLead === null ? 'default' : 'supplier',
        safetyStock: round(ss, 2),
        reorderPoint: round(rop, 2),
        economicOrderQty: round(eoq, 1),
        suggestedOrderQty: suggested,
        status,
        abc: 'C',
        xyz: 'Z',
        demandCv: null,
        annualConsumptionValue: round(annualDemand * unitCost, 2),
      },
    };
  });

  // ABC by annual consumption value, XYZ by weekly demand variability
  const abc = abcClassify(work.map((w) => ({ w, value: w.out.annualConsumptionValue })));
  for (const [item, cls] of abc) item.w.out.abc = cls;
  for (const w of work) {
    const { cls, cv } = xyzClassify(w.daily);
    w.out.xyz = cls;
    w.out.demandCv = Number.isFinite(cv) ? round(cv, 2) : null;
  }

  const matrix: InventoryIntelligence['abcXyzMatrix'] = [];
  for (const a of ['A', 'B', 'C'] as const) {
    for (const x of ['X', 'Y', 'Z'] as const) {
      const members = work.filter((w) => w.out.abc === a && w.out.xyz === x);
      matrix.push({
        abc: a,
        xyz: x,
        count: members.length,
        value: round(
          members.reduce((s, w) => s + w.out.annualConsumptionValue, 0),
          0,
        ),
      });
    }
  }

  const anomalies = detectMovementAnomalies(input.transactions, input.materials);

  const materials = work.map((w) => w.out);
  const value = (m: MaterialIntelligence) => m.costPerUnit ?? 0;
  const count = (s: StockStatus) => materials.filter((m) => m.status === s).length;
  const shortageValue = materials
    .filter((m) => m.status === 'CRITICAL')
    .reduce(
      (s, m) =>
        s +
        Math.max(0, m.forecastDailyDemand * m.leadTimeDays - m.currentStock - m.onOrder) * value(m),
      0,
    );
  const excessStockValue = work.reduce((s, w) => {
    const m = w.out;
    const ceiling =
      w.row.maxStockLevel ?? (m.forecastDailyDemand > 0 ? m.forecastDailyDemand * 90 : Infinity);
    return s + Math.max(0, m.currentStock - ceiling) * value(m);
  }, 0);
  // Demand-weighted so a slow-moving item with 2 issues a month does not dominate
  const scored = materials.filter((m) => m.forecastError !== null && m.avgDailyDemand > 0);
  const demandWeight = scored.reduce((s, m) => s + m.avgDailyDemand * (m.costPerUnit ?? 1), 0);

  const summary: InventoryIntelligence['summary'] = {
    materials: materials.length,
    critical: count('CRITICAL'),
    reorder: count('REORDER'),
    ok: count('OK'),
    overstock: count('OVERSTOCK'),
    noDemand: count('NO_DEMAND'),
    inventoryValue: round(
      materials.reduce((s, m) => s + m.currentStock * value(m), 0),
      0,
    ),
    shortageValue: round(shortageValue, 0),
    excessStockValue: round(excessStockValue, 0),
    suggestedPurchaseValue: round(
      materials.reduce((s, m) => s + m.suggestedOrderQty * value(m), 0),
      0,
    ),
    forecastError:
      demandWeight > 0
        ? round(
            scored.reduce(
              (s, m) => s + (m.forecastError ?? 0) * m.avgDailyDemand * (m.costPerUnit ?? 1),
              0,
            ) / demandWeight,
            3,
          )
        : null,
  };

  const statusRank: Record<StockStatus, number> = {
    CRITICAL: 0,
    REORDER: 1,
    OVERSTOCK: 2,
    OK: 3,
    NO_DEMAND: 4,
  };
  materials.sort(
    (a, b) =>
      statusRank[a.status] - statusRank[b.status] ||
      (a.daysOfCover ?? Infinity) - (b.daysOfCover ?? Infinity) ||
      b.annualConsumptionValue - a.annualConsumptionValue,
  );

  return {
    generatedAt: now.toISOString(),
    parameters: params,
    summary,
    abcXyzMatrix: matrix,
    materials,
    anomalies,
    insights: inventoryInsights(materials, summary, anomalies, params),
  };
}

/**
 * Flags stock movements that are statistically unusual for that material:
 * very large issues (OUT/SCRAP) relative to the material's own history, and
 * large unexplained negative adjustments (possible shrinkage / pilferage).
 */
export function detectMovementAnomalies(
  transactions: TransactionRow[],
  materials: MaterialRow[],
  limit = 25,
): StockMovementAnomaly[] {
  const names = new Map(materials.map((m) => [m.id, m.name]));
  const byMaterial = new Map<number, TransactionRow[]>();
  for (const t of transactions) {
    if (t.type !== 'OUT' && t.type !== 'SCRAP' && t.type !== 'ADJUSTMENT') continue;
    const list = byMaterial.get(t.materialId) ?? [];
    list.push(t);
    byMaterial.set(t.materialId, list);
  }

  const found: StockMovementAnomaly[] = [];
  for (const [materialId, list] of byMaterial) {
    // Outflow magnitude per movement: OUT/SCRAP are positive, ADJUSTMENT counts only when negative
    const outflows = list
      .map((t) => ({
        t,
        qty: t.type === 'ADJUSTMENT' ? Math.max(0, -t.quantity) : Math.abs(t.quantity),
      }))
      .filter((x) => x.qty > 0);
    if (outflows.length < 6) continue; // too little history to call anything unusual
    const z = modifiedZScores(outflows.map((x) => x.qty));
    outflows.forEach((x, i) => {
      const score = z[i] ?? 0;
      if (score <= 3.5) return;
      const reason =
        x.t.type === 'ADJUSTMENT'
          ? 'Large negative stock adjustment (possible shrinkage, damage or pilferage)'
          : x.t.type === 'SCRAP'
            ? 'Scrap write-off far above normal for this material'
            : 'Issue quantity far above normal consumption for this material';
      found.push({
        transactionId: x.t.id,
        materialId,
        materialName: names.get(materialId) ?? `#${materialId}`,
        type: x.t.type,
        quantity: round(x.qty, 3),
        date: x.t.createdAt.toISOString(),
        robustZ: round(score, 1),
        reason,
        performedBy: x.t.performedByName,
        department: x.t.departmentName,
      });
    });
  }
  return found.sort((a, b) => b.robustZ - a.robustZ).slice(0, limit);
}

function inventoryInsights(
  materials: MaterialIntelligence[],
  summary: InventoryIntelligence['summary'],
  anomalies: StockMovementAnomaly[],
  params: AnalyticsQuery,
): Insight[] {
  const out: Insight[] = [];
  for (const m of materials.filter((x) => x.status === 'CRITICAL').slice(0, 3)) {
    out.push({
      severity: 'critical',
      title: `${m.name} will run out before it can be replenished`,
      detail:
        `Forecast stock-out ${m.predictedStockoutDate ?? 'soon'} (${m.daysOfCover ?? 0} days of cover) but ` +
        `the lead time is ${m.leadTimeDays} days. Raise a purchase order for about ` +
        `${m.suggestedOrderQty} ${m.unit} today.`,
    });
  }
  if (summary.reorder > 0) {
    out.push({
      severity: 'warning',
      title: `${summary.reorder} material(s) have reached their reorder point`,
      detail:
        `Reorder points use a ${Math.round(params.serviceLevel * 100)}% service level ` +
        `(z = ${normalQuantile(params.serviceLevel).toFixed(2)}) and each material's own demand variability.`,
    });
  }
  if (summary.excessStockValue > 0) {
    out.push({
      severity: 'info',
      title: `${inr(summary.excessStockValue)} is tied up in excess stock`,
      detail:
        `${summary.overstock} material(s) hold more than their maximum level or 90 days of forecast need. ` +
        'Consider pausing purchases for these items.',
    });
  }
  const top = anomalies[0];
  if (top) {
    out.push({
      severity: 'warning',
      title: `${anomalies.length} unusual stock movement(s) detected`,
      detail:
        `Largest: ${top.type} of ${top.quantity} on ${top.materialName} ` +
        `(${top.robustZ}x the robust spread of normal movements). Verify against the work order or gate pass.`,
    });
  }
  const aItems = materials.filter((m) => m.abc === 'A');
  if (aItems.length) {
    const ax = aItems.filter((m) => m.xyz === 'X').length;
    out.push({
      severity: 'info',
      title: `${aItems.length} A-class item(s) drive 80% of consumption value`,
      detail: `${ax} of them have stable demand (AX) and suit automatic reordering; AZ items need manual review.`,
    });
  }
  if (summary.forecastError !== null) {
    out.push({
      severity: summary.forecastError <= 0.2 ? 'positive' : 'info',
      title: `Forecast accuracy on unseen data: ${Math.max(0, Math.round((1 - summary.forecastError) * 100))}%`,
      detail:
        'Each model was refitted without the last 14 days, then its 14-day demand total was compared with ' +
        'what was actually issued (consumption-value weighted across materials).',
    });
  }
  if (!out.length) {
    out.push({
      severity: 'positive',
      title: 'Inventory is healthy',
      detail: 'No material is at or below its reorder point.',
    });
  }
  return out;
}

export function buildMaterialForecast(input: {
  material: MaterialRow;
  transactions: TransactionRow[];
  suppliers: SupplierRow[];
  params: AnalyticsQuery;
  now: Date;
}): MaterialForecast {
  const { material: m, params, now } = input;
  const start = addDays(utcMidnight(now), -params.historyDays);
  const daily = toDailySeries(
    input.transactions
      .filter((t) => t.type === 'OUT' && t.materialId === m.id)
      .map((t) => ({ date: t.createdAt, quantity: Math.abs(t.quantity) })),
    start,
    params.historyDays,
  );
  const fc = forecastDemand(daily, params.horizonDays);
  const leadTime = leadTimeFor(m.name, input.suppliers) ?? params.defaultLeadTimeDays;
  const ss = safetyStock(fc.residualStd, leadTime, params.serviceLevel);
  const z80 = normalQuantile(0.9); // 80% prediction interval
  const today = utcMidnight(now);

  let stock = m.currentStock;
  const projectedStock: MaterialForecast['projectedStock'] = [
    { date: isoDay(today), stock: round(stock, 2) },
  ];
  const forecast = fc.forecast.map((value, i) => {
    // Daily prediction interval, widening slowly with the horizon as model uncertainty grows
    const spread = z80 * fc.residualStd * Math.sqrt(1 + 0.05 * i);
    stock -= value;
    projectedStock.push({
      date: isoDay(addDays(today, i + 1)),
      stock: round(Math.max(stock, 0), 2),
    });
    return {
      date: isoDay(addDays(today, i + 1)),
      forecast: round(value, 3),
      lower: round(Math.max(0, value - spread), 3),
      upper: round(value + spread, 3),
    };
  });

  return {
    materialId: m.id,
    name: m.name,
    unit: m.unit,
    method: fc.method,
    params: Object.fromEntries(Object.entries(fc.params).map(([k, v]) => [k, round(v, 3)])),
    ...(() => {
      const b = backtest(daily);
      return {
        wape: b.wape === null ? null : round(b.wape, 3),
        totalError: b.totalError === null ? null : round(b.totalError, 3),
      };
    })(),
    history: daily.map((actual, i) => ({
      date: isoDay(addDays(start, i)),
      actual: round(actual, 3),
    })),
    forecast,
    currentStock: round(m.currentStock, 3),
    reorderPoint: round(reorderPoint(avg(fc.forecast), leadTime, ss), 2),
    safetyStock: round(ss, 2),
    projectedStock,
  };
}

// ══ Production performance ═══════════════════════════════════════════════════

interface Tally {
  workOrders: number;
  target: number;
  good: number;
  rejected: number;
  scrap: number;
  completedWithDue: number;
  completedOnTime: number;
  attainGood: number;
  attainTarget: number;
}

const emptyTally = (): Tally => ({
  workOrders: 0,
  target: 0,
  good: 0,
  rejected: 0,
  scrap: 0,
  completedWithDue: 0,
  completedOnTime: 0,
  attainGood: 0,
  attainTarget: 0,
});

function addWorkOrder(t: Tally, wo: WorkOrderRow): void {
  const good = wo.outputs.reduce((s, o) => s + o.goodQty, 0);
  t.workOrders += 1;
  t.target += wo.targetQuantity;
  t.good += good;
  t.rejected += wo.outputs.reduce((s, o) => s + o.rejectedQty, 0);
  t.scrap += wo.outputs.reduce((s, o) => s + o.scrapQty, 0);
  if (wo.status === 'COMPLETED') {
    // Attainment is judged on finished orders so in-progress work is not penalised
    t.attainGood += good;
    t.attainTarget += wo.targetQuantity;
    if (wo.scheduledEnd) {
      const finished = wo.actualEnd ?? wo.updatedAt;
      t.completedWithDue += 1;
      // Allow completion any time on the due date itself
      if (finished.getTime() <= utcMidnight(wo.scheduledEnd).getTime() + DAY_MS)
        t.completedOnTime += 1;
    }
  }
}

function oeeOf(t: Tally) {
  const base = oeeProxy({
    good: t.good,
    rejected: t.rejected,
    scrap: t.scrap,
    target: 0,
    completedWithDueDate: t.completedWithDue,
    completedOnTime: t.completedOnTime,
  });
  // Attainment on completed orders when there are any, otherwise on everything in the window
  const attainTarget = t.attainTarget > 0 ? t.attainTarget : t.target;
  const attainGood = t.attainTarget > 0 ? t.attainGood : t.good;
  const attainment = attainTarget > 0 ? Math.min(1, attainGood / attainTarget) : 0;
  return {
    quality: base.quality,
    attainment,
    schedule: base.schedule,
    oee: base.quality * attainment * base.schedule,
  };
}

function isoWeek(d: Date): string {
  const date = utcMidnight(d);
  const day = (date.getUTCDay() + 6) % 7; // Monday = 0
  const thursday = addDays(date, 3 - day);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week =
    1 +
    Math.round(
      (thursday.getTime() - yearStart.getTime()) / (7 * DAY_MS) -
        0.5 +
        ((yearStart.getUTCDay() + 6) % 7) / 7,
    );
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function buildProductionPerformance(input: {
  workOrders: WorkOrderRow[];
  historyDays: number;
  now: Date;
}): ProductionPerformance {
  const overall = emptyTally();
  const byDept = new Map<string, Tally>();
  const byDay = new Map<string, { inspected: number; defective: number }>();
  const byWeek = new Map<string, { good: number; defective: number }>();

  for (const wo of input.workOrders) {
    if (wo.status === 'CANCELLED') continue;
    addWorkOrder(overall, wo);
    const dept = wo.departmentName ?? 'Unassigned';
    const t = byDept.get(dept) ?? emptyTally();
    addWorkOrder(t, wo);
    byDept.set(dept, t);
    for (const o of wo.outputs) {
      const defective = o.rejectedQty + o.scrapQty;
      const day = isoDay(o.recordedAt);
      const d = byDay.get(day) ?? { inspected: 0, defective: 0 };
      d.inspected += o.goodQty + defective;
      d.defective += defective;
      byDay.set(day, d);
      const wk = isoWeek(o.recordedAt);
      const w = byWeek.get(wk) ?? { good: 0, defective: 0 };
      w.good += o.goodQty;
      w.defective += defective;
      byWeek.set(wk, w);
    }
  }

  const o = oeeOf(overall);
  const departments: DepartmentPerformance[] = [...byDept.entries()]
    .map(([department, t]) => {
      const r = oeeOf(t);
      return {
        department,
        workOrders: t.workOrders,
        target: round(t.target, 2),
        good: round(t.good, 2),
        rejected: round(t.rejected, 2),
        scrap: round(t.scrap, 2),
        quality: round(r.quality, 4),
        attainment: round(r.attainment, 4),
        schedule: round(r.schedule, 4),
        oee: round(r.oee, 4),
        rank: 0,
      };
    })
    .sort((a, b) => b.oee - a.oee);
  departments.forEach((d, i) => (d.rank = i + 1));

  const qualityControl = pChart(
    [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, ...v })),
  );
  const weeklyTrend = [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, w]) => ({
      week,
      good: round(w.good, 2),
      defective: round(w.defective, 2),
      quality: w.good + w.defective > 0 ? round(w.good / (w.good + w.defective), 4) : 0,
    }));

  const insights: Insight[] = [];
  const worst = departments[departments.length - 1];
  const best = departments[0];
  if (best && worst && departments.length > 1 && best.oee - worst.oee > 0.1) {
    const lowest = (['quality', 'attainment', 'schedule'] as const).reduce((a, b) =>
      worst[a] <= worst[b] ? a : b,
    );
    insights.push({
      severity: 'warning',
      title: `${worst.department} trails ${best.department} by ${Math.round((best.oee - worst.oee) * 100)} OEE points`,
      detail:
        `Its weakest factor is ${lowest} (${Math.round(worst[lowest] * 100)}%). ` +
        `Improving it to the plant average would lift OEE the most.`,
    });
  }
  if (qualityControl.outOfControlDays > 0) {
    const days = qualityControl.points.filter((p) => p.outOfControl).map((p) => p.date);
    insights.push({
      severity: 'critical',
      title: `Defect rate out of statistical control on ${qualityControl.outOfControlDays} day(s)`,
      detail:
        `Days ${days.slice(-3).join(', ')} broke the 3-sigma p-chart limit (centre ${(qualityControl.centerLine * 100).toFixed(1)}%). ` +
        'Investigate special causes: material batch, machine setting, operator change.',
    });
  }
  if (qualityControl.shiftDetected) {
    insights.push({
      severity: 'warning',
      title: 'Sustained quality drift detected',
      detail:
        'Seven or more consecutive days above the average defect rate (Western Electric rule) — a process shift, ' +
        'even though no single day broke the control limits.',
    });
  }
  const overdue = input.workOrders.filter(
    (wo) =>
      !['COMPLETED', 'CANCELLED'].includes(wo.status) &&
      wo.scheduledEnd &&
      wo.scheduledEnd < input.now,
  ).length;
  if (overdue) {
    insights.push({
      severity: 'warning',
      title: `${overdue} work order(s) are past their scheduled end`,
      detail: 'They lower the schedule-adherence factor once completed late.',
    });
  }
  if (!insights.length && overall.workOrders) {
    insights.push({
      severity: 'positive',
      title: 'Production is stable',
      detail: 'No department gap, control-limit breach or drift detected.',
    });
  }

  return {
    generatedAt: input.now.toISOString(),
    historyDays: input.historyDays,
    overall: {
      workOrders: overall.workOrders,
      target: round(overall.target, 2),
      good: round(overall.good, 2),
      rejected: round(overall.rejected, 2),
      scrap: round(overall.scrap, 2),
      quality: round(o.quality, 4),
      attainment: round(o.attainment, 4),
      schedule: round(o.schedule, 4),
      oee: round(o.oee, 4),
      oeeNote:
        'OEE-style index = Quality × Target attainment × Schedule adherence. Classic OEE needs machine run-time ' +
        'data, which is not recorded, so attainment and schedule adherence stand in for Performance and Availability.',
    },
    departments,
    weeklyTrend,
    qualityControl,
    insights,
  };
}

// ══ Plant health index ═══════════════════════════════════════════════════════

export function buildPlantHealth(input: {
  inventory: InventoryIntelligence;
  production: ProductionPerformance;
  incidents: IncidentRow[];
  attendance: AttendanceRow[];
  now: Date;
}): PlantHealth {
  const { inventory, production } = input;
  const components: PlantHealthComponent[] = [];

  const activeMaterials = inventory.summary.materials - inventory.summary.noDemand;
  if (activeMaterials > 0) {
    const penalty =
      (inventory.summary.critical + 0.5 * inventory.summary.reorder) / activeMaterials;
    components.push({
      key: 'inventory',
      label: 'Inventory availability',
      weight: 0.2,
      score: round(100 * Math.max(0, 1 - penalty), 1),
      detail: `${inventory.summary.critical} critical and ${inventory.summary.reorder} reorder items out of ${activeMaterials} with demand`,
    });
  }
  if (production.overall.workOrders > 0) {
    components.push({
      key: 'production',
      label: 'Production (OEE-style)',
      weight: 0.25,
      score: round(100 * production.overall.oee, 1),
      detail: `${Math.round(production.overall.attainment * 100)}% target attainment, ${Math.round(production.overall.schedule * 100)}% on time`,
    });
    components.push({
      key: 'quality',
      label: 'Quality (first-pass yield)',
      weight: 0.2,
      score: round(100 * production.overall.quality, 1),
      detail: `${production.qualityControl.outOfControlDays} out-of-control day(s) on the p-chart`,
    });
  }
  const last30 = input.incidents.filter(
    (i) => i.occurredAt.getTime() >= input.now.getTime() - 30 * DAY_MS,
  );
  components.push({
    key: 'safety',
    label: 'Safety (last 30 days)',
    weight: 0.25,
    score: round(safetyScore(last30), 1),
    detail: `${last30.length} incident(s); severity-weighted (critical = 8x low)`,
  });
  if (input.attendance.length > 0) {
    const credit = { PRESENT: 1, LATE: 0.75, HALF_DAY: 0.5, LEAVE: 0, ABSENT: 0 } as const;
    const rate =
      input.attendance.reduce((s, a) => s + credit[a.status], 0) / input.attendance.length;
    components.push({
      key: 'workforce',
      label: 'Workforce attendance',
      weight: 0.1,
      score: round(100 * rate, 1),
      detail: `${input.attendance.length} attendance records in the last 30 days`,
    });
  }

  const totalWeight = components.reduce((s, c) => s + c.weight, 0);
  const score =
    totalWeight > 0 ? components.reduce((s, c) => s + c.score * c.weight, 0) / totalWeight : 0;
  const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : 'D';

  // Do departments with more safety incidents also have lower first-pass yield?
  const incidentsByDept = new Map<string, number>();
  for (const i of input.incidents) {
    if (!i.departmentName) continue;
    incidentsByDept.set(i.departmentName, (incidentsByDept.get(i.departmentName) ?? 0) + 1);
  }
  const paired = production.departments.filter((d) => d.good + d.rejected + d.scrap > 0);
  const r = pearson(
    paired.map((d) => incidentsByDept.get(d.department) ?? 0),
    paired.map((d) => d.quality),
  );
  const correlationNote =
    r === null
      ? 'Not enough departments with both production and incident data.'
      : `${r < -0.3 ? 'Departments with more incidents tend to have lower first-pass yield' : r > 0.3 ? 'No safety-quality trade-off: incident counts rise with yield' : 'No clear link between incidents and yield'} ` +
        `(r = ${r.toFixed(2)}, n = ${paired.length}${paired.length < 5 ? '; indicative only' : ''}).`;

  const typeCounts = new Map<string, number>();
  for (const i of last30) typeCounts.set(i.type, (typeCounts.get(i.type) ?? 0) + 1);

  const weakest = [...components].sort((a, b) => a.score - b.score)[0];
  const insights: Insight[] = [];
  if (weakest && weakest.score < 70) {
    insights.push({
      severity: weakest.score < 50 ? 'critical' : 'warning',
      title: `${weakest.label} is pulling the plant score down (${weakest.score})`,
      detail: weakest.detail,
    });
  }
  insights.push(...inventory.insights.filter((i) => i.severity === 'critical').slice(0, 1));
  insights.push(...production.insights.filter((i) => i.severity === 'critical').slice(0, 1));
  if (!insights.length)
    insights.push({
      severity: 'positive',
      title: 'All plant health components are on track',
      detail: `Overall score ${round(score, 1)} (grade ${grade}).`,
    });

  return {
    generatedAt: input.now.toISOString(),
    score: round(score, 1),
    grade,
    components,
    safetyQualityCorrelation: {
      r: r === null ? null : round(r, 3),
      departments: paired.length,
      note: correlationNote,
    },
    incidentsByType: [...typeCounts.entries()]
      .map(([type, c]) => ({ type, count: c }))
      .sort((a, b) => b.count - a.count),
    insights,
  };
}
