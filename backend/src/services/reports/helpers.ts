import type { ReportFilters } from '../../interfaces';

// ── Date helpers ───────────────────────────────────────────────────────────────

export function startOfMonth(): Date {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function fmtDate(d: Date | null | undefined): string {
  if (d == null) return '—';
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function dayLabel(d: Date): string {
  return d.toLocaleDateString('en-IN', { weekday: 'short' });
}

// ── Filters ────────────────────────────────────────────────────────────────────

export function buildDateWhere(
  filters: ReportFilters,
  _field = 'createdAt',
): { gte?: Date; lte?: Date } | null {
  if (!filters.fromDate && !filters.toDate) return null;
  const w: { gte?: Date; lte?: Date } = {};
  if (filters.fromDate) w.gte = filters.fromDate;
  if (filters.toDate) w.lte = filters.toDate;
  return w;
}

export function buildPeriodLabel(filters: ReportFilters): string {
  if (filters.fromDate && filters.toDate) {
    return `${fmtDate(filters.fromDate)} – ${fmtDate(filters.toDate)}`;
  }
  if (filters.fromDate) return `From ${fmtDate(filters.fromDate)}`;
  if (filters.toDate) return `Up to ${fmtDate(filters.toDate)}`;
  return 'All time';
}
