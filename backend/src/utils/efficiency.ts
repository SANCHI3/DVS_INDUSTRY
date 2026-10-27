/**
 * Efficiency (%) = produced / expected × 100, rounded to one decimal.
 * Null when either value is missing or expected is not above zero, so callers
 * show "N/A" instead of Infinity, NaN or a misleading 0%.
 */
export function calculateEfficiency(
  expected: number | null | undefined,
  produced: number | null | undefined,
): number | null {
  if (expected === null || expected === undefined || produced === null || produced === undefined) {
    return null;
  }
  if (!Number.isFinite(expected) || !Number.isFinite(produced) || expected <= 0) return null;
  return Math.round((produced / expected) * 1000) / 10;
}
