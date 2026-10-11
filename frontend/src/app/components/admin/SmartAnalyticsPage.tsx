import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, AlertOctagon, AlertTriangle, CheckCircle2, Gauge, IndianRupee, Info, PackageX,
  RefreshCw, ShieldAlert, Sparkles, Target, TrendingUp,
} from "lucide-react";
import {
  Area, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Card, CardHeader, EmptyState, ErrorState, KPICard, PageHeader, Select, Skeleton, TabBar } from "../shared/UI";
import {
  getInventoryIntelligence, getMaterialForecast, getPlantHealth, getProductionPerformance,
  type Insight, type InventoryIntelligence, type MaterialForecast, type MaterialIntelligence,
  type PlantHealth, type ProductionPerformance, type StockStatus,
} from "../../../lib/services/analytics.service";

// ── Shared look ────────────────────────────────────────────────────────────────
// Categorical series (validated for colour-blind separation): brand red, blue, gold.
const SERIES = { quality: "#A52A2A", attainment: "#1565C0", schedule: "#C9A227" };
const INK = { primary: "#1C1C1C", secondary: "#4A4A4A", muted: "#7A6C6A", grid: "#F0ECEB" };
const AXIS = { fontSize: 11, fill: INK.muted };

const pct = (v: number | null | undefined, digits = 0) => (v == null ? "—" : `${(v * 100).toFixed(digits)}%`);
const inr = (n: number) => {
  if (n >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(2)}Cr`;
  if (n >= 1_00_000) return `₹${(n / 1_00_000).toFixed(1)}L`;
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(1)}K`;
  return `₹${Math.round(n)}`;
};
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Request failed");

const STATUS_STYLE: Record<StockStatus, { bg: string; color: string; label: string }> = {
  CRITICAL: { bg: "#FFEBEE", color: "#C0392B", label: "Critical" },
  REORDER: { bg: "#FFF3E0", color: "#E65100", label: "Reorder" },
  OK: { bg: "#E8F5E9", color: "#2E7D32", label: "Healthy" },
  OVERSTOCK: { bg: "#E3F2FD", color: "#1565C0", label: "Overstock" },
  NO_DEMAND: { bg: "#ECEFF1", color: "#546E7A", label: "No demand" },
};

function StockBadge({ status }: { status: StockStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full" style={{ background: s.bg, color: s.color, fontSize: "0.72rem", fontWeight: 600 }}>
      {s.label}
    </span>
  );
}

const INSIGHT_STYLE = {
  critical: { icon: AlertOctagon, color: "#C0392B", bg: "#FFEBEE", label: "Critical" },
  warning: { icon: AlertTriangle, color: "#E65100", bg: "#FFF3E0", label: "Warning" },
  info: { icon: Info, color: "#1565C0", bg: "#E3F2FD", label: "Info" },
  positive: { icon: CheckCircle2, color: "#2E7D32", bg: "#E8F5E9", label: "Good" },
} as const;

function InsightList({ insights, title = "AI insights" }: { insights: Insight[]; title?: string }) {
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

function useLoader<T>(load: () => Promise<T>, deps: unknown[]) {
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

// ══ Plant health ══════════════════════════════════════════════════════════════

function ScoreRing({ score, grade }: { score: number; grade: string }) {
  const r = 70;
  const c = 2 * Math.PI * r;
  const color = score >= 85 ? "#2E7D32" : score >= 70 ? "#1565C0" : score >= 55 ? "#E65100" : "#C0392B";
  return (
    <svg width="180" height="180" viewBox="0 0 180 180" role="img" aria-label={`Plant health ${score} out of 100, grade ${grade}`}>
      <circle cx="90" cy="90" r={r} fill="none" stroke="#F0ECEB" strokeWidth="14" />
      <circle cx="90" cy="90" r={r} fill="none" stroke={color} strokeWidth="14" strokeLinecap="round"
        strokeDasharray={`${(c * score) / 100} ${c}`} transform="rotate(-90 90 90)" />
      <text x="90" y="88" textAnchor="middle" style={{ fontSize: 38, fontWeight: 700, fill: INK.primary }}>{Math.round(score)}</text>
      <text x="90" y="114" textAnchor="middle" style={{ fontSize: 13, fill: INK.muted }}>Grade {grade} · out of 100</text>
    </svg>
  );
}

function HealthTab() {
  const { data, error, loading, reload } = useLoader<PlantHealth>(() => getPlantHealth(), []);
  if (loading) return <Card><Skeleton lines={8} /></Card>;
  if (error || !data) return <Card><ErrorState message={error ?? "No data"} onRetry={reload} /></Card>;
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card>
          <CardHeader title="Plant Health Index" subtitle="Weighted score across five operational pillars" />
          <div className="flex flex-col items-center p-5">
            <ScoreRing score={data.score} grade={data.grade} />
            <p style={{ fontSize: "0.75rem", color: INK.muted, textAlign: "center", marginTop: 8 }}>
              Missing pillars (no data yet) are left out and the remaining weights rescaled.
            </p>
          </div>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Pillar scores" subtitle="0–100, higher is better" />
          <div className="p-5 flex flex-col gap-4">
            {data.components.map((c) => (
              <div key={c.key}>
                <div className="flex justify-between" style={{ fontSize: "0.8125rem" }}>
                  <span style={{ fontWeight: 600, color: INK.primary }}>{c.label} <span style={{ color: INK.muted, fontWeight: 400 }}>· weight {Math.round(c.weight * 100)}%</span></span>
                  <span style={{ fontWeight: 700, color: INK.primary }}>{c.score.toFixed(0)}</span>
                </div>
                <div style={{ height: 8, background: INK.grid, borderRadius: 999, marginTop: 4, overflow: "hidden" }}>
                  <div style={{ width: `${Math.min(100, c.score)}%`, height: "100%", borderRadius: 999, background: c.score >= 70 ? "#A52A2A" : "#E65100" }} />
                </div>
                <p style={{ fontSize: "0.74rem", color: INK.muted, marginTop: 3 }}>{c.detail}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <InsightList insights={data.insights} title="Priorities" />
        <Card>
          <CardHeader title="Safety × quality link" subtitle="Do departments with more incidents also produce more defects?" />
          <div className="p-5">
            <p style={{ fontSize: "2rem", fontWeight: 700, color: INK.primary }}>{data.safetyQualityCorrelation.r == null ? "—" : `r = ${data.safetyQualityCorrelation.r.toFixed(2)}`}</p>
            <p style={{ fontSize: "0.8125rem", color: INK.secondary, marginTop: 6 }}>{data.safetyQualityCorrelation.note}</p>
            <p style={{ fontSize: "0.8125rem", fontWeight: 600, color: INK.primary, marginTop: 18, marginBottom: 6 }}>Incidents in the last 30 days</p>
            {data.incidentsByType.length === 0 ? (
              <p style={{ fontSize: "0.8125rem", color: INK.muted }}>No incidents recorded.</p>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(80, data.incidentsByType.length * 30)}>
                <BarChart data={data.incidentsByType} layout="vertical" margin={{ left: 10, right: 20 }}>
                  <XAxis type="number" allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="type" width={110} tick={AXIS} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: "#F9F6F5" }} contentStyle={{ fontSize: "0.8rem" }} />
                  <Bar dataKey="count" name="Incidents" fill="#A52A2A" barSize={14} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ══ Inventory intelligence ═══════════════════════════════════════════════════

function AbcXyzGrid({ matrix }: { matrix: InventoryIntelligence["abcXyzMatrix"] }) {
  const max = Math.max(1, ...matrix.map((c) => c.value));
  const hint: Record<string, string> = {
    AX: "Automate reorder", AY: "Forecast + buffer", AZ: "Manual review",
    BX: "Automate", BY: "Periodic review", BZ: "Order to demand",
    CX: "Bulk order", CY: "Periodic review", CZ: "Order on demand",
  };
  return (
    <div className="p-5">
      <div className="grid" style={{ gridTemplateColumns: "36px repeat(3, 1fr)", gap: 4 }}>
        <div />
        {["X · stable", "Y · variable", "Z · erratic"].map((h) => (
          <div key={h} style={{ fontSize: "0.72rem", color: INK.muted, textAlign: "center" }}>{h}</div>
        ))}
        {(["A", "B", "C"] as const).map((a) => (
          <div key={a} className="contents">
            <div style={{ fontSize: "0.8rem", fontWeight: 700, color: INK.secondary, display: "flex", alignItems: "center" }}>{a}</div>
            {(["X", "Y", "Z"] as const).map((x) => {
              const cell = matrix.find((m) => m.abc === a && m.xyz === x);
              const share = (cell?.value ?? 0) / max;
              return (
                <div key={x} title={`${a}${x}: ${cell?.count ?? 0} items, ${inr(cell?.value ?? 0)}/yr`}
                  style={{ borderRadius: 6, padding: "10px 8px", minHeight: 64, background: `rgba(165,42,42,${0.06 + 0.6 * share})`, color: share > 0.55 ? "#fff" : INK.primary }}>
                  <div style={{ fontSize: "1.05rem", fontWeight: 700 }}>{cell?.count ?? 0}</div>
                  <div style={{ fontSize: "0.68rem", opacity: 0.85 }}>{hint[`${a}${x}`]}</div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <p style={{ fontSize: "0.72rem", color: INK.muted, marginTop: 10 }}>
        Rows: share of consumption value (A = top 80%). Columns: week-to-week demand variability. Darker = more value.
      </p>
    </div>
  );
}

function ForecastPanel({ material, params }: { material: MaterialIntelligence; params: { historyDays: number; serviceLevel: number; defaultLeadTimeDays: number } }) {
  const { data, error, loading, reload } = useLoader<MaterialForecast>(
    () => getMaterialForecast(material.id, params), [material.id, params.historyDays, params.serviceLevel, params.defaultLeadTimeDays],
  );
  const demand = useMemo(() => {
    if (!data) return [];
    const hist = data.history.slice(-45).map((h) => ({ date: shortDate(h.date), actual: h.actual }));
    const fc = data.forecast.map((f) => ({ date: shortDate(f.date), forecast: f.forecast, band: [f.lower, f.upper] as [number, number] }));
    return [...hist, ...fc];
  }, [data]);
  if (loading) return <Skeleton lines={6} />;
  if (error || !data) return <ErrorState message={error ?? "No forecast"} onRetry={reload} />;
  const methodLabel = data.method === "HOLT" ? "Holt's linear smoothing" : data.method === "CROSTON_SBA" ? "Croston–SBA (intermittent demand)" : "Average (too little history)";
  return (
    <div className="p-5 grid grid-cols-1 xl:grid-cols-2 gap-6">
      <div>
        <p style={{ fontSize: "0.8375rem", fontWeight: 600, color: INK.primary }}>Daily demand: last 45 days and {data.forecast.length}-day forecast</p>
        <p style={{ fontSize: "0.74rem", color: INK.muted, marginBottom: 8 }}>
          Model: {methodLabel} · hold-out error {pct(data.totalError)} · shaded band = 80% prediction interval
        </p>
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={demand} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid stroke={INK.grid} vertical={false} />
            <XAxis dataKey="date" tick={AXIS} interval={9} tickLine={false} axisLine={{ stroke: "#E8E2E0" }} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ fontSize: "0.8rem" }} formatter={(v: unknown, n: string) => [Array.isArray(v) ? `${v[0]} – ${v[1]}` : String(v), n]} />
            <Legend wrapperStyle={{ fontSize: "0.75rem" }} />
            <Bar dataKey="actual" name={`Issued (${data.unit})`} fill="#BCAAA4" barSize={6} radius={[3, 3, 0, 0]} />
            <Area dataKey="band" name="80% interval" stroke="none" fill="#A52A2A" fillOpacity={0.12} />
            <Line dataKey="forecast" name="Forecast" stroke="#A52A2A" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div>
        <p style={{ fontSize: "0.8375rem", fontWeight: 600, color: INK.primary }}>Projected stock if nothing is ordered</p>
        <p style={{ fontSize: "0.74rem", color: INK.muted, marginBottom: 8 }}>
          Reorder point {data.reorderPoint} {data.unit} · safety stock {data.safetyStock} {data.unit}
        </p>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data.projectedStock.map((p) => ({ date: shortDate(p.date), stock: p.stock }))} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid stroke={INK.grid} vertical={false} />
            <XAxis dataKey="date" tick={AXIS} interval={6} tickLine={false} axisLine={{ stroke: "#E8E2E0" }} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ fontSize: "0.8rem" }} />
            <ReferenceLine y={data.reorderPoint} stroke="#E65100" strokeDasharray="5 4" label={{ value: "Reorder point", fontSize: 11, fill: INK.secondary, position: "insideTopRight" }} />
            <ReferenceLine y={data.safetyStock} stroke="#C0392B" strokeDasharray="2 3" label={{ value: "Safety stock", fontSize: 11, fill: INK.secondary, position: "insideBottomRight" }} />
            <Line dataKey="stock" name={`Stock (${data.unit})`} stroke="#1565C0" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function InventoryTab() {
  const [serviceLevel, setServiceLevel] = useState("0.95");
  const [historyDays, setHistoryDays] = useState("90");
  const [leadTime, setLeadTime] = useState("7");
  const [selected, setSelected] = useState<MaterialIntelligence | null>(null);
  const params = useMemo(
    () => ({ serviceLevel: Number(serviceLevel), historyDays: Number(historyDays), defaultLeadTimeDays: Number(leadTime) }),
    [serviceLevel, historyDays, leadTime],
  );
  const { data, error, loading, reload } = useLoader<InventoryIntelligence>(() => getInventoryIntelligence(params), [params]);

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
          <Select label="Service level (chance of no stock-out)" value={serviceLevel} onChange={setServiceLevel}
            options={[["0.9", "90%"], ["0.95", "95%"], ["0.98", "98%"], ["0.99", "99%"]].map(([value, label]) => ({ value, label }))} />
          <Select label="History used for forecasting" value={historyDays} onChange={setHistoryDays}
            options={[["60", "60 days"], ["90", "90 days"], ["180", "180 days"], ["365", "1 year"]].map(([value, label]) => ({ value, label }))} />
          <Select label="Default lead time (no supplier data)" value={leadTime} onChange={setLeadTime}
            options={["3", "7", "10", "14", "21", "30"].map((v) => ({ value: v, label: `${v} days` }))} />
          <button onClick={reload} className="flex items-center justify-center gap-2"
            style={{ padding: "0.55rem 1rem", borderRadius: "0.375rem", background: "#A52A2A", color: "#fff", border: "none", cursor: "pointer", fontSize: "0.8375rem", fontWeight: 600 }}>
            <RefreshCw size={14} /> Recalculate
          </button>
        </div>
      </Card>

      {loading && <Card><Skeleton lines={8} /></Card>}
      {!loading && (error || !data) && <Card><ErrorState message={error ?? "No data"} onRetry={reload} /></Card>}
      {!loading && data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <KPICard label="Critical items" value={data.summary.critical} sub="run out within lead time" icon={PackageX} accent="#C0392B" />
            <KPICard label="At reorder point" value={data.summary.reorder} sub={`of ${data.summary.materials} materials`} icon={AlertTriangle} accent="#E65100" />
            <KPICard label="Shortage value" value={inr(data.summary.shortageValue)} sub="uncovered lead-time demand" icon={IndianRupee} />
            <KPICard label="Excess stock" value={inr(data.summary.excessStockValue)} sub={`${data.summary.overstock} overstocked`} icon={IndianRupee} accent="#1565C0" />
            <KPICard label="Forecast accuracy" value={data.summary.forecastError == null ? "—" : pct(Math.max(0, 1 - data.summary.forecastError))} sub="on 14 unseen days" icon={Target} accent="#2E7D32" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2"><InsightList insights={data.insights} /></div>
            <Card>
              <CardHeader title="ABC × XYZ classification" subtitle="Where to focus planning effort" />
              <AbcXyzGrid matrix={data.abcXyzMatrix} />
            </Card>
          </div>

          <Card>
            <CardHeader title="Material planning table" subtitle="Click a row to see its demand forecast and projected stock" />
            {data.materials.length === 0 ? (
              <EmptyState title="No active materials" subtitle="Add materials and record stock issues to enable forecasting." />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="w-full" style={{ borderCollapse: "collapse", fontSize: "0.8rem" }}>
                  <thead>
                    <tr style={{ background: "#F9F6F5", color: INK.muted, textAlign: "left" }}>
                      {["Material", "Status", "Class", "Stock", "Forecast / day", "Days of cover", "Stock-out", "Lead time", "Reorder point", "Suggested order"].map((h) => (
                        <th key={h} style={{ padding: "0.6rem 0.75rem", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.materials.map((m) => (
                      <tr key={m.id} onClick={() => setSelected(selected?.id === m.id ? null : m)}
                        style={{ borderTop: "1px solid #F0ECEB", cursor: "pointer", background: selected?.id === m.id ? "#FBF3F2" : undefined }}>
                        <td style={{ padding: "0.55rem 0.75rem" }}><div style={{ fontWeight: 600, color: INK.primary }}>{m.name}</div><div style={{ color: INK.muted, fontSize: "0.72rem" }}>{m.code}</div></td>
                        <td style={{ padding: "0.55rem 0.75rem" }}><StockBadge status={m.status} /></td>
                        <td style={{ padding: "0.55rem 0.75rem", fontWeight: 600 }}>{m.abc}{m.xyz}</td>
                        <td style={{ padding: "0.55rem 0.75rem", whiteSpace: "nowrap" }}>{m.currentStock} {m.unit}{m.onOrder > 0 && <div style={{ color: INK.muted, fontSize: "0.72rem" }}>+{m.onOrder} on order</div>}</td>
                        <td style={{ padding: "0.55rem 0.75rem" }}>{m.forecastDailyDemand}</td>
                        <td style={{ padding: "0.55rem 0.75rem" }}>{m.daysOfCover ?? "—"}</td>
                        <td style={{ padding: "0.55rem 0.75rem", whiteSpace: "nowrap" }}>{m.predictedStockoutDate ? shortDate(m.predictedStockoutDate) : "—"}</td>
                        <td style={{ padding: "0.55rem 0.75rem", whiteSpace: "nowrap" }}>{m.leadTimeDays} d <span style={{ color: INK.muted, fontSize: "0.72rem" }}>({m.leadTimeSource})</span></td>
                        <td style={{ padding: "0.55rem 0.75rem" }}>{m.reorderPoint}</td>
                        <td style={{ padding: "0.55rem 0.75rem", fontWeight: 600, color: m.suggestedOrderQty > 0 ? "#A52A2A" : INK.muted }}>{m.suggestedOrderQty > 0 ? `${m.suggestedOrderQty} ${m.unit}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {selected && (
              <div style={{ borderTop: "1px solid #E8E2E0" }}>
                <div className="px-5 pt-4" style={{ fontSize: "0.9rem", fontWeight: 700, color: INK.primary }}>{selected.name}</div>
                <ForecastPanel material={selected} params={params} />
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Unusual stock movements" subtitle="Robust z-score (median / MAD) against each material's own history; above 3.5 is flagged" />
            {data.anomalies.length === 0 ? (
              <EmptyState title="No unusual movements" subtitle="Every issue, scrap and adjustment is within the normal range for its material." />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="w-full" style={{ borderCollapse: "collapse", fontSize: "0.8rem" }}>
                  <thead><tr style={{ background: "#F9F6F5", color: INK.muted, textAlign: "left" }}>
                    {["Date", "Material", "Type", "Quantity", "Score", "Why flagged", "By"].map((h) => <th key={h} style={{ padding: "0.6rem 0.75rem", fontWeight: 600 }}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {data.anomalies.map((a) => (
                      <tr key={a.transactionId} style={{ borderTop: "1px solid #F0ECEB" }}>
                        <td style={{ padding: "0.55rem 0.75rem", whiteSpace: "nowrap" }}>{shortDate(a.date)}</td>
                        <td style={{ padding: "0.55rem 0.75rem", fontWeight: 600 }}>{a.materialName}</td>
                        <td style={{ padding: "0.55rem 0.75rem" }}>{a.type}</td>
                        <td style={{ padding: "0.55rem 0.75rem" }}>{a.quantity}</td>
                        <td style={{ padding: "0.55rem 0.75rem", fontWeight: 700, color: "#C0392B" }}>{a.robustZ}</td>
                        <td style={{ padding: "0.55rem 0.75rem", color: INK.secondary }}>{a.reason}</td>
                        <td style={{ padding: "0.55rem 0.75rem", color: INK.muted }}>{[a.performedBy, a.department].filter(Boolean).join(" · ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

// ══ Production performance ═══════════════════════════════════════════════════

function ProductionTab() {
  const [historyDays, setHistoryDays] = useState("90");
  const [department, setDepartment] = useState("");
  const [departments, setDepartments] = useState<string[]>([]);
  const { data, error, loading, reload } = useLoader<ProductionPerformance>(
    () => getProductionPerformance({ historyDays: Number(historyDays), ...(department ? { department } : {}) }),
    [historyDays, department],
  );
  useEffect(() => {
    if (data && !department) setDepartments(data.departments.map((d) => d.department));
  }, [data, department]);

  const pchart = useMemo(
    () => (data?.qualityControl.points ?? []).map((p) => ({
      date: shortDate(p.date),
      defectRate: +(p.proportion * 100).toFixed(2),
      ucl: +(p.ucl * 100).toFixed(2),
      lcl: +(p.lcl * 100).toFixed(2),
      flagged: p.outOfControl || p.shift,
    })),
    [data],
  );

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="p-4 grid grid-cols-2 md:grid-cols-3 gap-4 items-end">
          <Select label="Period" value={historyDays} onChange={setHistoryDays}
            options={[["30", "Last 30 days"], ["90", "Last 90 days"], ["180", "Last 180 days"]].map(([value, label]) => ({ value, label }))} />
          <Select label="Department" value={department} onChange={setDepartment}
            options={[{ value: "", label: "All departments" }, ...departments.map((d) => ({ value: d, label: d }))]} />
        </div>
      </Card>
      {loading && <Card><Skeleton lines={8} /></Card>}
      {!loading && (error || !data) && <Card><ErrorState message={error ?? "No data"} onRetry={reload} /></Card>}
      {!loading && data && data.overall.workOrders === 0 && (
        <Card><EmptyState title="No production data in this period" subtitle="Record work-order output to see OEE and quality control charts." /></Card>
      )}
      {!loading && data && data.overall.workOrders > 0 && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard label="OEE-style index" value={pct(data.overall.oee, 1)} sub="quality × attainment × schedule" icon={Gauge} />
            <KPICard label="Quality (first-pass yield)" value={pct(data.overall.quality, 1)} sub={`${data.overall.rejected + data.overall.scrap} defective units`} icon={CheckCircle2} accent="#2E7D32" />
            <KPICard label="Target attainment" value={pct(data.overall.attainment, 1)} sub="good output vs target" icon={TrendingUp} accent="#1565C0" />
            <KPICard label="Schedule adherence" value={pct(data.overall.schedule, 1)} sub="finished by due date" icon={Activity} accent="#E65100" />
          </div>
          <p style={{ fontSize: "0.74rem", color: INK.muted, marginTop: -8 }}>{data.overall.oeeNote}</p>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card>
              <CardHeader title="Department comparison" subtitle="The lowest bar in each group is that department's improvement lever" />
              <div className="p-4">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.departments.map((d) => ({ name: d.department, Quality: +(d.quality * 100).toFixed(1), Attainment: +(d.attainment * 100).toFixed(1), Schedule: +(d.schedule * 100).toFixed(1) }))} margin={{ left: -15, right: 10 }} barGap={2}>
                    <CartesianGrid stroke={INK.grid} vertical={false} />
                    <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={{ stroke: "#E8E2E0" }} />
                    <YAxis domain={[0, 100]} tick={AXIS} tickLine={false} axisLine={false} unit="%" />
                    <Tooltip cursor={{ fill: "#F9F6F5" }} contentStyle={{ fontSize: "0.8rem" }} formatter={(v: unknown) => `${v}%`} />
                    <Legend wrapperStyle={{ fontSize: "0.75rem" }} />
                    <Bar dataKey="Quality" fill={SERIES.quality} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Attainment" fill={SERIES.attainment} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Schedule" fill={SERIES.schedule} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <table className="w-full mt-3" style={{ fontSize: "0.78rem", borderCollapse: "collapse" }}>
                  <thead><tr style={{ color: INK.muted, textAlign: "left" }}>{["Rank", "Department", "Work orders", "OEE", "Quality", "Attainment", "Schedule"].map((h) => <th key={h} style={{ padding: "0.35rem 0.5rem", fontWeight: 600 }}>{h}</th>)}</tr></thead>
                  <tbody>{data.departments.map((d) => (
                    <tr key={d.department} style={{ borderTop: "1px solid #F0ECEB" }}>
                      <td style={{ padding: "0.35rem 0.5rem" }}>#{d.rank}</td>
                      <td style={{ padding: "0.35rem 0.5rem", fontWeight: 600 }}>{d.department}</td>
                      <td style={{ padding: "0.35rem 0.5rem" }}>{d.workOrders}</td>
                      <td style={{ padding: "0.35rem 0.5rem", fontWeight: 700 }}>{pct(d.oee, 1)}</td>
                      <td style={{ padding: "0.35rem 0.5rem" }}>{pct(d.quality, 1)}</td>
                      <td style={{ padding: "0.35rem 0.5rem" }}>{pct(d.attainment, 1)}</td>
                      <td style={{ padding: "0.35rem 0.5rem" }}>{pct(d.schedule, 1)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </Card>
            <Card>
              <CardHeader title="Statistical process control (p-chart)"
                subtitle={`Daily defect rate vs 3σ limits · centre ${(data.qualityControl.centerLine * 100).toFixed(2)}% · ${data.qualityControl.outOfControlDays} day(s) out of control${data.qualityControl.shiftDetected ? " · drift detected" : ""}`} />
              <div className="p-4">
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={pchart} margin={{ left: -15, right: 10 }}>
                    <CartesianGrid stroke={INK.grid} vertical={false} />
                    <XAxis dataKey="date" tick={AXIS} interval="preserveStartEnd" tickLine={false} axisLine={{ stroke: "#E8E2E0" }} />
                    <YAxis tick={AXIS} tickLine={false} axisLine={false} unit="%" />
                    <Tooltip contentStyle={{ fontSize: "0.8rem" }} formatter={(v: unknown) => `${v}%`} />
                    <Legend wrapperStyle={{ fontSize: "0.75rem" }} />
                    <ReferenceLine y={+(data.qualityControl.centerLine * 100).toFixed(2)} stroke={INK.muted} strokeDasharray="4 4" />
                    <Line type="stepAfter" dataKey="ucl" name="Upper control limit" stroke="#C0392B" strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
                    <Line type="stepAfter" dataKey="lcl" name="Lower control limit" stroke="#BCAAA4" strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
                    <Line dataKey="defectRate" name="Defect rate" stroke="#1565C0" strokeWidth={2}
                      dot={(props: { cx?: number; cy?: number; payload?: { flagged: boolean }; index?: number }) => (
                        <circle key={props.index} cx={props.cx} cy={props.cy} r={props.payload?.flagged ? 5 : 2.5}
                          fill={props.payload?.flagged ? "#C0392B" : "#1565C0"} stroke="#fff" strokeWidth={1.5} />
                      )} />
                  </LineChart>
                </ResponsiveContainer>
                <p style={{ fontSize: "0.72rem", color: INK.muted, marginTop: 6 }}>
                  Large red points: outside the limits, or part of a run of 7+ days above the centre line (process drift).
                </p>
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <InsightList insights={data.insights} />
            <Card>
              <CardHeader title="Weekly first-pass yield" subtitle="Good units ÷ all units produced" />
              <div className="p-4">
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={data.weeklyTrend.map((w) => ({ week: w.week.slice(5), yield: +(w.quality * 100).toFixed(2) }))} margin={{ left: -15, right: 10 }}>
                    <CartesianGrid stroke={INK.grid} vertical={false} />
                    <XAxis dataKey="week" tick={AXIS} tickLine={false} axisLine={{ stroke: "#E8E2E0" }} />
                    <YAxis tick={AXIS} tickLine={false} axisLine={false} unit="%" domain={["auto", 100]} />
                    <Tooltip contentStyle={{ fontSize: "0.8rem" }} formatter={(v: unknown) => `${v}%`} />
                    <Line dataKey="yield" name="First-pass yield" stroke="#A52A2A" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

// ══ Page ═══════════════════════════════════════════════════════════════════════

export function SmartAnalyticsPage() {
  const [tab, setTab] = useState("health");
  return (
    <div className="p-6">
      <PageHeader
        title="Smart Analytics"
        subtitle="Demand forecasting, dynamic reorder planning, anomaly detection, OEE and statistical quality control"
        actions={<span className="flex items-center gap-1.5" style={{ fontSize: "0.775rem", color: INK.muted }}><Sparkles size={14} color="#A52A2A" /> Computed live from ERP data</span>}
      />
      <div className="mb-5">
        <TabBar
          tabs={[
            { id: "health", label: "Plant Health" },
            { id: "inventory", label: "Inventory Intelligence" },
            { id: "production", label: "Production Performance" },
          ]}
          active={tab}
          onChange={setTab}
        />
      </div>
      {tab === "health" && <HealthTab />}
      {tab === "inventory" && <InventoryTab />}
      {tab === "production" && <ProductionTab />}
      <p className="flex items-center gap-1.5 mt-6" style={{ fontSize: "0.72rem", color: INK.muted }}>
        <ShieldAlert size={12} /> Recommendations support planners; purchase orders are never raised automatically.
      </p>
    </div>
  );
}
