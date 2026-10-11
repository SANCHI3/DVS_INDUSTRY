/**
 * Production performance maths (dependency-free).
 *
 *  - OEE-style index. Classic OEE = Availability x Performance x Quality needs
 *    machine run-time data, which this ERP does not record. We therefore use an
 *    explicitly labelled proxy built from the data that IS recorded:
 *      Quality       = good / (good + rejected + scrap)
 *      Attainment    = min(1, good / target)          (stands in for Performance)
 *      Schedule      = on-time completions / completions with a due date
 *                                                     (stands in for Availability)
 *  - Statistical Process Control: p-chart for the daily defect proportion with
 *    3-sigma limits that widen on low-volume days, plus the Western Electric
 *    "run of 7" rule that detects a sustained shift before limits are broken.
 *  - Pearson correlation (used to relate safety incidents to quality).
 */

export interface OeeInputs {
  good: number;
  rejected: number;
  scrap: number;
  target: number;
  completedWithDueDate: number;
  completedOnTime: number;
}

export interface OeeResult {
  quality: number;
  attainment: number;
  schedule: number;
  oee: number;
}

export function oeeProxy(i: OeeInputs): OeeResult {
  const produced = i.good + i.rejected + i.scrap;
  const quality = produced > 0 ? i.good / produced : 0;
  const attainment = i.target > 0 ? Math.min(1, i.good / i.target) : 0;
  // No due dates recorded -> do not penalise the schedule component
  const schedule = i.completedWithDueDate > 0 ? i.completedOnTime / i.completedWithDueDate : 1;
  return { quality, attainment, schedule, oee: quality * attainment * schedule };
}

export interface PChartPoint {
  date: string;
  inspected: number;
  defective: number;
  proportion: number;
  ucl: number;
  lcl: number;
  outOfControl: boolean;
  /** Part of a run of >= 7 consecutive points above the centre line. */
  shift: boolean;
}

export interface PChart {
  centerLine: number;
  points: PChartPoint[];
  outOfControlDays: number;
  shiftDetected: boolean;
}

export function pChart(
  days: ReadonlyArray<{ date: string; inspected: number; defective: number }>,
): PChart {
  const valid = days.filter((d) => d.inspected > 0);
  const totalInspected = valid.reduce((s, d) => s + d.inspected, 0);
  const totalDefective = valid.reduce((s, d) => s + d.defective, 0);
  const p = totalInspected > 0 ? totalDefective / totalInspected : 0;

  const points: PChartPoint[] = valid.map((d) => {
    const sigma = Math.sqrt((p * (1 - p)) / d.inspected);
    const proportion = d.defective / d.inspected;
    const ucl = Math.min(1, p + 3 * sigma);
    const lcl = Math.max(0, p - 3 * sigma);
    return {
      date: d.date,
      inspected: d.inspected,
      defective: d.defective,
      proportion,
      ucl,
      lcl,
      outOfControl: proportion > ucl || proportion < lcl,
      shift: false,
    };
  });

  // Western Electric rule 4: seven or more consecutive points above the centre line
  let runStart = 0;
  let shiftDetected = false;
  for (let i = 0; i <= points.length; i++) {
    const above = i < points.length && (points[i]?.proportion ?? 0) > p;
    if (!above) {
      if (i - runStart >= 7) {
        shiftDetected = true;
        for (let k = runStart; k < i; k++) {
          const point = points[k];
          if (point) point.shift = true;
        }
      }
      runStart = i + 1;
    }
  }

  return {
    centerLine: p,
    points,
    outOfControlDays: points.filter((pt) => pt.outOfControl).length,
    shiftDetected,
  };
}

export function pearson(x: number[], y: number[]): number | null {
  const n = Math.min(x.length, y.length);
  if (n < 3) return null;
  const mx = x.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const my = y.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (x[i] ?? 0) - mx;
    const dy = (y[i] ?? 0) - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

/** Severity-weighted incident load -> 0..100 safety score (100 = no incidents). */
export function safetyScore(
  incidents: ReadonlyArray<{ severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' }>,
  halfLifePoints = 10,
): number {
  const weights = { LOW: 1, MEDIUM: 2, HIGH: 4, CRITICAL: 8 } as const;
  const load = incidents.reduce((s, i) => s + weights[i.severity], 0);
  return 100 * Math.pow(0.5, load / halfLifePoints);
}
