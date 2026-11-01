import type { ScrapRecordDto } from "./services/inventory.service";

export const NO_SCRAP_RECOMMENDATIONS = "No scrap recommendations yet — they appear once scrap is recorded.";

const DAY_MS = 86_400_000;

function localDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

const round = (n: number) => Math.round(n * 10) / 10;

export interface ScrapSummary {
  unit: string;
  monthTotal: number;
  byDepartment: Array<{ dept: string; qty: number }>;
  trend: Array<{ day: string; qty: number }>;
  worstDepartment: { dept: string; qty: number; share: number } | null;
  recommendations: string[];
}

/**
 * Scrap Analytics from the scrap records themselves: this month by department,
 * the last 7 days, and plain recommendations drawn from those numbers.
 */
export function summariseScrap(records: ScrapRecordDto[], now: Date = new Date()): ScrapSummary {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const thisMonth = records.filter((r) => new Date(r.recordedAt).getTime() >= monthStart);

  const units = new Map<string, number>();
  for (const r of records) units.set(r.unit, (units.get(r.unit) ?? 0) + 1);
  const unit = [...units.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "kg";

  const sumBy = (rows: ScrapRecordDto[], key: (r: ScrapRecordDto) => string) => {
    const totals = new Map<string, number>();
    for (const r of rows) totals.set(key(r), (totals.get(key(r)) ?? 0) + Number(r.quantity));
    return [...totals.entries()].map(([name, qty]) => ({ name, qty: round(qty) })).sort((a, b) => b.qty - a.qty);
  };

  const monthTotal = round(thisMonth.reduce((sum, r) => sum + Number(r.quantity), 0));
  const departments = sumBy(thisMonth, (r) => r.departmentName ?? "No department");
  const materials = sumBy(thisMonth, (r) => r.materialName);
  const reasons = sumBy(thisMonth.filter((r) => r.reason), (r) => r.reason!.trim());

  const today = localDay(now);
  const trend = Array.from({ length: 7 }, (_, i) => {
    const day = today - (6 - i) * DAY_MS;
    const qty = records
      .filter((r) => localDay(new Date(r.recordedAt)) === day)
      .reduce((sum, r) => sum + Number(r.quantity), 0);
    return { day: new Date(day).toLocaleDateString("en-IN", { weekday: "short" }), qty: round(qty) };
  });

  const worst = departments.find((d) => d.name !== "No department") ?? null;
  const worstDepartment = worst && monthTotal > 0
    ? { dept: worst.name, qty: worst.qty, share: Math.round((worst.qty / monthTotal) * 100) }
    : null;

  const recommendations: string[] = [];
  if (worstDepartment) {
    recommendations.push(`${worstDepartment.dept} recorded ${worstDepartment.share}% of this month's scrap (${worstDepartment.qty} ${unit}). Review its process first.`);
  }
  if (materials[0]) {
    recommendations.push(`${materials[0].name} is the most scrapped material this month (${materials[0].qty} ${unit}).`);
  }
  if (reasons[0]) {
    recommendations.push(`Most scrap this month was recorded as "${reasons[0].name}" (${reasons[0].qty} ${unit}).`);
  }
  if (recommendations.length === 0) recommendations.push(NO_SCRAP_RECOMMENDATIONS);

  return {
    unit,
    monthTotal,
    byDepartment: departments.map((d) => ({ dept: d.name, qty: d.qty })),
    trend,
    worstDepartment,
    recommendations,
  };
}
