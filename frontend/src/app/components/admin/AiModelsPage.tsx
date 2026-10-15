import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RefreshCw } from "lucide-react";
import { Btn, Card, CardHeader, PageHeader, StatusBadge } from "../shared/UI";
import { getModelResults, type ModelResultRow, type ModelResults } from "../../../lib/services/ai.service";

// Reference data-viz palette, first three categorical slots (validated for colour-blind separation).
const SERIES = { precision: "#2a78d6", recall: "#eb6834", f1: "#1baf7a", baseline: "#2a78d6", final: "#eb6834" };
const INK2 = "#665956";
const GRID = "#EEE4E0";

/** What each detector does. Descriptions only; every score shown comes from the results file. */
const MODEL_INFO: { task: string; detects: string; type: string; why: string }[] = [
  {
    task: "Fight",
    detects: "Fighting, punching or shoving between people",
    type: "R3D-18 3D CNN on 16-frame RGB clips + track-based interaction check",
    why: "A fight is motion over time; a single-frame detector like YOLO cannot tell punching from waving. The interaction check requires two people, close, moving agitatedly.",
  },
  {
    task: "Fall",
    detects: "A person falling to the ground, and staying down",
    type: "YOLOv8-Pose skeletons + box features → temporal CNN + BiGRU",
    why: "The speed and direction of the body's collapse separates a fall from sitting or lying down; the old box rule missed most falls.",
  },
  {
    task: "Fire",
    detects: "Visible flames",
    type: "YOLOv8n fine-tuned on fire/smoke + learned verifier (gradient boosting)",
    why: "YOLO alone raised alarms on orange objects and lights; the verifier checks flicker, colour and texture over time.",
  },
  {
    task: "Smoke",
    detects: "Smoke",
    type: "YOLOv8n fine-tuned on fire/smoke + learned verifier",
    why: "Same detector as fire; smoke must also grow or drift compared with the scene seconds earlier.",
  },
  {
    task: "Unusual activity",
    detects: "Motion unlike the camera's normal activity (events nobody labelled)",
    type: "Optical flow + background subtraction → denoising autoencoder (unsupervised)",
    why: "Needs only normal footage to train; a safety net for events without a dedicated model. Capped at MEDIUM severity.",
  },
];

const OTHER_COMPONENTS = [
  { name: "People and object detection", type: "YOLOv8n (COCO-pretrained) + ByteTrack tracking", note: "Pretrained model; no evaluation file in this project." },
  { name: "Lingering, restricted area, crowd", type: "Geometric rules on tracks inside camera zones", note: "Rule-based; no learned score." },
  { name: "Alert summaries", type: "LLM (OpenAI-compatible API), validated, with built-in text fallback", note: "Rewrites text only; cannot change type, severity or confidence." },
];

const PIPELINE = [
  ["Camera or demo video", "10 frames/s, 640×480"],
  ["YOLOv8n + ByteTrack", "people and objects, tracked"],
  ["Detectors", "rules · fight · fall · fire/smoke · unusual activity"],
  ["Event confirmation", "N-of-M persistence, severity, one incident per event"],
  ["Dashboard + alert", "live stream, pop-up, LLM summary"],
];

const fmt = (v: number | null | undefined, digits = 2) => (v == null ? "—" : v.toFixed(digits));

function RoleBadge({ role }: { role: ModelResultRow["role"] }) {
  const map = { final: ["Deployed", "#2E7D32", "#E8F5E9"], baseline: ["Baseline", "#1565C0", "#E8F0FE"], alternative: ["Alternative", "#7A6C6A", "#F3EFEE"] } as const;
  const [label, color, background] = map[role];
  return <span className="rounded-full px-2 py-0.5" style={{ color, background, fontSize: "0.68rem", fontWeight: 600, whiteSpace: "nowrap" }}>{label}</span>;
}

export function AiModelsPage() {
  const [data, setData] = useState<ModelResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    getModelResults()
      .then(setData)
      .catch((err: { response?: { status?: number } }) =>
        setError(err?.response?.status === 403 ? "Model results are available to administrators and managers." : "Model results could not be loaded."))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const rows = data?.models?.rows ?? [];
  const pairs = data?.models?.comparisons ?? [];
  const find = (task: string, model: string) => rows.find((r) => r.task === task && r.model === model);
  const finals = pairs.map((p) => find(p.task, p.final)).filter((r): r is ModelResultRow => !!r);
  const scoreData = finals.map((r) => ({ task: r.task, Precision: r.precision, Recall: r.recall, F1: r.f1 }));
  const compareData = pairs.map((p) => ({ task: p.task, Baseline: find(p.task, p.baseline)?.f1 ?? null, Final: find(p.task, p.final)?.f1 ?? null, baselineName: p.baseline, finalName: p.final }));
  const bench = data?.benchmark;
  const devices = bench ? Object.keys(bench.runs) : [];
  const stageLabels: [string, string][] = [["yolo_detect", "YOLOv8n detection"], ["bytetrack", "Tracking"], ["rule_engine", "Rules"], ["fight", "Fight"], ["fire_smoke", "Fire/smoke"], ["fall", "Fall"], ["anomaly", "Unusual activity"], ["cycle_total", "Whole frame"]];

  return (
    <main className="min-h-full px-4 py-5 sm:px-6 lg:px-8" style={{ background: "#FAF8F7" }}>
      <div className="mx-auto max-w-[1500px] space-y-5">
        <PageHeader
          title="AI Models"
          subtitle="What each CCTV model detects and how well it scored on held-out test videos. Every number is read from the evaluation results generated from the training metrics files (docs/RESULTS.md)."
          actions={<Btn variant="secondary" size="sm" onClick={load}><RefreshCw size={14} /> Refresh</Btn>}
        />

        {loading && <Card><div className="p-6" style={{ color: "#837572", fontSize: "0.85rem" }}>Loading model results…</div></Card>}
        {error && <Card><div className="p-6" style={{ color: "#C0392B", fontSize: "0.85rem" }}>{error}</div></Card>}
        {!loading && !error && !data?.models && (
          <Card><div className="p-6" style={{ color: "#837572", fontSize: "0.85rem" }}>No results file found. Generate it with <code>cd perception-service && python -m evaluation.run_all</code>.</div></Card>
        )}

        <Card style={{ borderRadius: "0.75rem" }}>
          <CardHeader title="Detection pipeline" subtitle="YOLO finds and tracks people; dedicated models decide what is happening" />
          <div className="flex flex-col items-stretch gap-2 p-5 lg:flex-row lg:items-center">
            {PIPELINE.map(([title, sub], i) => (
              <div key={title} className="flex flex-1 flex-col items-stretch gap-2 lg:flex-row lg:items-center">
                <div className="flex-1 rounded-lg px-3 py-3 text-center" style={{ background: i === 2 ? "#FBECEA" : "#FCFAF9", border: `1px solid ${i === 2 ? "#E8C4BE" : GRID}` }}>
                  <p style={{ color: "#302725", fontSize: "0.8rem", fontWeight: 700 }}>{title}</p>
                  <p style={{ color: "#837572", fontSize: "0.7rem" }}>{sub}</p>
                </div>
                {i < PIPELINE.length - 1 && <span className="text-center" style={{ color: "#A52A2A", fontWeight: 700 }} aria-hidden>{"→"}</span>}
              </div>
            ))}
          </div>
        </Card>

        {data?.models && (
          <>
            <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {MODEL_INFO.map((info) => {
                const pair = pairs.find((p) => p.task === info.task);
                const final = pair ? find(info.task, pair.final) : undefined;
                const base = pair ? find(info.task, pair.baseline) : undefined;
                return (
                  <Card key={info.task} style={{ borderRadius: "0.75rem" }}>
                    <div className="space-y-2 p-5">
                      <div className="flex items-center justify-between gap-2">
                        <h3 style={{ color: "#302725", fontSize: "0.95rem", fontWeight: 700 }}>{info.task}</h3>
                        {final && <span style={{ color: "#A52A2A", fontSize: "1.1rem", fontWeight: 800 }}>F1 {fmt(final.f1)}</span>}
                      </div>
                      <p style={{ color: "#4A3F3D", fontSize: "0.78rem" }}><strong>Detects:</strong> {info.detects}</p>
                      <p style={{ color: "#4A3F3D", fontSize: "0.78rem" }}><strong>Model:</strong> {info.type}</p>
                      <p style={{ color: "#837572", fontSize: "0.75rem", lineHeight: 1.5 }}>{info.why}</p>
                      {final && (
                        <p style={{ color: INK2, fontSize: "0.74rem" }}>
                          Precision {fmt(final.precision)} · Recall {fmt(final.recall)}{final.auc != null ? ` · AUC ${fmt(final.auc)}` : ""} · {final.false_alarms} false alarms on {final.test_size} evaluated videos
                          {base && <> · baseline ({base.model}) F1 {fmt(base.f1)}</>}
                        </p>
                      )}
                    </div>
                  </Card>
                );
              })}
              <Card style={{ borderRadius: "0.75rem" }}>
                <div className="space-y-2 p-5">
                  <h3 style={{ color: "#302725", fontSize: "0.95rem", fontWeight: 700 }}>Other components</h3>
                  {OTHER_COMPONENTS.map((c) => (
                    <div key={c.name} style={{ fontSize: "0.76rem" }}>
                      <p style={{ color: "#4A3F3D" }}><strong>{c.name}:</strong> {c.type}</p>
                      <p style={{ color: "#837572" }}>{c.note}</p>
                    </div>
                  ))}
                </div>
              </Card>
            </section>

            <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              <Card style={{ borderRadius: "0.75rem" }}>
                <CardHeader title="Deployed model per task" subtitle="Precision, recall and F1 on test data (protocols differ per task)" />
                <div className="h-72 p-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={scoreData} barGap={2} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke={GRID} />
                      <XAxis dataKey="task" tick={{ fill: INK2, fontSize: 11 }} axisLine={{ stroke: GRID }} tickLine={false} />
                      <YAxis domain={[0, 1]} tick={{ fill: INK2, fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip formatter={(v: number) => v.toFixed(2)} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="Precision" fill={SERIES.precision} radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Recall" fill={SERIES.recall} radius={[4, 4, 0, 0]} />
                      <Bar dataKey="F1" fill={SERIES.f1} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              <Card style={{ borderRadius: "0.75rem" }}>
                <CardHeader title="Baseline vs deployed model" subtitle="F1 on the same test videos; hover for model names" />
                <div className="h-72 p-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={compareData} barGap={2} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke={GRID} />
                      <XAxis dataKey="task" tick={{ fill: INK2, fontSize: 11 }} axisLine={{ stroke: GRID }} tickLine={false} />
                      <YAxis domain={[0, 1]} tick={{ fill: INK2, fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip formatter={(v: number, name: string, item: { payload?: { baselineName: string; finalName: string } }) => [v.toFixed(2), name === "Baseline" ? item.payload?.baselineName : item.payload?.finalName]} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="Baseline" fill={SERIES.baseline} radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Final" name="Deployed" fill={SERIES.final} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </section>

            <Card style={{ borderRadius: "0.75rem", overflow: "hidden" }}>
              <CardHeader title="All evaluation results" subtitle={`${rows.length} rows from perception-service/models/*.json · generated ${new Date(data.models.generated_at).toLocaleString("en-IN")}`} />
              <div className="overflow-x-auto">
                <table className="w-full" style={{ fontSize: "0.76rem", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#FAF8F7", color: INK2, textAlign: "left" }}>
                      {["Task", "Model", "Role", "Precision", "Recall", "F1", "AUC", "False alarms", "Test size", "Protocol"].map((h) => <th key={h} className="px-3 py-2" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={`${r.task}-${r.model}`} style={{ borderTop: `1px solid ${GRID}` }}>
                        <td className="px-3 py-2" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{r.task}</td>
                        <td className="px-3 py-2" title={r.note || undefined}>{r.model}</td>
                        <td className="px-3 py-2"><RoleBadge role={r.role} /></td>
                        <td className="px-3 py-2">{fmt(r.precision)}</td>
                        <td className="px-3 py-2">{fmt(r.recall)}</td>
                        <td className="px-3 py-2" style={{ fontWeight: 700 }}>{fmt(r.f1)}</td>
                        <td className="px-3 py-2">{fmt(r.auc)}</td>
                        <td className="px-3 py-2">{r.false_alarms ?? "—"}</td>
                        <td className="px-3 py-2">{r.test_size ?? "—"}</td>
                        <td className="px-3 py-2" style={{ color: "#837572", minWidth: "16rem" }}>{r.protocol}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}

        {!loading && !error && (
          <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Card style={{ borderRadius: "0.75rem" }}>
              <CardHeader title="Speed" subtitle={bench ? `Average ms each stage adds per processed frame · ${bench.hardware.gpu ?? "no GPU"} · measured ${new Date(bench.run_at).toLocaleDateString("en-IN")}` : "Not measured yet"} />
              <div className="p-5">
                {!bench ? <p style={{ color: "#837572", fontSize: "0.8rem" }}>Run <code>python -m evaluation.benchmark</code> in perception-service to measure.</p> : (
                  <table className="w-full" style={{ fontSize: "0.78rem" }}>
                    <thead><tr style={{ color: INK2, textAlign: "left" }}><th className="py-1">Stage</th>{devices.map((d) => <th key={d} className="py-1 text-right">{d.toUpperCase()} ms</th>)}</tr></thead>
                    <tbody>
                      {stageLabels.map(([key, label]) => (
                        <tr key={key} style={{ borderTop: `1px solid ${GRID}`, fontWeight: key === "cycle_total" ? 700 : 400 }}>
                          <td className="py-1.5">{label}</td>
                          {devices.map((d) => <td key={d} className="py-1.5 text-right">{fmt(bench.runs[d].stages[key]?.mean_ms_per_cycle, 1)}</td>)}
                        </tr>
                      ))}
                      <tr style={{ borderTop: `1px solid ${GRID}` }}>
                        <td className="py-1.5">Frames/s achieved (target {bench.detection_fps})</td>
                        {devices.map((d) => <td key={d} className="py-1.5 text-right" style={{ fontWeight: 700 }}>{fmt(bench.runs[d].cycles_per_s, 1)}</td>)}
                      </tr>
                    </tbody>
                  </table>
                )}
              </div>
            </Card>
            <Card style={{ borderRadius: "0.75rem" }}>
              <CardHeader title="False alarms on normal footage" subtitle="Incidents per hour on footage with no real incidents, before vs after the false-positive fixes" actions={!data?.falseAlarms ? <StatusBadge status="neutral" label="Pending" /> : undefined} />
              <div className="p-5">
                {!data?.falseAlarms ? (
                  <p style={{ color: "#837572", fontSize: "0.8rem", lineHeight: 1.6 }}>No long normal-activity recording has been measured yet, so no rate is shown. Record 10–15 minutes of ordinary activity from the camera and run <code>python -m evaluation.false_alarms --video recording.mp4</code>.</p>
                ) : (() => {
                  const fa = data.falseAlarms;
                  const types = Array.from(new Set([...Object.keys(fa.before?.dashboard ?? {}), ...Object.keys(fa.after.dashboard)]));
                  const perHour = (n: number) => (n * 60 / fa.footage_minutes).toFixed(1);
                  return (
                    <table className="w-full" style={{ fontSize: "0.78rem" }}>
                      <thead><tr style={{ color: INK2, textAlign: "left" }}><th className="py-1">Event</th><th className="py-1 text-right">Before / h</th><th className="py-1 text-right">After / h</th></tr></thead>
                      <tbody>
                        {types.length === 0 && <tr><td colSpan={3} className="py-2" style={{ color: "#837572" }}>No incidents in either run ({fa.footage_minutes.toFixed(1)} min).</td></tr>}
                        {types.map((t) => <tr key={t} style={{ borderTop: `1px solid ${GRID}` }}><td className="py-1.5">{t}</td><td className="py-1.5 text-right">{fa.before ? perHour(fa.before.dashboard[t] ?? 0) : "—"}</td><td className="py-1.5 text-right" style={{ fontWeight: 700 }}>{perHour(fa.after.dashboard[t] ?? 0)}</td></tr>)}
                      </tbody>
                    </table>
                  );
                })()}
              </div>
            </Card>
          </section>
        )}
      </div>
    </main>
  );
}
