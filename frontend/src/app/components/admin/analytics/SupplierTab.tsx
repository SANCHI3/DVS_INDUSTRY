import { useState } from "react";
import { AlertTriangle, IndianRupee, Target, Truck } from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Card, CardHeader, EmptyState, ErrorState, KPICard, Select, Skeleton } from "../../shared/UI";
import { getSupplierScorecard, type SupplierScorecard } from "../../../../lib/services/analytics.service";

import { SERIES, INK, AXIS, inr, InsightList, useLoader } from "./shared";

// ══ Supplier scorecard ════════════════════════════════════════════════════════

const GRADE_STYLE: Record<string, { bg: string; color: string }> = {
  A: { bg: "#E8F5E9", color: "#2E7D32" },
  B: { bg: "#E3F2FD", color: "#1565C0" },
  C: { bg: "#FFF3E0", color: "#E65100" },
  D: { bg: "#FFEBEE", color: "#C0392B" },
};

const percentText = (v: number | null) => (v == null ? "—" : `${v.toFixed(0)}%`);
const cell = { padding: "0.35rem 0.5rem" } as const;

export function SupplierTab() {
  const [historyDays, setHistoryDays] = useState("180");
  const { data, error, loading, reload } = useLoader<SupplierScorecard>(
    () => getSupplierScorecard({ historyDays: Number(historyDays) }),
    [historyDays],
  );

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="p-4 grid grid-cols-2 md:grid-cols-3 gap-4 items-end">
          <Select label="Period" value={historyDays} onChange={setHistoryDays}
            options={[["90", "Last 90 days"], ["180", "Last 180 days"], ["365", "Last 12 months"]].map(([value, label]) => ({ value, label }))} />
        </div>
      </Card>
      {loading && <Card><Skeleton lines={8} /></Card>}
      {!loading && (error || !data) && <Card><ErrorState message={error ?? "No data"} onRetry={reload} /></Card>}
      {!loading && data && data.summary.purchaseOrders === 0 && (
        <Card><EmptyState title="No purchase orders in this period" subtitle="Record purchase orders and their delivery dates to score suppliers." /></Card>
      )}
      {!loading && data && data.summary.purchaseOrders > 0 && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard label="On-time delivery" value={percentText(data.summary.overallOnTimeRate)} sub={`${data.summary.delivered} deliveries`} icon={Truck} />
            <KPICard label="Overdue open POs" value={String(data.summary.overdueOpen)} sub="past expected delivery" icon={AlertTriangle} accent="#C0392B" />
            <KPICard label="Suppliers scored" value={String(data.summary.suppliers)} sub={`${data.summary.purchaseOrders} purchase orders`} icon={Target} accent="#1565C0" />
            <KPICard label="Spend" value={inr(data.summary.spend)} sub={`last ${data.historyDays} days`} icon={IndianRupee} accent="#4E342E" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card>
              <CardHeader title="Supplier ranking" subtitle="Score = 40% on-time · 25% lead-time consistency · 20% fulfilment · 15% rating" />
              <div className="p-4 overflow-x-auto">
                <table className="w-full" style={{ fontSize: "0.78rem", borderCollapse: "collapse" }}>
                  <thead><tr style={{ color: INK.muted, textAlign: "left" }}>{["Supplier", "Grade", "Score", "On-time", "Avg delay", "Lead time (promised)", "Variability (CV)", "Fulfilment", "Overdue"].map((h) => <th key={h} style={{ ...cell, fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
                  <tbody>{data.suppliers.map((s) => {
                    const g = s.grade ? GRADE_STYLE[s.grade] : null;
                    return (
                      <tr key={s.supplierId} style={{ borderTop: "1px solid #F0ECEB" }}>
                        <td style={{ ...cell, fontWeight: 600 }}>{s.name}<span style={{ color: INK.muted, fontWeight: 400 }}> · {s.code}</span></td>
                        <td style={cell}>
                          {g ? <span style={{ background: g.bg, color: g.color, fontWeight: 700, padding: "0.1rem 0.5rem", borderRadius: 999 }}>{s.grade}</span>
                            : <span title="Fewer than 3 deliveries" style={{ color: INK.muted }}>New</span>}
                        </td>
                        <td style={{ ...cell, fontWeight: 700 }}>{s.score == null ? "—" : s.score.toFixed(0)}</td>
                        <td style={cell}>{percentText(s.onTimeRate)}</td>
                        <td style={cell}>{s.averageDelayDays == null ? "—" : `${s.averageDelayDays} d`}</td>
                        <td style={cell}>{s.leadTimeMeanDays == null ? "—" : `${s.leadTimeMeanDays} d`}{s.promisedLeadTimeDays != null && <span style={{ color: INK.muted }}> ({s.promisedLeadTimeDays} d)</span>}</td>
                        <td style={cell}>{s.leadTimeCv == null ? "—" : s.leadTimeCv.toFixed(2)}</td>
                        <td style={cell}>{percentText(s.fulfilmentRate)}</td>
                        <td style={{ ...cell, color: s.overdueOpen ? "#C0392B" : INK.secondary, fontWeight: s.overdueOpen ? 700 : 400 }}>{s.overdueOpen}</td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            </Card>
            <Card>
              <CardHeader title="On-time delivery by supplier" subtitle="Share of deliveries arriving by the promised date (1-day grace)" />
              <div className="p-4">
                <ResponsiveContainer width="100%" height={Math.max(180, data.suppliers.length * 36)}>
                  <BarChart layout="vertical" data={data.suppliers.filter((s) => s.onTimeRate != null).map((s) => ({ name: s.name, onTime: s.onTimeRate }))} margin={{ left: 10, right: 20 }}>
                    <CartesianGrid stroke={INK.grid} horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} tick={AXIS} tickLine={false} axisLine={false} unit="%" />
                    <YAxis type="category" dataKey="name" width={120} tick={AXIS} tickLine={false} axisLine={{ stroke: "#E8E2E0" }} />
                    <Tooltip cursor={{ fill: "#F9F6F5" }} contentStyle={{ fontSize: "0.8rem" }} formatter={(v: unknown) => `${v}%`} />
                    <ReferenceLine x={90} stroke={INK.muted} strokeDasharray="4 4" label={{ value: "90% target", fontSize: 10, fill: INK.muted, position: "top" }} />
                    <Bar dataKey="onTime" name="On-time" fill={SERIES.attainment} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
          {data.insights.length > 0 && <InsightList insights={data.insights} title="Supplier insights" />}
        </>
      )}
    </div>
  );
}
