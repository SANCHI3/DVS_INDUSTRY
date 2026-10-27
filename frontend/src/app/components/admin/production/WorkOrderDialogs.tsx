import { useState } from "react";
import { AlertTriangle, Save, Trash2 } from "lucide-react";
import { describeApiError, isApiError } from "../../../../lib/api";
import type { DepartmentDto } from "../../../../lib/services/departments.service";
import {
  addOutput, createWorkOrder, deleteWorkOrder, updateWorkOrder, type WorkOrderDto, type WorkOrderPriority,
  type WorkOrderStatus,
} from "../../../../lib/services/production.service";
import { localIsoDate } from "../../../../lib/workforce";
import { DialogFrame, Field, InlineNotice, PrimaryButton, SecondaryButton, inputStyle } from "../workforce/formControls";

/** Mirrors ALLOWED_TRANSITIONS in backend/src/services/production.service.ts. */
export const NEXT_STATUSES: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  DRAFT: ["RELEASED", "CANCELLED"],
  RELEASED: ["IN_PROGRESS", "ON_HOLD", "CANCELLED"],
  IN_PROGRESS: ["ON_HOLD", "COMPLETED", "CANCELLED"],
  ON_HOLD: ["RELEASED", "IN_PROGRESS", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export const STATUS_ACTION: Record<WorkOrderStatus, string> = {
  DRAFT: "Draft", RELEASED: "Release", IN_PROGRESS: "Start", ON_HOLD: "Put on hold", COMPLETED: "Complete", CANCELLED: "Cancel",
};

/** Output may only be recorded on these (backend rule 8). */
export const ACCEPTS_OUTPUT: WorkOrderStatus[] = ["RELEASED", "IN_PROGRESS"];

const QTY = /^\d{1,11}(\.\d{1,3})?$/;

export function validateQty(value: string, label: string, opts: { required: boolean; positive: boolean }): string | undefined {
  const v = value.trim();
  if (v === "") return opts.required ? `${label} is required.` : undefined;
  if (!QTY.test(v)) return `${label} must be a number with up to 3 decimals.`;
  if (opts.positive && Number(v) <= 0) return `${label} must be greater than 0.`;
  return undefined;
}

// ── New / edit work order ────────────────────────────────────────────────────

/** Completed and cancelled orders are history; the backend refuses to delete a completed one */
export const CAN_DELETE = (s: WorkOrderStatus): boolean => s !== "COMPLETED";

const day = (iso: string | null): string => (iso ? localIsoDate(new Date(iso)) : "");

function initialForm(wo: WorkOrderDto | null) {
  return {
    product: wo?.product ?? "",
    targetQuantity: wo ? String(Number(wo.targetQuantity)) : "",
    unit: wo?.unit ?? "pcs",
    priority: (wo?.priority ?? "NORMAL") as WorkOrderPriority,
    departmentId: wo?.departmentId != null ? String(wo.departmentId) : "",
    scheduledStart: day(wo?.scheduledStart ?? null),
    scheduledEnd: day(wo?.scheduledEnd ?? null),
    notes: wo?.notes ?? "",
  };
}

/** Without `workOrder` it creates a Draft; with one it edits it (changed fields only). */
export function WorkOrderDialog({ departments, workOrder = null, onClose, onSaved }: {
  departments: DepartmentDto[];
  workOrder?: WorkOrderDto | null;
  onClose: () => void;
  onSaved: (wo: WorkOrderDto) => void;
}) {
  const editing = workOrder !== null;
  const [f, setF] = useState(() => initialForm(workOrder));
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => { setF((x) => ({ ...x, [k]: v })); setErrors((x) => ({ ...x, [k]: undefined })); };

  async function save() {
    if (saving) return;
    const e: Record<string, string | undefined> = {
      product: f.product.trim() ? undefined : "Product is required.",
      targetQuantity: validateQty(f.targetQuantity, "Target quantity", { required: true, positive: true }),
      unit: f.unit.trim() ? undefined : "Unit is required.",
      scheduledEnd: f.scheduledStart && f.scheduledEnd && f.scheduledEnd < f.scheduledStart ? "The end date must be on or after the start date." : undefined,
    };
    setErrors(e);
    if (Object.values(e).some(Boolean)) { setError("Please correct the highlighted fields."); return; }
    setSaving(true);
    setError(null);
    const dept = departments.find((d) => String(d.id) === f.departmentId);
    const values: Record<string, unknown> = {
      product: f.product.trim(),
      targetQuantity: f.targetQuantity.trim(),
      unit: f.unit.trim(),
      priority: f.priority,
      departmentId: dept?.id ?? null,
      departmentName: dept?.name ?? null,
      scheduledStart: f.scheduledStart || null,
      scheduledEnd: f.scheduledEnd || null,
      notes: f.notes.trim() || null,
    };
    try {
      if (workOrder === null) {
        onSaved(await createWorkOrder(values));
        return;
      }
      // Send only what changed, so nothing else on the order is touched
      const before = initialForm(workOrder);
      const patch: Record<string, unknown> = {};
      for (const k of Object.keys(before) as Array<keyof typeof before>) {
        const changed = k === "targetQuantity" ? Number(f[k]) !== Number(before[k]) : f[k].trim() !== before[k].trim();
        if (!changed) continue;
        if (k === "departmentId") { patch["departmentId"] = values["departmentId"]; patch["departmentName"] = values["departmentName"]; }
        else patch[k] = values[k];
      }
      if (Object.keys(patch).length === 0) { onClose(); return; }
      onSaved(await updateWorkOrder(workOrder.id, patch));
    } catch (err) {
      setError(describeApiError(err, editing ? `save ${workOrder.workOrderNumber}` : "create the work order"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogFrame
      width="max-w-xl"
      title={editing ? "Edit Work Order" : "New Work Order"}
      subtitle={editing ? `${workOrder.workOrderNumber} · status and recorded output are not changed here` : "Created as a Draft. Release it to start recording output."}
      onClose={onClose}
      footer={
        <>
          {error && <div className="flex-1 min-w-[14rem]"><InlineNotice tone="error">{error}</InlineNotice></div>}
          <SecondaryButton onClick={onClose} disabled={saving}>Cancel</SecondaryButton>
          <PrimaryButton onClick={() => void save()} disabled={saving}>
            <Save size={14} /> {editing ? (saving ? "Saving…" : "Save Changes") : saving ? "Creating…" : "Create Work Order"}
          </PrimaryButton>
        </>
      }
    >
      <form noValidate onSubmit={(e) => { e.preventDefault(); void save(); }} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <Field id="wo-product" label="Product" required error={errors.product}>
            <input id="wo-product" value={f.product} maxLength={200} onChange={(e) => set("product", e.target.value)} style={inputStyle} aria-invalid={!!errors.product} />
          </Field>
        </div>
        <Field id="wo-target" label="Target quantity" required error={errors.targetQuantity}>
          <input id="wo-target" type="number" inputMode="decimal" min={0} step="any" value={f.targetQuantity} onChange={(e) => set("targetQuantity", e.target.value)} style={inputStyle} aria-invalid={!!errors.targetQuantity} />
        </Field>
        <Field id="wo-unit" label="Unit" required error={errors.unit}>
          <input id="wo-unit" value={f.unit} maxLength={20} onChange={(e) => set("unit", e.target.value)} style={inputStyle} />
        </Field>
        <Field id="wo-priority" label="Priority">
          <select id="wo-priority" value={f.priority} onChange={(e) => set("priority", e.target.value)} style={inputStyle}>
            {["LOW", "NORMAL", "HIGH", "URGENT"].map((p) => <option key={p} value={p}>{p.charAt(0) + p.slice(1).toLowerCase()}</option>)}
          </select>
        </Field>
        <Field id="wo-dept" label="Department">
          <select id="wo-dept" value={f.departmentId} onChange={(e) => set("departmentId", e.target.value)} style={inputStyle}>
            <option value="">Unassigned</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field id="wo-start" label="Scheduled start">
          <input id="wo-start" type="date" value={f.scheduledStart} onChange={(e) => set("scheduledStart", e.target.value)} style={inputStyle} />
        </Field>
        <Field id="wo-end" label="Scheduled end" error={errors.scheduledEnd}>
          <input id="wo-end" type="date" value={f.scheduledEnd} onChange={(e) => set("scheduledEnd", e.target.value)} style={inputStyle} aria-invalid={!!errors.scheduledEnd} />
        </Field>
        <div className="sm:col-span-2">
          <Field id="wo-notes" label="Notes">
            <input id="wo-notes" value={f.notes} maxLength={1000} onChange={(e) => set("notes", e.target.value)} style={inputStyle} placeholder="Optional" />
          </Field>
        </div>
      </form>
    </DialogFrame>
  );
}

// ── Delete work order ────────────────────────────────────────────────────────

/** Soft delete (administrators). Output records are kept but no longer counted. */
export function DeleteWorkOrderDialog({ workOrder, onCancel, onDeleted, onStale }: {
  workOrder: WorkOrderDto;
  onCancel: () => void;
  onDeleted: (message: string) => void;
  /** Already deleted or missing: the list is out of date */
  onStale: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasOutput = workOrder._count.outputs > 0;

  async function remove() {
    if (deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteWorkOrder(workOrder.id);
      onDeleted(`${workOrder.workOrderNumber} was deleted.`);
    } catch (err) {
      if (isApiError(err) && err.status === 404) {
        setError(`${workOrder.workOrderNumber} no longer exists. It may have been deleted by someone else. The list will refresh.`);
        onStale();
      } else {
        setError(describeApiError(err, `delete ${workOrder.workOrderNumber}`));
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <DialogFrame
      width="max-w-md"
      title="Delete Work Order?"
      onClose={deleting ? () => undefined : onCancel}
      footer={
        <>
          <SecondaryButton onClick={onCancel} disabled={deleting}>Cancel</SecondaryButton>
          <button type="button" onClick={() => void remove()} disabled={deleting} className="flex items-center gap-1.5 px-4 py-2 rounded-md"
            style={{ background: "#C0392B", color: "#fff", fontSize: "0.875rem", fontWeight: 600, border: "none", opacity: deleting ? 0.6 : 1, cursor: deleting ? "not-allowed" : "pointer" }}>
            <Trash2 size={14} /> {deleting ? "Deleting…" : "Delete Work Order"}
          </button>
        </>
      }
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 p-3 rounded-md mb-3" style={{ background: "#F9F6F5", border: "1px solid #E8E2E0", fontSize: "0.875rem" }}>
        <dt style={{ color: "#7A6C6A" }}>Work order</dt><dd style={{ fontWeight: 600, fontFamily: "JetBrains Mono, monospace" }}>{workOrder.workOrderNumber}</dd>
        <dt style={{ color: "#7A6C6A" }}>Product</dt><dd style={{ fontWeight: 600 }}>{workOrder.product}</dd>
        <dt style={{ color: "#7A6C6A" }}>Status</dt><dd>{workOrder.status.replace("_", " ")}</dd>
      </dl>
      {hasOutput ? (
        <div className="flex items-start gap-2" style={{ color: "#8D5A00", fontSize: "0.8375rem" }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            It has {workOrder._count.outputs} output record{workOrder._count.outputs === 1 ? "" : "s"} ({Number(workOrder.producedQty).toLocaleString("en-IN")} {workOrder.unit} good).
            They are kept, but will no longer count in Company Performance totals.
          </span>
        </div>
      ) : (
        <p style={{ fontSize: "0.8375rem", color: "#4A4A4A" }}>It has no recorded output. The work order is removed from the list; the record is kept for the audit trail.</p>
      )}
      {error && <div className="mt-3"><InlineNotice tone="error">{error}</InlineNotice></div>}
    </DialogFrame>
  );
}

// ── Record output ────────────────────────────────────────────────────────────

export function RecordOutputDialog({ workOrder, onClose, onRecorded }: {
  workOrder: WorkOrderDto;
  onClose: () => void;
  onRecorded: (message: string) => void;
}) {
  const [f, setF] = useState({ goodQty: "", rejectedQty: "", scrapQty: "", remarks: "" });
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => { setF((x) => ({ ...x, [k]: v })); setErrors((x) => ({ ...x, [k]: undefined })); };

  async function save() {
    if (saving) return;
    const e = {
      goodQty: validateQty(f.goodQty, "Good quantity", { required: true, positive: true }),
      rejectedQty: validateQty(f.rejectedQty, "Rejected quantity", { required: false, positive: false }),
      scrapQty: validateQty(f.scrapQty, "Scrap quantity", { required: false, positive: false }),
    };
    setErrors(e);
    if (Object.values(e).some(Boolean)) { setError("Please correct the highlighted fields."); return; }
    setSaving(true);
    setError(null);
    try {
      await addOutput(workOrder.id, {
        goodQty: f.goodQty.trim(),
        rejectedQty: f.rejectedQty.trim() || "0",
        scrapQty: f.scrapQty.trim() || "0",
        remarks: f.remarks.trim() || null,
      });
      onRecorded(`Output recorded on ${workOrder.workOrderNumber}.`);
    } catch (err) {
      setError(describeApiError(err, "record output"));
    } finally {
      setSaving(false);
    }
  }

  const qtyField = (key: "goodQty" | "rejectedQty" | "scrapQty", label: string, required: boolean) => (
    <Field id={`out-${key}`} label={`${label} (${workOrder.unit})`} required={required} error={errors[key]}>
      <input id={`out-${key}`} type="number" inputMode="decimal" min={0} step="any" value={f[key]} onChange={(e) => set(key, e.target.value)}
        style={inputStyle} placeholder={required ? undefined : "0"} aria-invalid={!!errors[key]} />
    </Field>
  );

  return (
    <DialogFrame
      width="max-w-lg"
      title={`Record Output — ${workOrder.workOrderNumber}`}
      subtitle={`${workOrder.product} · ${workOrder.producedQty} of ${workOrder.targetQuantity} ${workOrder.unit} produced so far`}
      onClose={onClose}
      footer={
        <>
          {error && <div className="flex-1 min-w-[14rem]"><InlineNotice tone="error">{error}</InlineNotice></div>}
          <SecondaryButton onClick={onClose} disabled={saving}>Cancel</SecondaryButton>
          <PrimaryButton onClick={() => void save()} disabled={saving}><Save size={14} /> {saving ? "Saving…" : "Record Output"}</PrimaryButton>
        </>
      }
    >
      <form noValidate onSubmit={(e) => { e.preventDefault(); void save(); }} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {qtyField("goodQty", "Good", true)}
        {qtyField("rejectedQty", "Rejected", false)}
        {qtyField("scrapQty", "Scrap", false)}
        <div className="sm:col-span-3">
          <Field id="out-remarks" label="Remarks">
            <input id="out-remarks" value={f.remarks} maxLength={500} onChange={(e) => set("remarks", e.target.value)} style={inputStyle} placeholder="Optional" />
          </Field>
        </div>
      </form>
    </DialogFrame>
  );
}
