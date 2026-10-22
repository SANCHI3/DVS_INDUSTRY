import { useEffect, useMemo, useState } from "react";
import { Activity, CheckCircle2, Gauge, TrendingUp } from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Card, CardHeader, EmptyState, ErrorState, KPICard, Select, Skeleton } from "../../shared/UI";
import {
  getProductionPerformance, type ProductionPerformance,
} from "../../../../lib/services/analytics.service";

import { SERIES, INK, AXIS, pct, shortDate, InsightList, useLoader } from "./shared";

// ══ Production performance ═══════════════════════════════════════════════════

export function ProductionTab() {
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
