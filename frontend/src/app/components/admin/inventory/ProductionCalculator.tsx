import { useState, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie,
  Cell, RadialBarChart, RadialBar,
} from "recharts";
import { Play, Zap, Package, RotateCcw, Info } from "lucide-react";

/* ── Types ── */
interface CalcInputs {
  partName: string;
  partNumber: string;
  materialType: string;
  weightReceived: string;
  materialPerPart: string;
  batchQty: string;
  costPerKg: string;
  operator: string;
}

interface CalcResult {
  partsProduced: number;
  materialConsumed: number;
  scrapGenerated: number;
  materialRemaining: number;
  utilizationPct: number;
  efficiencyRating: string;
  efficiencyColor: string;
  inventoryBalance: number;
  batchLimited: boolean;
  timestamp: string;
}

export interface InventoryMaterial {
  id: string;
  name: string;
  category: string;
  thickness: string;
  qty: number;
  unit: string;
  cost: number | null;
  threshold: number;
  location: string;
  status: string;
  apiId: number;
}

/* ── Helpers ── */
function getEfficiencyRating(pct: number): { label: string; color: string } {
  if (pct >= 95) return { label: "Excellent", color: "#2E7D32" };
  if (pct >= 88) return { label: "Good", color: "#1565C0" };
  if (pct >= 78) return { label: "Acceptable", color: "#F57F17" };
  return { label: "Needs Review", color: "#C0392B" };
}

/* ══════════════════════════════════════════════
   PRODUCTION CALCULATOR COMPONENT
══════════════════════════════════════════════ */
export function ProductionCalculator({ materials }: { materials: InventoryMaterial[] }) {
  const [inputs, setInputs] = useState<CalcInputs>({
    partName: "", partNumber: "", materialType: "",
    weightReceived: "", materialPerPart: "", batchQty: "",
    costPerKg: "", operator: "",
  });
  const [result, setResult] = useState<CalcResult | null>(null);
  const [running, setRunning] = useState(false);
  const [errors, setErrors] = useState<Partial<CalcInputs>>({});
  const resultRef = useRef<HTMLDivElement>(null);

  const setField = (k: keyof CalcInputs) => (v: string) => {
    setInputs((p) => ({ ...p, [k]: v }));
    setErrors((p) => ({ ...p, [k]: undefined }));
  };

  const validate = (): boolean => {
    const e: Partial<CalcInputs> = {};
    if (!inputs.partName.trim()) e.partName = "Required";
    if (!inputs.partNumber.trim()) e.partNumber = "Required";
    const wp = parseFloat(inputs.weightReceived);
    if (!inputs.weightReceived || isNaN(wp) || wp <= 0) e.weightReceived = "Enter a valid weight";
    const m = parseFloat(inputs.materialPerPart);
    if (!inputs.materialPerPart || isNaN(m) || m <= 0) e.materialPerPart = "Enter a valid weight";
    if (m >= wp) e.materialPerPart = "Must be less than total weight received";
    const cost = parseFloat(inputs.costPerKg);
    if (!inputs.costPerKg || isNaN(cost) || cost <= 0) e.costPerKg = "Enter cost per kg";
    if (!inputs.operator.trim()) e.operator = "Required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const runCalculation = async () => {
    if (!validate()) return;
    setRunning(true);
    setResult(null);

    await new Promise((r) => setTimeout(r, 1400));

    const Wp = parseFloat(inputs.weightReceived);   // Raw material received (kg)
    const M = parseFloat(inputs.materialPerPart);   // Material per part (kg)
    const batchQty = inputs.batchQty ? parseInt(inputs.batchQty) : null;

    // ── Core production model ──
    const maxPartsFromMaterial = Math.floor(Wp / M);
    const partsProduced = batchQty ? Math.min(batchQty, maxPartsFromMaterial) : maxPartsFromMaterial;
    const materialConsumed = parseFloat((partsProduced * M).toFixed(3));
    const scrapGenerated = parseFloat((Wp - materialConsumed).toFixed(3));
    const materialRemaining = parseFloat((Wp - materialConsumed).toFixed(3));
    const utilizationPct = parseFloat(((materialConsumed / Wp) * 100).toFixed(2));

    const material = materials.find((item) => item.name === inputs.materialType);
    const invBefore = material?.qty ?? 0;
    const inventoryBalance = Math.max(0, parseFloat((invBefore - Wp).toFixed(2)));

    const { label: efficiencyRating, color: efficiencyColor } = getEfficiencyRating(utilizationPct);
    const batchLimited = !!(batchQty && batchQty < maxPartsFromMaterial);

    const res: CalcResult = {
      partsProduced, materialConsumed, scrapGenerated, materialRemaining,
      utilizationPct, efficiencyRating, efficiencyColor,
      inventoryBalance, batchLimited,
      timestamp: new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }),
    };

    setResult(res);
    setRunning(false);
    resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const resetAll = () => {
    setInputs({ partName: "", partNumber: "", materialType: materials[0]?.name ?? "", weightReceived: "", materialPerPart: "", batchQty: "", costPerKg: "", operator: "" });
    setResult(null);
    setErrors({});
  };

  /* ── Chart data from result ── */
  const pieData = result
    ? [
        { name: "Consumed", value: parseFloat(result.materialConsumed.toFixed(2)), color: "#A52A2A" },
        { name: "Scrap", value: parseFloat(result.scrapGenerated.toFixed(2)), color: "#D4793A" },
      ]
    : [];

  const barData = result
    ? [
        { label: "Received", value: parseFloat(inputs.weightReceived), color: "#4E342E" },
        { label: "Consumed", value: result.materialConsumed, color: "#A52A2A" },
        { label: "Scrap", value: result.scrapGenerated, color: "#D4793A" },
      ]
    : [];

  const gaugeData = result
    ? [{ name: "Utilization", value: result.utilizationPct, fill: result.efficiencyColor }]
    : [];

  /* ─────── FIELD COMPONENT ─────── */
  const Field = ({
    label, required, error, children,
  }: { label: string; required?: boolean; error?: string; children: React.ReactNode }) => (
    <div>
      <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#4A4A4A", marginBottom: "0.35rem", letterSpacing: "0.02em" }}>
        {label}{required && <span style={{ color: "#C0392B" }}> *</span>}
      </label>
      {children}
      {error && <p style={{ fontSize: "0.7rem", color: "#C0392B", marginTop: "0.25rem" }}>{error}</p>}
    </div>
  );

  const inputStyle = (hasError?: string): React.CSSProperties => ({
    width: "100%",
    padding: "0.6rem 0.875rem",
    border: `1.5px solid ${hasError ? "#C0392B" : "#E0D8D6"}`,
    borderRadius: "0.5rem",
    fontSize: "0.875rem",
    color: "#1C1C1C",
    background: "#FAFAFA",
    outline: "none",
    transition: "border-color 0.15s, box-shadow 0.15s",
    fontFamily: "'Inter', sans-serif",
  });

  const onFocus = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
    e.target.style.borderColor = "#A52A2A";
    e.target.style.boxShadow = "0 0 0 3px rgba(165,42,42,0.1)";
  };
  const onBlur = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
    e.target.style.borderColor = errors[e.target.name as keyof CalcInputs] ? "#C0392B" : "#E0D8D6";
    e.target.style.boxShadow = "none";
  };

  return (
    <div>
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
        {/* ════ LEFT: INPUT FORM ════ */}
        <div className="xl:col-span-2">
          <div
            className="rounded-xl overflow-hidden sticky top-6"
            style={{ background: "#fff", border: "1px solid #E8E2E0", boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}
          >
            {/* Form header */}
            <div
              className="px-6 py-4 flex items-center gap-3"
              style={{ background: "linear-gradient(135deg, #A52A2A 0%, #7B1F1F 100%)", borderBottom: "none" }}
            >
              <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "rgba(255,255,255,0.15)" }}>
                <Play size={16} color="#fff" />
              </div>
              <div>
                <p style={{ fontSize: "0.9rem", fontWeight: 700, color: "#fff" }}>Production Run Setup</p>
                <p style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.75)" }}>Configure parameters · System calculates automatically</p>
              </div>
            </div>

            <div className="p-6 flex flex-col gap-4">
              {/* Section: Part Info */}
              <div>
                <p style={{ fontSize: "0.67rem", fontWeight: 700, color: "#A52A2A", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.875rem" }}>
                  Part Information
                </p>
                <div className="flex flex-col gap-3.5">
                  <Field label="Part Name" required error={errors.partName}>
                    <input
                      name="partName"
                      placeholder="e.g. Motor Housing Cover"
                      value={inputs.partName}
                      onChange={(e) => setField("partName")(e.target.value)}
                      style={inputStyle(errors.partName)}
                      onFocus={onFocus} onBlur={onBlur}
                    />
                  </Field>
                  <Field label="Part Number" required error={errors.partNumber}>
                    <input
                      name="partNumber"
                      placeholder="e.g. MH-2024-A"
                      value={inputs.partNumber}
                      onChange={(e) => setField("partNumber")(e.target.value)}
                      style={inputStyle(errors.partNumber)}
                      onFocus={onFocus} onBlur={onBlur}
                    />
                  </Field>
                </div>
              </div>

              {/* Divider */}
              <div style={{ height: "1px", background: "#F0ECEB" }} />

              {/* Section: Material */}
              <div>
                <p style={{ fontSize: "0.67rem", fontWeight: 700, color: "#A52A2A", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.875rem" }}>
                  Raw Material Parameters
                </p>
                <div className="flex flex-col gap-3.5">
                  <Field label="Raw Material Type" required>
                    <select
                      name="materialType"
                      value={inputs.materialType}
                      onChange={(e) => setField("materialType")(e.target.value)}
                      disabled={materials.length === 0}
                      style={{ ...inputStyle(), cursor: "pointer" }}
                      onFocus={onFocus} onBlur={onBlur}
                    >
                      {materials.length === 0 ? <option value="">No materials yet</option> : materials.map((m) => <option key={m.apiId} value={m.name}>{m.name}</option>)}
                    </select>
                    {/* Live stock badge */}
                    {materials.find((m) => m.name === inputs.materialType) && (
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <Package size={11} color="#7A6C6A" />
                        <span style={{ fontSize: "0.7rem", color: "#7A6C6A" }}>
                          Current stock: {materials.find((m) => m.name === inputs.materialType)?.qty} {materials.find((m) => m.name === inputs.materialType)?.unit}
                        </span>
                      </div>
                    )}
                  </Field>

                  <Field label="Raw Material Weight Received (Wp) — kg" required error={errors.weightReceived}>
                    <input
                      name="weightReceived"
                      type="number" min="0" step="0.1"
                      placeholder="Total kg received for this run"
                      value={inputs.weightReceived}
                      onChange={(e) => setField("weightReceived")(e.target.value)}
                      style={inputStyle(errors.weightReceived)}
                      onFocus={onFocus} onBlur={onBlur}
                    />
                  </Field>

                  <Field label="Material Required Per Part (M) — kg" required error={errors.materialPerPart}>
                    <input
                      name="materialPerPart"
                      type="number" min="0" step="0.001"
                      placeholder="kg of material per finished part"
                      value={inputs.materialPerPart}
                      onChange={(e) => setField("materialPerPart")(e.target.value)}
                      style={inputStyle(errors.materialPerPart)}
                      onFocus={onFocus} onBlur={onBlur}
                    />
                  </Field>

                  <Field label="Production Batch Quantity (optional)">
                    <input
                      name="batchQty"
                      type="number" min="1"
                      placeholder="Leave blank to maximise output"
                      value={inputs.batchQty}
                      onChange={(e) => setField("batchQty")(e.target.value)}
                      style={inputStyle()}
                      onFocus={onFocus} onBlur={onBlur}
                    />
                    <p style={{ fontSize: "0.68rem", color: "#9A8A88", marginTop: "0.25rem" }}>
                      If set, production stops when batch target is reached.
                    </p>
                  </Field>

                  <Field label="Material Cost Per Kg (₹)" required error={errors.costPerKg}>
                    <input
                      name="costPerKg"
                      type="number" min="0" step="0.5"
                      placeholder="Enter cost per kg"
                      value={inputs.costPerKg}
                      onChange={(e) => setField("costPerKg")(e.target.value)}
                      style={inputStyle(errors.costPerKg)}
                      onFocus={onFocus} onBlur={onBlur}
                    />
                  </Field>
                </div>
              </div>

              {/* Divider */}
              <div style={{ height: "1px", background: "#F0ECEB" }} />

              {/* Section: Operator */}
              <div>
                <p style={{ fontSize: "0.67rem", fontWeight: 700, color: "#A52A2A", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.875rem" }}>
                  Production Assignment
                </p>
                <Field label="Operator / Production Lead" required error={errors.operator}>
                  <select
                    name="operator"
                    value={inputs.operator}
                    onChange={(e) => setField("operator")(e.target.value)}
                    style={{ ...inputStyle(errors.operator), cursor: "pointer" }}
                    onFocus={onFocus} onBlur={onBlur}
                  >
                    <option value="">Select operator</option>
                    <option value="Not assigned">Not assigned</option>
                  </select>
                </Field>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2.5 mt-1">
                <button
                  onClick={runCalculation}
                  disabled={running}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl"
                  style={{
                    background: running ? "#D4BFBB" : "#A52A2A",
                    color: "#fff", fontWeight: 700, fontSize: "0.9rem",
                    border: "none", cursor: running ? "not-allowed" : "pointer",
                    boxShadow: running ? "none" : "0 4px 14px rgba(165,42,42,0.35)",
                    transition: "all 0.2s",
                  }}
                  onMouseEnter={(e) => { if (!running) e.currentTarget.style.background = "#8B2222"; }}
                  onMouseLeave={(e) => { if (!running) e.currentTarget.style.background = "#A52A2A"; }}
                >
                  {running ? (
                    <><div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> Processing…</>
                  ) : (
                    <><Play size={16} /> Run Production</>
                  )}
                </button>
                <button
                  onClick={resetAll}
                  className="flex items-center justify-center gap-1 px-4 py-3 rounded-xl"
                  style={{ background: "#F5F0EF", color: "#4E342E", border: "1px solid #E0D8D6", cursor: "pointer" }}
                >
                  <RotateCcw size={15} />
                </button>
              </div>

              {/* Info note */}
              <div className="flex items-start gap-2 p-3 rounded-lg" style={{ background: "#FDF5F5", border: "1px solid #FFCDD2" }}>
                <Info size={13} color="#A52A2A" style={{ flexShrink: 0, marginTop: "0.1rem" }} />
                <p style={{ fontSize: "0.72rem", color: "#7A3030", lineHeight: 1.55 }}>
                  Scrap is calculated automatically from your material inputs. No manual entry required.
                  The system applies the DVS Industries production model internally.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ════ RIGHT: RESULTS ════ */}
        <div className="xl:col-span-3 flex flex-col gap-5" ref={resultRef}>
          {!result && !running && (
            <div
              className="flex flex-col items-center justify-center rounded-xl py-24"
              style={{ background: "#fff", border: "2px dashed #E0D8D6" }}
            >
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: "#FDF5F5" }}>
                <Zap size={28} color="#A52A2A" />
              </div>
              <p style={{ fontSize: "1rem", fontWeight: 700, color: "#1C1C1C" }}>Ready to Calculate</p>
              <p style={{ fontSize: "0.8375rem", color: "#9A8A88", marginTop: "0.4rem", textAlign: "center", maxWidth: "300px" }}>
                Fill in the production parameters on the left and click "Run Production" to generate results.
              </p>
            </div>
          )}

          {running && (
            <div className="flex flex-col items-center justify-center rounded-xl py-24" style={{ background: "#fff", border: "1px solid #E8E2E0" }}>
              <div className="w-12 h-12 rounded-full border-4 border-red-100 border-t-red-700 animate-spin mb-4" />
              <p style={{ fontSize: "0.9rem", fontWeight: 600, color: "#A52A2A" }}>Running Production Simulation…</p>
              <p style={{ fontSize: "0.775rem", color: "#9A8A88", marginTop: "0.3rem" }}>Calculating parts, scrap, utilization, and inventory impact</p>
            </div>
          )}

          {result && (
            <>
              {/* ── KPI Cards ── */}
              <div>
                <p style={{ fontSize: "0.67rem", fontWeight: 700, color: "#A52A2A", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.875rem" }}>
                  Production Results — {inputs.partName} ({inputs.partNumber})
                </p>
                {result.batchLimited && (
                  <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg mb-3" style={{ background: "#E3F2FD", border: "1px solid #90CAF9" }}>
                    <Info size={14} color="#1565C0" />
                    <p style={{ fontSize: "0.775rem", color: "#1565C0" }}>
                      Production stopped at batch target ({inputs.batchQty} pcs). Material capacity was higher.
                    </p>
                  </div>
                )}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {[
                    { label: "Parts Produced", value: result.partsProduced.toLocaleString(), unit: "pcs", color: "#A52A2A", icon: "🔩" },
                    { label: "Scrap Generated", value: result.scrapGenerated.toFixed(2), unit: "kg", color: "#D4793A", icon: "♻" },
                    { label: "Material Utilization", value: `${result.utilizationPct}%`, unit: result.efficiencyRating, color: result.efficiencyColor, icon: "📊" },
                    { label: "Material Consumed", value: result.materialConsumed.toFixed(2), unit: "kg", color: "#4E342E", icon: "⚙" },
                    { label: "Inventory Balance Preview", value: result.inventoryBalance.toFixed(1), unit: "kg", color: "#4E342E", icon: "📦" },
                  ].map((kpi) => (
                    <div
                      key={kpi.label}
                      className="p-4 rounded-xl"
                      style={{ background: "#fff", border: "1px solid #E8E2E0", boxShadow: "0 1px 6px rgba(0,0,0,0.05)" }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span style={{ fontSize: "0.8125rem" }}>{kpi.icon}</span>
                        <span
                          className="px-2 py-0.5 rounded-full"
                          style={{ fontSize: "0.65rem", fontWeight: 700, background: `${kpi.color}14`, color: kpi.color }}
                        >
                          {kpi.unit}
                        </span>
                      </div>
                      <p style={{ fontSize: "1.5rem", fontWeight: 800, color: kpi.color, lineHeight: 1 }}>{kpi.value}</p>
                      <p style={{ fontSize: "0.72rem", color: "#7A6C6A", marginTop: "0.35rem", letterSpacing: "0.02em" }}>{kpi.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Visual Analytics ── */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Material Usage Bar */}
                <div className="p-5 rounded-xl" style={{ background: "#fff", border: "1px solid #E8E2E0", boxShadow: "0 1px 6px rgba(0,0,0,0.05)" }}>
                  <p style={{ fontSize: "0.8rem", fontWeight: 700, color: "#1C1C1C", marginBottom: "0.25rem" }}>Material Usage Breakdown</p>
                  <p style={{ fontSize: "0.72rem", color: "#9A8A88", marginBottom: "1rem" }}>kg breakdown — received vs consumed vs scrap</p>
                  <ResponsiveContainer width="100%" height={150}>
                    <BarChart data={barData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#F0ECEB" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 9, fill: "#9A8A88" }} axisLine={false} tickLine={false} unit=" kg" />
                      <YAxis type="category" dataKey="label" tick={{ fontSize: 10, fill: "#4A4A4A", fontWeight: 500 }} axisLine={false} tickLine={false} width={65} />
                      <Tooltip contentStyle={{ fontSize: "0.8rem", border: "1px solid #E8E2E0" }} formatter={(v: number) => [`${v.toFixed(2)} kg`]} />
                      {barData.map((entry, i) => (
                        <Bar key={i} dataKey="value" fill={entry.color} radius={[0, 4, 4, 0]} name={entry.label} />
                      ))}
                      <Bar dataKey="value" fill="#A52A2A" radius={[0, 4, 4, 0]}>
                        {barData.map((entry, index) => (
                          <Cell key={index} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Pie: Usable vs Scrap */}
                <div className="p-5 rounded-xl" style={{ background: "#fff", border: "1px solid #E8E2E0", boxShadow: "0 1px 6px rgba(0,0,0,0.05)" }}>
                  <p style={{ fontSize: "0.8rem", fontWeight: 700, color: "#1C1C1C", marginBottom: "0.25rem" }}>Usable vs Scrap</p>
                  <p style={{ fontSize: "0.72rem", color: "#9A8A88", marginBottom: "0.5rem" }}>Material distribution</p>
                  <div className="flex items-center gap-4">
                    <ResponsiveContainer width={110} height={110}>
                      <PieChart>
                        <Pie data={pieData} dataKey="value" cx="50%" cy="50%" innerRadius={30} outerRadius={50} paddingAngle={2}>
                          {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                        </Pie>
                        <Tooltip formatter={(v: number) => [`${v.toFixed(2)} kg`]} contentStyle={{ fontSize: "0.75rem" }} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex flex-col gap-2">
                      {pieData.map((d) => (
                        <div key={d.name} className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ background: d.color }} />
                          <div>
                            <p style={{ fontSize: "0.72rem", fontWeight: 600, color: "#1C1C1C" }}>{d.name}</p>
                            <p style={{ fontSize: "0.8rem", fontWeight: 700, color: d.color }}>{d.value.toFixed(2)} kg</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Utilization Gauge */}
                <div className="p-5 rounded-xl" style={{ background: "#fff", border: "1px solid #E8E2E0", boxShadow: "0 1px 6px rgba(0,0,0,0.05)" }}>
                  <p style={{ fontSize: "0.8rem", fontWeight: 700, color: "#1C1C1C", marginBottom: "0.25rem" }}>Material Utilization Gauge</p>
                  <p style={{ fontSize: "0.72rem", color: "#9A8A88", marginBottom: "0.75rem" }}>Production efficiency indicator</p>
                  <div className="relative flex items-center justify-center">
                    <ResponsiveContainer width="100%" height={120}>
                      <RadialBarChart cx="50%" cy="80%" innerRadius="70%" outerRadius="100%" startAngle={180} endAngle={0} data={gaugeData}>
                        <RadialBar dataKey="value" background={{ fill: "#F0ECEB" }} cornerRadius={6} />
                      </RadialBarChart>
                    </ResponsiveContainer>
                    <div className="absolute bottom-2 flex flex-col items-center">
                      <p style={{ fontSize: "1.6rem", fontWeight: 800, color: result.efficiencyColor, lineHeight: 1 }}>{result.utilizationPct}%</p>
                      <p style={{ fontSize: "0.72rem", fontWeight: 700, color: result.efficiencyColor }}>{result.efficiencyRating}</p>
                    </div>
                  </div>
                  {/* Legend */}
                  <div className="flex justify-between mt-2">
                    {[["< 78%", "#C0392B", "Review"], ["78–88%", "#F57F17", "Acceptable"], ["88–95%", "#1565C0", "Good"], ["> 95%", "#2E7D32", "Excellent"]].map(([range, color, label]) => (
                      <div key={label} className="text-center">
                        <div className="w-2 h-2 rounded-full mx-auto mb-0.5" style={{ background: color }} />
                        <p style={{ fontSize: "0.58rem", color: "#9A8A88" }}>{range}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Inventory Balance */}
                <div className="p-5 rounded-xl" style={{ background: "#fff", border: "1px solid #E8E2E0", boxShadow: "0 1px 6px rgba(0,0,0,0.05)" }}>
                  <p style={{ fontSize: "0.8rem", fontWeight: 700, color: "#1C1C1C", marginBottom: "0.25rem" }}>Inventory Impact</p>
                  <p style={{ fontSize: "0.72rem", color: "#9A8A88", marginBottom: "1rem" }}>Stock before and after production run</p>
                  <div className="flex flex-col gap-3">
                    {[
                      { label: "Before Production", value: materials.find((m) => m.name === inputs.materialType)?.qty ?? 0, color: "#4E342E" },
                      { label: "Material Consumed", value: parseFloat(inputs.weightReceived), color: "#A52A2A", negative: true },
                      { label: "After Production Preview", value: result.inventoryBalance, color: "#4E342E" },
                    ].map((row) => {
                      const maxVal = materials.find((m) => m.name === inputs.materialType)?.qty ?? 1;
                      return (
                        <div key={row.label}>
                          <div className="flex justify-between mb-1">
                            <span style={{ fontSize: "0.775rem", color: "#4A4A4A" }}>{row.label}</span>
                            <span style={{ fontSize: "0.8rem", fontWeight: 700, color: row.color }}>{row.value.toFixed(1)} kg</span>
                          </div>
                          <div style={{ height: "7px", background: "#F0ECEB", borderRadius: "99px", overflow: "hidden" }}>
                            <div style={{ width: `${Math.min(100, (row.value / maxVal) * 100)}%`, height: "100%", background: row.color, borderRadius: "99px", transition: "width 0.6s ease" }} />
                          </div>
                        </div>
                      );
                    })}
                    <p style={{ fontSize: "0.72rem", color: "#7A6C6A" }}>Preview only. No inventory update was saved.</p>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl" style={{ background: "#F5F5F5", border: "1px solid #E8E2E0" }}>
                <p style={{ fontSize: "0.8rem", color: "#7A6C6A" }}>Production records, AI recommendations, and report generation are unavailable from the current inventory APIs.</p>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="mt-8 p-5 rounded-xl" style={{ background: "#F5F5F5", border: "1px solid #E8E2E0" }}>
        <p style={{ fontSize: "0.8rem", color: "#7A6C6A" }}>Production records are unavailable from the current inventory APIs.</p>
      </div>
    </div>
  );
}
