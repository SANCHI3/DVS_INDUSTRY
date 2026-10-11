/**
 * Inventory policy and classification maths (dependency-free).
 *
 *  - Service-level safety stock and dynamic reorder point
 *  - Economic Order Quantity (EOQ)
 *  - ABC (value) x XYZ (demand variability) classification
 *  - Robust anomaly detection on stock movements (median / MAD modified z-score)
 */

/** Inverse standard-normal CDF (Acklam's rational approximation, |error| < 1.2e-9). */
export function normalQuantile(p: number): number {
  if (p <= 0 || p >= 1) throw new RangeError('p must be in (0, 1)');
  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716,
    2.506628277459239,
  ];
  const b = [
    -54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972,
    -13.28068155288572,
  ];
  const c = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const [a0, a1, a2, a3, a4, a5] = a as [number, number, number, number, number, number];
  const [b0, b1, b2, b3, b4] = b as [number, number, number, number, number];
  const [c0, c1, c2, c3, c4, c5] = c as [number, number, number, number, number, number];
  const [d0, d1, d2, d3] = d as [number, number, number, number];
  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c0 * q + c1) * q + c2) * q + c3) * q + c4) * q + c5) /
      ((((d0 * q + d1) * q + d2) * q + d3) * q + 1)
    );
  }
  if (p > 1 - low) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(((((c0 * q + c1) * q + c2) * q + c3) * q + c4) * q + c5) /
      ((((d0 * q + d1) * q + d2) * q + d3) * q + 1)
    );
  }
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a0 * r + a1) * r + a2) * r + a3) * r + a4) * r + a5) * q) /
    (((((b0 * r + b1) * r + b2) * r + b3) * r + b4) * r + 1)
  );
}

/** Safety stock = z * sigma_daily * sqrt(lead time). */
export function safetyStock(dailyStd: number, leadTimeDays: number, serviceLevel: number): number {
  const z = normalQuantile(serviceLevel);
  return Math.max(0, z * dailyStd * Math.sqrt(Math.max(leadTimeDays, 0)));
}

/** Reorder point = expected demand during lead time + safety stock. */
export function reorderPoint(avgDaily: number, leadTimeDays: number, safety: number): number {
  return Math.max(0, avgDaily * leadTimeDays + safety);
}

/** Economic Order Quantity = sqrt(2 * annual demand * order cost / annual holding cost per unit). */
export function economicOrderQuantity(
  annualDemand: number,
  orderCost: number,
  holdingCostPerUnitYear: number,
): number {
  if (annualDemand <= 0 || orderCost <= 0 || holdingCostPerUnitYear <= 0) return 0;
  return Math.sqrt((2 * annualDemand * orderCost) / holdingCostPerUnitYear);
}

/** Index (0-based) of the first day on which cumulative forecast demand exceeds stock, or null. */
export function stockoutDay(stock: number, dailyForecast: number[]): number | null {
  let remaining = stock;
  for (let day = 0; day < dailyForecast.length; day++) {
    remaining -= dailyForecast[day] ?? 0;
    if (remaining < 0) return day;
  }
  return null;
}

export type AbcClass = 'A' | 'B' | 'C';
export type XyzClass = 'X' | 'Y' | 'Z';

/**
 * Pareto ABC classification on annual consumption value.
 * A = items making up the first 80% of value, B = next 15%, C = last 5%.
 */
export function abcClassify<T extends { value: number }>(items: T[]): Map<T, AbcClass> {
  const sorted = [...items].sort((x, y) => y.value - x.value);
  const total = sorted.reduce((s, i) => s + Math.max(i.value, 0), 0);
  const out = new Map<T, AbcClass>();
  let cumulative = 0;
  for (const item of sorted) {
    const shareBefore = total > 0 ? cumulative / total : 1;
    out.set(
      item,
      total <= 0 || item.value <= 0
        ? 'C'
        : shareBefore < 0.8
          ? 'A'
          : shareBefore < 0.95
            ? 'B'
            : 'C',
    );
    cumulative += Math.max(item.value, 0);
  }
  return out;
}

/**
 * XYZ classification by coefficient of variation of WEEKLY demand
 * (weekly buckets smooth out day-of-week effects).
 * X: CV <= 0.5 (stable)  Y: CV <= 1.0 (variable)  Z: CV > 1.0 (erratic / sporadic)
 */
export function xyzClassify(dailySeries: number[]): { cls: XyzClass; cv: number } {
  const weeks: number[] = [];
  for (let i = 0; i + 7 <= dailySeries.length; i += 7) {
    weeks.push(dailySeries.slice(i, i + 7).reduce((a, b) => a + b, 0));
  }
  const m = weeks.length ? weeks.reduce((a, b) => a + b, 0) / weeks.length : 0;
  if (weeks.length < 2 || m <= 0) return { cls: 'Z', cv: Infinity };
  const sd = Math.sqrt(weeks.reduce((s, w) => s + (w - m) ** 2, 0) / (weeks.length - 1));
  const cv = sd / m;
  return { cls: cv <= 0.5 ? 'X' : cv <= 1.0 ? 'Y' : 'Z', cv };
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (!s.length) return 0;
  return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

/**
 * Modified z-scores (Iglewicz & Hoaglin): 0.6745 * (x - median) / MAD.
 * Robust to the very outliers we are looking for, unlike mean/std z-scores.
 * |z| > 3.5 is the conventional outlier cut-off.
 */
export function modifiedZScores(values: number[]): number[] {
  const med = median(values);
  const mad = median(values.map((v) => Math.abs(v - med)));
  if (mad === 0) {
    // Fall back to mean absolute deviation so identical history does not hide spikes
    const meanAd = values.reduce((s, v) => s + Math.abs(v - med), 0) / Math.max(values.length, 1);
    return values.map((v) => (meanAd === 0 ? 0 : (v - med) / (1.253314 * meanAd)));
  }
  return values.map((v) => (0.6745 * (v - med)) / mad);
}
