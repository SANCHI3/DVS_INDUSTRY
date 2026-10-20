import { useMemo, useState } from "react";
import { AlertTriangle, IndianRupee, PackageX, RefreshCw, Target } from "lucide-react";
import {
  Area, Bar, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Card, CardHeader, EmptyState, ErrorState, KPICard, Select, Skeleton } from "../../shared/UI";
import {
  getInventoryIntelligence, getMaterialForecast, type InventoryIntelligence,
  type MaterialForecast, type MaterialIntelligence,
} from "../../../../lib/services/analytics.service";

import { INK, AXIS, pct, inr, shortDate, StockBadge, InsightList, useLoader } from "./shared";

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

export function InventoryTab() {
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
