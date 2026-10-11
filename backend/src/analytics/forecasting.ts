/**
 * Demand forecasting for inventory planning (dependency-free).
 *
 * Two classical methods are implemented and chosen automatically per material
 * using the Syntetos–Boylan demand classification:
 *
 *  - Holt's linear exponential smoothing (level + trend) for regular demand.
 *    alpha and beta are fitted by grid search on one-step-ahead squared error.
 *  - Croston's method with the Syntetos–Boylan Approximation (SBA) for
 *    intermittent demand (many zero days), which Holt handles poorly.
 *
 * Accuracy is measured honestly on a hold-out period (the last N days are hidden
 * from the model, forecast, then compared with what actually happened).
 */

export type ForecastMethod = 'HOLT' | 'CROSTON_SBA' | 'INSUFFICIENT_DATA';

export interface HoltModel {
  alpha: number;
  beta: number;
  level: number;
  trend: number;
  fitted: number[];
  residualStd: number;
}

export interface CrostonModel {
  alpha: number;
  demandSize: number;
  interval: number;
  rate: number; // expected demand per period (SBA-corrected)
  residualStd: number;
}

export interface ForecastResult {
  method: ForecastMethod;
  /** Daily point forecasts for the horizon (never negative). */
  forecast: number[];
  /** Standard deviation of one-step-ahead errors (demand units / day). */
  residualStd: number;
  /** Average days between non-zero demands (Syntetos–Boylan ADI). */
  adi: number;
  /** Squared coefficient of variation of non-zero demand sizes (CV²). */
  cv2: number;
  params: Record<string, number>;
}

const ALPHA_GRID = [0.05, 0.1, 0.2, 0.3, 0.5];
const BETA_GRID = [0, 0.01, 0.05, 0.1, 0.2]; // daily data: keep trend smoothing gentle

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function std(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1));
}

/** Bucket dated quantities into a dense daily series starting at `from` (UTC days). */
export function toDailySeries(
  events: ReadonlyArray<{ date: Date; quantity: number }>,
  from: Date,
  days: number,
): number[] {
  const series = new Array<number>(days).fill(0);
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  for (const e of events) {
    const idx = Math.floor((e.date.getTime() - start) / 86_400_000);
    if (idx >= 0 && idx < days) series[idx] = (series[idx] ?? 0) + e.quantity;
  }
  return series;
}

/** Syntetos–Boylan statistics: ADI (average demand interval) and CV² of demand sizes. */
export function demandPattern(series: number[]): { adi: number; cv2: number; nonZero: number } {
  const sizes = series.filter((v) => v > 0);
  if (sizes.length === 0) return { adi: Infinity, cv2: 0, nonZero: 0 };
  const adi = series.length / sizes.length;
  const m = mean(sizes);
  const cv2 = m > 0 ? (std(sizes) / m) ** 2 : 0;
  return { adi, cv2, nonZero: sizes.length };
}

/**
 * Cap demand spikes at median + 3.5 * MAD / 0.6745 of the non-zero days.
 * One abnormal issue (which the anomaly detector reports separately) must not
 * bend the trend for every future reorder decision.
 */
export function capOutliers(series: number[]): number[] {
  const nonZero = series.filter((v) => v > 0).sort((a, b) => a - b);
  if (nonZero.length < 5) return [...series];
  const mid = Math.floor(nonZero.length / 2);
  const med =
    nonZero.length % 2 ? (nonZero[mid] ?? 0) : ((nonZero[mid - 1] ?? 0) + (nonZero[mid] ?? 0)) / 2;
  const devs = nonZero.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
  const mad = devs.length % 2 ? (devs[mid] ?? 0) : ((devs[mid - 1] ?? 0) + (devs[mid] ?? 0)) / 2;
  if (mad <= 0) return [...series];
  const cap = med + (3.5 * mad) / 0.6745;
  return series.map((v) => Math.min(v, cap));
}

export function holtFit(series: number[]): HoltModel {
  let best: HoltModel | null = null;
  let bestSse = Infinity;
  // Robust start: level = mean of the first week, trend = week-over-week change per day
  const first = series.slice(0, 7);
  const second = series.slice(7, 14);
  const level0 = mean(first);
  const trend0 = second.length ? (mean(second) - level0) / 7 : 0;
  for (const alpha of ALPHA_GRID) {
    for (const beta of BETA_GRID.filter((b) => b <= alpha)) {
      let level = level0;
      let trend = trend0;
      const fitted: number[] = [];
      let sse = 0;
      for (let t = 0; t < series.length; t++) {
        const prediction = level + trend;
        const actual = series[t] ?? 0;
        fitted.push(prediction);
        sse += (actual - prediction) ** 2;
        const prevLevel = level;
        level = alpha * actual + (1 - alpha) * (level + trend);
        trend = beta * (level - prevLevel) + (1 - beta) * trend;
      }
      if (sse < bestSse) {
        bestSse = sse;
        // Skip the first week (initialisation period) when estimating forecast error
        const residuals = series.slice(7).map((v, i) => v - (fitted[i + 7] ?? 0));
        best = { alpha, beta, level, trend, fitted, residualStd: std(residuals) };
      }
    }
  }
  return best ?? { alpha: 0.3, beta: 0.1, level: 0, trend: 0, fitted: [], residualStd: 0 };
}

export function holtForecast(model: HoltModel, horizon: number): number[] {
  // Damp the trend so a short burst does not extrapolate to absurd demand.
  const phi = 0.9;
  const out: number[] = [];
  let damp = 0;
  for (let h = 1; h <= horizon; h++) {
    damp += phi ** h;
    out.push(Math.max(0, model.level + damp * model.trend));
  }
  return out;
}

export function crostonFit(series: number[], alpha = 0.1): CrostonModel {
  let size = 0;
  let interval = 1;
  let initialised = false;
  let periodsSinceDemand = 1;
  const predictions: number[] = [];
  const actuals: number[] = [];
  for (const value of series) {
    if (initialised) {
      predictions.push((1 - alpha / 2) * (size / interval));
      actuals.push(value);
    }
    if (value > 0) {
      if (!initialised) {
        size = value;
        interval = periodsSinceDemand;
        initialised = true;
      } else {
        size = alpha * value + (1 - alpha) * size;
        interval = alpha * periodsSinceDemand + (1 - alpha) * interval;
      }
      periodsSinceDemand = 1;
    } else {
      periodsSinceDemand += 1;
    }
  }
  const rate = initialised ? (1 - alpha / 2) * (size / Math.max(interval, 1)) : 0;
  const residualStd = std(actuals.map((a, i) => a - (predictions[i] ?? 0)));
  return { alpha, demandSize: size, interval, rate, residualStd };
}

/**
 * Fit the appropriate model and forecast `horizon` days ahead.
 * Intermittent demand (ADI > 1.32, Syntetos & Boylan 2005) uses Croston-SBA.
 */
export function forecastDemand(rawSeries: number[], horizon: number): ForecastResult {
  const series = capOutliers(rawSeries);
  const { adi, cv2, nonZero } = demandPattern(series);
  if (nonZero < 3 || series.length < 14) {
    const avg = mean(series);
    return {
      method: 'INSUFFICIENT_DATA',
      forecast: new Array<number>(horizon).fill(avg),
      residualStd: std(series),
      adi,
      cv2,
      params: {},
    };
  }
  if (adi > 1.32) {
    const model = crostonFit(series);
    return {
      method: 'CROSTON_SBA',
      forecast: new Array<number>(horizon).fill(model.rate),
      residualStd: model.residualStd,
      adi,
      cv2,
      params: { alpha: model.alpha, demandSize: model.demandSize, interval: model.interval },
    };
  }
  const model = holtFit(series);
  return {
    method: 'HOLT',
    forecast: holtForecast(model, horizon),
    residualStd: model.residualStd,
    adi,
    cv2,
    params: { alpha: model.alpha, beta: model.beta, level: model.level, trend: model.trend },
  };
}

/**
 * Hold-out accuracy: hide the last `holdout` days, forecast them, and compare.
 *  - totalError: |forecast total - actual total| / actual total over the hold-out.
 *    This is what matters for reorder decisions (demand over a lead time).
 *  - wape: day-by-day weighted absolute percentage error (stricter; large for
 *    intermittent items whose exact demand days cannot be predicted).
 */
export function backtest(
  series: number[],
  holdout = 14,
): { totalError: number | null; wape: number | null; mae: number | null; method: ForecastMethod } {
  if (series.length < holdout + 28) {
    return { totalError: null, wape: null, mae: null, method: 'INSUFFICIENT_DATA' };
  }
  const train = series.slice(0, series.length - holdout);
  const test = series.slice(series.length - holdout);
  const result = forecastDemand(train, holdout);
  const absErr = test.map((v, i) => Math.abs(v - (result.forecast[i] ?? 0)));
  const totalActual = test.reduce((a, b) => a + b, 0);
  const totalForecast = result.forecast.reduce((a, b) => a + b, 0);
  if (totalActual <= 0)
    return { totalError: null, wape: null, mae: mean(absErr), method: result.method };
  return {
    totalError: Math.abs(totalForecast - totalActual) / totalActual,
    wape: absErr.reduce((a, b) => a + b, 0) / totalActual,
    mae: mean(absErr),
    method: result.method,
  };
}
