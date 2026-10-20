import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardHeader, ErrorState, Skeleton } from "../../shared/UI";
import { getPlantHealth, type PlantHealth } from "../../../../lib/services/analytics.service";

import { INK, AXIS, InsightList, useLoader } from "./shared";

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

export function HealthTab() {
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
