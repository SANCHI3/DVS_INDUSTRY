import { useState } from "react";
import { Edit2, Plus, Save, Target, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardHeader, Btn } from "../../shared/UI";
import { describeApiError, isApiError } from "../../../../lib/api";
import {
  deleteProductionTarget, getMonthlyPerformance, saveProductionTarget, type MonthlyPerformance,
  type ProductionTargetDto, type ThresholdCheck,
} from "../../../../lib/services/production.service";
import { useApiData } from "../../../../lib/useApiData";
import type { ProductionPermissions } from "../../../../lib/workforce";
import { DialogFrame, Field, InlineNotice, LoadingLine, PrimaryButton, SecondaryButton, filterStyle, inputStyle } from "../workforce/formControls";

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y!, m! - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

export function currentMonth(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const qty = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 3 });
const pct = (n: number | null) => (n === null ? "N/A" : `${n.toFixed(1)}%`);

const PACE = {
  MET: { label: "Target met", bg: "#E8F5E9", color: "#2E7D32" },
  ON_TRACK: { label: "On track", bg: "#E8F5E9", color: "#2E7D32" },
  BEHIND: { label: "Behind pace", bg: "#FFEBEE", color: "#C0392B" },
  NOT_STARTED: { label: "Month not started", bg: "#F5F5F5", color: "#7A6C6A" },
} as const;

function CheckBadge({ check }: { check: ThresholdCheck }) {
  if (check === null) return <span style={{ fontSize: "0.72rem", color: "#9A8A88" }}>Not enough data</span>;
  const met = check === "MET";
  return (
    <span className="px-2 py-0.5 rounded-full" style={{ fontSize: "0.7rem", fontWeight: 600, background: met ? "#E8F5E9" : "#FFEBEE", color: met ? "#2E7D32" : "#C0392B" }}>
      {met ? "Within target" : "Outside target"}
    </span>
  );
}

// ── Edit dialog ──────────────────────────────────────────────────────────────

interface FormState { outputTarget: string; unit: string; completion: string; rejection: string; efficiency: string; notes: string }

export function validateTargetForm(f: FormState): Partial<Record<keyof FormState, string>> {
  const e: Partial<Record<keyof FormState, string>> = {};
  const t = f.outputTarget.trim();
  if (!t) e.outputTarget = "Enter the output target for the month.";
  else if (!/^\d{1,11}(\.\d{1,3})?$/.test(t)) e.outputTarget = "Enter a number with up to 3 decimals.";
  else if (Number(t) <= 0) e.outputTarget = "The target must be greater than 0.";
  if (!f.unit.trim()) e.unit = "Enter a unit, e.g. pcs.";
  const percentOk = (key: "completion" | "rejection" | "efficiency") => {
    const v = f[key].trim();
    if (v === "") return;
    const n = Number(v);
    if (Number.isNaN(n)) e[key] = "Enter a number.";
    else if (n < 0 || n > 100) e[key] = "Enter a percentage from 0 to 100.";
  };
  percentOk("completion"); percentOk("rejection"); percentOk("efficiency");
  return e;
}

function TargetDialog({ month, target, canDelete, onClose, onSaved }: {
  month: string;
  target: ProductionTargetDto | null;
  canDelete: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [f, setF] = useState<FormState>({
    outputTarget: target ? String(target.outputTarget) : "",
    unit: target?.unit ?? "pcs",
    completion: target?.targetCompletionRate == null ? "" : String(target.targetCompletionRate),
    rejection: target?.maxRejectionRate == null ? "" : String(target.maxRejectionRate),
    efficiency: target?.targetEmployeeEfficiency == null ? "" : String(target.targetEmployeeEfficiency),
    notes: target?.notes ?? "",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof FormState, v: string) => { setF((x) => ({ ...x, [k]: v })); setErrors((x) => ({ ...x, [k]: undefined })); };
  const optional = (v: string) => (v.trim() === "" ? null : Number(v));

  async function save() {
    if (saving) return;
    const found = validateTargetForm(f);
    setErrors(found);
    if (Object.values(found).some(Boolean)) { setError("Please correct the highlighted fields."); return; }
    setSaving(true);
    setError(null);
    try {
      await saveProductionTarget(month, {
        outputTarget: f.outputTarget.trim(),
        unit: f.unit.trim(),
        targetCompletionRate: optional(f.completion),
        maxRejectionRate: optional(f.rejection),
        targetEmployeeEfficiency: optional(f.efficiency),
        notes: f.notes.trim() === "" ? null : f.notes.trim(),
        expectedUpdatedAt: target?.updatedAt ?? null,
      });
      onSaved(`Target for ${monthLabel(month)} saved.`);
    } catch (err) {
      setError(describeApiError(err, "save the target") + (isApiError(err) && err.status === 409 ? " Close this dialog to load the latest values." : ""));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm(`Remove the target and thresholds for ${monthLabel(month)}? Recorded production is not affected.`)) return;
    setSaving(true);
    try {
      await deleteProductionTarget(month);
      onSaved(`Target for ${monthLabel(month)} removed.`);
    } catch (err) {
      setError(describeApiError(err, "remove the target"));
    } finally {
      setSaving(false);
    }
  }

  const pctField = (key: "completion" | "rejection" | "efficiency", id: string, label: string, hint: string) => (
    <Field id={id} label={label} error={errors[key]} hint={hint}>
      <input id={id} type="number" inputMode="decimal" min={0} max={100} step="0.1" value={f[key]} onChange={(e) => set(key, e.target.value)}
        style={inputStyle} placeholder="Not set" aria-invalid={!!errors[key]} aria-describedby={`${id}-msg`} />
    </Field>
  );

  return (
    <DialogFrame
      width="max-w-xl"
      title={target ? `Edit Target — ${monthLabel(month)}` : `Set Target — ${monthLabel(month)}`}
      subtitle="Targets are what recorded output is compared against. They never change the recorded figures."
      onClose={onClose}
      footer={
        <>
          {error && <div className="flex-1 min-w-[14rem]"><InlineNotice tone="error">{error}</InlineNotice></div>}
          {target && canDelete && (
            <SecondaryButton onClick={() => void remove()} disabled={saving}><Trash2 size={14} /> Remove target</SecondaryButton>
          )}
          <SecondaryButton onClick={onClose} disabled={saving}>Cancel</SecondaryButton>
          <PrimaryButton onClick={() => void save()} disabled={saving}><Save size={14} /> {saving ? "Saving…" : "Save Target"}</PrimaryButton>
        </>
      }
    >
      <form noValidate onSubmit={(e) => { e.preventDefault(); void save(); }} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field id="tgt-output" label="Monthly output target" required error={errors.outputTarget} hint="Good quantity planned for the whole month">
          <input id="tgt-output" type="number" inputMode="decimal" min={0} step="any" value={f.outputTarget} onChange={(e) => set("outputTarget", e.target.value)}
            style={inputStyle} aria-invalid={!!errors.outputTarget} aria-describedby="tgt-output-msg" />
        </Field>
        <Field id="tgt-unit" label="Unit" required error={errors.unit}>
          <input id="tgt-unit" value={f.unit} maxLength={20} onChange={(e) => set("unit", e.target.value)} style={inputStyle} aria-invalid={!!errors.unit} />
        </Field>
        {pctField("completion", "tgt-completion", "Target completion rate (%)", "Work orders: produced ÷ target, at least")}
        {pctField("rejection", "tgt-rejection", "Maximum rejection rate (%)", "Rejected ÷ (good + rejected), at most")}
        {pctField("efficiency", "tgt-efficiency", "Target employee efficiency (%)", "Average of recorded employee output, at least")}
        <div className="sm:col-span-2">
          <Field id="tgt-notes" label="Notes">
            <input id="tgt-notes" value={f.notes} maxLength={500} onChange={(e) => set("notes", e.target.value)} style={inputStyle} placeholder="Optional, e.g. reason for the target" />
          </Field>
        </div>
      </form>
    </DialogFrame>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────

export function MonthlyTargetCard({ month, onMonthChange, perms, onSaved }: {
  month: string;
  onMonthChange: (month: string) => void;
  perms: ProductionPermissions;
  /** A target was saved or removed; refresh anything that compares against it. */
  onSaved: () => void;
}) {
  const perf = useApiData<MonthlyPerformance>(() => getMonthlyPerformance(month), [month], "load the monthly target");
  const [editing, setEditing] = useState(false);
  const p = perf.data;
  const t = p?.target ?? null;

  return (
    <Card className="mb-5">
      <CardHeader
        title="Monthly Target"
        subtitle="Set by management; compared with output actually recorded against work orders"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input type="month" aria-label="Target month" value={month} onChange={(e) => e.target.value && onMonthChange(e.target.value)} style={filterStyle} />
            {perms.editTargets && p && (
              <Btn size="sm" onClick={() => setEditing(true)}>{t ? <><Edit2 size={13} /> Edit target</> : <><Plus size={13} /> Set target</>}</Btn>
            )}
          </div>
        }
      />
      <div className="p-5">
        {perf.loading ? <LoadingLine text={perf.waking ? "The server is starting up…" : "Loading the monthly target…"} />
          : perf.error ? <InlineNotice tone="error" onRetry={perf.reload}>{perf.error}</InlineNotice>
            : p && (
              <>
                {!t && (
                  <div className="mb-4 flex items-center gap-2" style={{ fontSize: "0.8375rem", color: "#7A6C6A" }}>
                    <Target size={16} /> No target has been set for {monthLabel(month)}.
                    {perms.editTargets ? " Use “Set target” to add one." : " An administrator or manager can set one."}
                  </div>
                )}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                  <div>
                    <p style={{ fontSize: "0.72rem", color: "#7A6C6A", textTransform: "uppercase" }}>Target</p>
                    <p style={{ fontSize: "1.25rem", fontWeight: 700 }}>{t ? `${qty(t.outputTarget)} ${t.unit}` : "Not set"}</p>
                  </div>
                  <div>
                    <p style={{ fontSize: "0.72rem", color: "#7A6C6A", textTransform: "uppercase" }}>Recorded output</p>
                    <p style={{ fontSize: "1.25rem", fontWeight: 700 }}>{qty(p.actual.goodQty)}{t ? ` ${t.unit}` : ""}</p>
                    <p style={{ fontSize: "0.72rem", color: "#9A8A88" }}>{p.actual.outputRecords} output record{p.actual.outputRecords === 1 ? "" : "s"}</p>
                  </div>
                  <div>
                    <p style={{ fontSize: "0.72rem", color: "#7A6C6A", textTransform: "uppercase" }}>Expected by now</p>
                    <p style={{ fontSize: "1.25rem", fontWeight: 700 }}>{p.progress.expectedToDate === null ? "N/A" : qty(p.progress.expectedToDate)}</p>
                    <p style={{ fontSize: "0.72rem", color: "#9A8A88" }}>Day {p.progress.daysElapsed} of {p.progress.daysInMonth}</p>
                  </div>
                  <div>
                    <p style={{ fontSize: "0.72rem", color: "#7A6C6A", textTransform: "uppercase" }}>Progress</p>
                    <p style={{ fontSize: "1.25rem", fontWeight: 700 }}>{pct(p.progress.progressPct)}</p>
                    {p.progress.pace && (
                      <span className="px-2 py-0.5 rounded-full" style={{ fontSize: "0.7rem", fontWeight: 600, background: PACE[p.progress.pace].bg, color: PACE[p.progress.pace].color }}>
                        {PACE[p.progress.pace].label}
                      </span>
                    )}
                  </div>
                </div>
                {t && (
                  <div role="progressbar" aria-label="Progress towards the monthly target" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, p.progress.progressPct ?? 0)}
                    style={{ height: 8, background: "#F0ECEB", borderRadius: 999, overflow: "hidden", marginBottom: "1rem" }}>
                    <div style={{ width: `${Math.min(100, p.progress.progressPct ?? 0)}%`, height: "100%", background: p.progress.pace === "BEHIND" ? "#C0392B" : "#2E7D32" }} />
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3" style={{ fontSize: "0.8rem" }}>
                  <div className="p-3 rounded-md" style={{ background: "#F9F6F5" }}>
                    <p style={{ color: "#7A6C6A" }}>Completion rate target</p>
                    <p style={{ fontWeight: 600 }}>{t?.targetCompletionRate == null ? "Not set" : `At least ${t.targetCompletionRate}%`}</p>
                    <p style={{ fontSize: "0.72rem", color: "#9A8A88" }}>Compared on the Completion Rate card</p>
                  </div>
                  <div className="p-3 rounded-md" style={{ background: "#F9F6F5" }}>
                    <p style={{ color: "#7A6C6A" }}>Rejection rate limit</p>
                    <p style={{ fontWeight: 600 }}>{t?.maxRejectionRate == null ? "Not set" : `At most ${t.maxRejectionRate}%`} · actual {pct(p.actual.rejectionRate)}</p>
                    {t?.maxRejectionRate != null && <CheckBadge check={p.checks.rejection} />}
                  </div>
                  <div className="p-3 rounded-md" style={{ background: "#F9F6F5" }}>
                    <p style={{ color: "#7A6C6A" }}>Employee efficiency target</p>
                    <p style={{ fontWeight: 600 }}>{t?.targetEmployeeEfficiency == null ? "Not set" : `At least ${t.targetEmployeeEfficiency}%`} · actual {pct(p.actual.employeeEfficiency)}</p>
                    {t?.targetEmployeeEfficiency != null && <CheckBadge check={p.checks.employeeEfficiency} />}
                  </div>
                </div>
                {t && (
                  <p className="mt-3" style={{ fontSize: "0.72rem", color: "#9A8A88" }}>
                    {t.notes ? `${t.notes} · ` : ""}Last saved {new Date(t.updatedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                  </p>
                )}
              </>
            )}
      </div>
      {editing && p && (
        <TargetDialog
          month={month}
          target={t}
          canDelete={perms.deleteTargets}
          onClose={() => { setEditing(false); perf.reload(); }}
          onSaved={(message) => { toast.success(message); setEditing(false); perf.reload(); onSaved(); }}
        />
      )}
    </Card>
  );
}
