import { useCallback, useEffect, useState } from "react";
import { AlertOctagon, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { Card, CardHeader } from "../../shared/UI";
import { type Insight, type StockStatus } from "../../../../lib/services/analytics.service";


// ── Shared look ────────────────────────────────────────────────────────────────
// Categorical series (validated for colour-blind separation): brand red, blue, gold.
export const SERIES = { quality: "#A52A2A", attainment: "#1565C0", schedule: "#C9A227" };
export const INK = { primary: "#1C1C1C", secondary: "#4A4A4A", muted: "#7A6C6A", grid: "#F0ECEB" };
export const AXIS = { fontSize: 11, fill: INK.muted };

export const pct = (v: number | null | undefined, digits = 0) => (v == null ? "—" : `${(v * 100).toFixed(digits)}%`);
export const inr = (n: number) => {
  if (n >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(2)}Cr`;
  if (n >= 1_00_000) return `₹${(n / 1_00_000).toFixed(1)}L`;
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(1)}K`;
  return `₹${Math.round(n)}`;
};
export const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Request failed");

export const STATUS_STYLE: Record<StockStatus, { bg: string; color: string; label: string }> = {
  CRITICAL: { bg: "#FFEBEE", color: "#C0392B", label: "Critical" },
  REORDER: { bg: "#FFF3E0", color: "#E65100", label: "Reorder" },
  OK: { bg: "#E8F5E9", color: "#2E7D32", label: "Healthy" },
  OVERSTOCK: { bg: "#E3F2FD", color: "#1565C0", label: "Overstock" },
  NO_DEMAND: { bg: "#ECEFF1", color: "#546E7A", label: "No demand" },
};

export function StockBadge({ status }: { status: StockStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full" style={{ background: s.bg, color: s.color, fontSize: "0.72rem", fontWeight: 600 }}>
      {s.label}
    </span>
  );
}

export const INSIGHT_STYLE = {
  critical: { icon: AlertOctagon, color: "#C0392B", bg: "#FFEBEE", label: "Critical" },
  warning: { icon: AlertTriangle, color: "#E65100", bg: "#FFF3E0", label: "Warning" },
  info: { icon: Info, color: "#1565C0", bg: "#E3F2FD", label: "Info" },
  positive: { icon: CheckCircle2, color: "#2E7D32", bg: "#E8F5E9", label: "Good" },
} as const;

export function InsightList({ insights, title = "AI insights" }: { insights: Insight[]; title?: string }) {
  return (
    <Card>
      <CardHeader title={title} subtitle="Generated from the analysis above, most urgent first" />
      <div className="p-4 flex flex-col gap-3">
        {insights.map((ins, i) => {
          const s = INSIGHT_STYLE[ins.severity];
          const Icon = s.icon;
          return (
            <div key={i} className="flex gap-3 p-3 rounded-lg" style={{ background: s.bg }}>
              <Icon size={18} color={s.color} style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <p style={{ fontSize: "0.8375rem", fontWeight: 600, color: INK.primary }}>
                  <span style={{ color: s.color, marginRight: 6 }}>{s.label}:</span>{ins.title}
                </p>
                <p style={{ fontSize: "0.78rem", color: INK.secondary, marginTop: 2 }}>{ins.detail}</p>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function useLoader<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const run = useCallback(() => {
    setLoading(true);
    setError(null);
    load()
      .then(setData)
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(run, [run]);
  return { data, error, loading, reload: run };
}
