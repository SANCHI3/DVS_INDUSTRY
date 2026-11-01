import { useState } from "react";
import { CheckCircle2, Truck, AlertCircle, Factory, PackageCheck } from "lucide-react";
import { type ClientDto, type SupplierDto } from "../../../../lib/services/orders.service";
import { Modal } from "../../shared/Modal";
import { isApiError } from "../../../../lib/api";
import { formatINR } from "../../../../lib/format";
import { useApiData } from "../../../../lib/useApiData";
import { getClientOrderDetail } from "../../../../lib/services/orders.service";
import { dispatchReadiness } from "../../../../lib/dispatchReadiness";
import type { MaterialDto, PartSpecDto } from "../../../../lib/services/inventory.service";
import { quantityDue, receivedText } from "../../../../lib/materialUse";

/* ── Types ── */
export interface ClientOrder {
  id: string; client: string; product: string; qty: number;
  /** Set by the new-order form: the chosen client record. */
  clientId?: number;
  orderDate: string; requiredDate: string; status: string; value: string;
  dispatch?: string; delivery?: string;
  /** Days past the required-by date (0 = on time). */
  overdueDays?: number;
  /** Parts Master entry the order is for */
  partSpecId?: number | null;
  /** Linked work orders: how many, and how many are completed */
  workOrders?: { total: number; completed: number };
  _apiId?: number;
}
export interface SupplierOrder {
  id: string; supplier: string; material: string; qty: string;
  orderDate: string; expectedDel: string; actualDel: string; cost: string; status: string;
  /** Days past the expected delivery (0 = on time). */
  overdueDays?: number;
  /** Stock material this PO fills (receiving it adds to stock) */
  materialId?: number | null;
  /** Ordered and received so far, as numbers in the material's unit */
  orderedQty?: string | null;
  receivedQty?: string;
  unit?: string | null;
  _apiId?: number;
}

/* ── Helpers ── */
/** Today as YYYY-MM-DD in local time (the order date of a new order). */
function todayIso(): string {
  return new Date().toLocaleDateString("en-CA");
}

/** Inline message when a due date falls before the order date (today for new orders). */
export function dateBeforeOrderError(value: string, label: string): string {
  return value && value < todayIso() ? `${label} cannot be before the order date (today).` : "";
}

/** The server's reason in plain words, e.g. its field messages. */
function saveError(err: unknown, fallback: string): string {
  if (isApiError(err)) {
    if (Array.isArray(err.details) && err.details.length > 0) {
      return (err.details as { message?: string }[]).map((d) => d.message ?? "Please check the form").join(" ");
    }
    if (err.status < 500 && err.message) return err.message;
  }
  return err instanceof Error ? err.message : fallback;
}
export function parseMoney(value: string): string | null {
  const normalized = value.replace(/[₹,\s]/g, "");
  return normalized && /^\d+(\.\d{1,2})?$/.test(normalized) ? normalized : null;
}

export function parseQuantity(value: string): { quantity: string; unit: string | null } {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?$/);
  return { quantity: match?.[1] ?? value.trim(), unit: match?.[2] ?? null };
}

/* ── PO Creation Modal ── */
export function POModal({ prefill, suppliers, suppliersLoading, suppliersError, materials = [], onClose, onSubmit }: {
  prefill?: { material: string; qty: number; cost: number; supplier: string };
  suppliers: SupplierDto[];
  /** Stock materials; choosing one makes the delivery add to stock */
  materials?: MaterialDto[];
  suppliersLoading: boolean;
  suppliersError: boolean;
  onClose: () => void;
  onSubmit: (po: Omit<SupplierOrder, "id" | "orderDate" | "actualDel">) => Promise<void>;
}) {
  const [form, setForm] = useState({
    supplier: prefill?.supplier || suppliers[0]?.name || "",
    materialId: String(materials.find((m) => prefill && m.name === prefill.material)?.id ?? ""),
    material: prefill?.material || "",
    qty: prefill?.qty ? `${prefill.qty} kg` : "",
    cost: prefill?.cost ? formatINR((prefill.qty || 0) * prefill.cost, 2) : "",
      expectedDel: "",
  });
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const dateError = dateBeforeOrderError(form.expectedDel, "Expected delivery");
  const isValid = form.supplier && form.material && form.qty && form.expectedDel && !dateError;

  if (submitted) return (
    <Modal title="Purchase Order Created" onClose={onClose}>
      <div className="text-center py-6">
        <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "#E8F5E9" }}>
          <CheckCircle2 size={32} color="#2E7D32" />
        </div>
        <h3 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "0.5rem" }}>Purchase Order Submitted</h3>
        <p style={{ fontSize: "0.875rem", color: "#7A6C6A", marginBottom: "1rem" }}>
          Purchase order saved for <strong>{form.supplier}</strong> and <strong>{form.material}</strong>.
          Expected delivery: <strong>{form.expectedDel}</strong>.
        </p>
        <div className="p-4 rounded-xl text-left mb-4" style={{ background: "#F9F6F5", border: "1px solid #E8E2E0" }}>
          <p style={{ fontSize: "0.8375rem", color: "#4A4A4A" }}>Purchase order record created in Supplier Orders.</p>
        </div>
        <button onClick={onClose} style={{ padding: "0.625rem 2rem", borderRadius: "0.5rem", background: "#A52A2A", color: "#fff", border: "none", cursor: "pointer", fontWeight: 600 }}>Done</button>
      </div>
    </Modal>
  );

  return (
    <Modal title="Create Purchase Order" onClose={onClose} size="2xl">
      <div className="flex flex-col gap-3.5">
        {suppliersLoading && <p style={{ fontSize: "0.8rem", color: "#7A6C6A" }}>Loading suppliers...</p>}
        {suppliersError && <p style={{ fontSize: "0.8rem", color: "#C0392B" }}>Unable to load suppliers.</p>}
        {!suppliersLoading && !suppliersError && suppliers.length === 0 && <p style={{ fontSize: "0.8rem", color: "#7A6C6A" }}>No suppliers available.</p>}
        <div>
          <label style={{ display: "block", fontSize: "0.775rem", fontWeight: 600, color: "#4A4A4A", marginBottom: "0.3rem" }}>Select Supplier *</label>
          <div className="grid grid-cols-2 gap-2">
            {suppliers.map((s) => (
              <button key={s.name} onClick={() => set("supplier", s.name)}
                className="text-left p-3 rounded-xl transition-all"
                style={{ border: `1.5px solid ${form.supplier === s.name ? "#A52A2A" : "#E8E2E0"}`, background: form.supplier === s.name ? "#FDF5F5" : "#fff", cursor: "pointer" }}>
                <p style={{ fontSize: "0.8rem", fontWeight: 600, color: "#1C1C1C" }}>{s.name}</p>
                <p style={{ fontSize: "0.7rem", color: "#7A6C6A" }}>★ {s.rating ?? "—"} · {s.leadTimeDays === null ? "—" : `${s.leadTimeDays}d lead time`} · {s.reliability ?? "—"}</p>
              </button>
            ))}
          </div>
        </div>
        <div>
          <label htmlFor="po-stock-material" style={{ display: "block", fontSize: "0.775rem", fontWeight: 600, color: "#4A4A4A", marginBottom: "0.3rem" }}>Stock material</label>
          <select id="po-stock-material" value={form.materialId}
            onChange={(e) => {
              const m = materials.find((x) => String(x.id) === e.target.value);
              setForm((p) => ({ ...p, materialId: e.target.value, ...(m && { material: m.name, qty: `${parseQuantity(p.qty).quantity || ""} ${m.unit}`.trim() }) }));
            }}
            style={{ width: "100%", padding: "0.5rem 0.75rem", border: "1px solid #D4BFBB", borderRadius: "0.375rem", fontSize: "0.8375rem", background: "#fff" }}>
            <option value="">Not a stock item</option>
            {materials.filter((m) => m.isActive).map((m) => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}
          </select>
          <p style={{ fontSize: "0.72rem", color: "#7A6C6A", marginTop: "0.25rem" }}>
            {form.materialId ? "When this PO is received, the quantity is added to stock." : "Choose the stock material so the delivery is added to stock."}
          </p>
        </div>
        {[
          { label: "Material *", key: "material", placeholder: "e.g. Steel Sheet 2mm" },
          { label: "Quantity *", key: "qty", placeholder: form.materialId ? `e.g. 500 ${materials.find((m) => String(m.id) === form.materialId)?.unit ?? ""}`.trim() : "e.g. 500 kg" },
          { label: "Total Cost (₹)", key: "cost", placeholder: "e.g. ₹36,000" },
          { label: "Expected Delivery *", key: "expectedDel", placeholder: "", type: "date" },
        ].map((f) => (
          <div key={f.key}>
            <label style={{ display: "block", fontSize: "0.775rem", fontWeight: 600, color: "#4A4A4A", marginBottom: "0.3rem" }}>{f.label}</label>
                    <input type={f.type || "text"} placeholder={f.placeholder} value={form[f.key as keyof typeof form]}
              onChange={(e) => set(f.key, e.target.value)}
              {...(f.key === "expectedDel" && { min: todayIso(), "aria-invalid": dateError !== "", "aria-describedby": "po-date-error" })}
              style={{ width: "100%", padding: "0.5rem 0.75rem", border: "1px solid #D4BFBB", borderRadius: "0.375rem", fontSize: "0.8375rem", outline: "none" }}
              onFocus={(e) => { e.target.style.borderColor = "#A52A2A"; }}
              onBlur={(e) => { e.target.style.borderColor = "#D4BFBB"; }} />
            {f.key === "expectedDel" && dateError && <p id="po-date-error" role="alert" style={{ color: "#C0392B", fontSize: "0.75rem", marginTop: "0.25rem" }}>{dateError}</p>}
          </div>
        ))}
        <div className="flex gap-2 mt-2">
          <button onClick={onClose} style={{ flex: 1, padding: "0.625rem", border: "1px solid #E8E2E0", borderRadius: "0.5rem", background: "#fff", cursor: "pointer", fontSize: "0.875rem" }}>Cancel</button>
          {error && <p style={{ color: "#C0392B", fontSize: "0.8rem" }}>{error}</p>}
          <button disabled={!isValid || saving} onClick={async () => {
            setSaving(true);
            setError("");
            try {
              await onSubmit({ supplier: form.supplier, material: form.material, qty: form.qty, cost: form.cost || "–", expectedDel: form.expectedDel, status: "pending", materialId: form.materialId ? Number(form.materialId) : null });
              setSubmitted(true);
            } catch (err) {
              setError(saveError(err, "Purchase order could not be saved."));
            } finally {
              setSaving(false);
            }
          }} style={{ flex: 2, padding: "0.625rem", border: "none", borderRadius: "0.5rem", background: isValid ? "#A52A2A" : "#D4BFBB", color: "#fff", cursor: isValid ? "pointer" : "not-allowed", fontSize: "0.875rem", fontWeight: 600 }}>
            {saving ? "Saving..." : "Submit Purchase Order"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ── Order Detail Modal ── */
export function OrderDetailModal({ order, onClose, onApprove, onDispatch, onCreateWorkOrder }: {
  order: ClientOrder; onClose: () => void;
  onApprove?: () => void; onDispatch?: () => void;
  /** Make a work order for this (approved) order */
  onCreateWorkOrder?: () => void;
}) {
  const canDispatch = order.status === "approved";
  // Readiness comes from the work orders linked to this order
  const showReadiness = order.status === "approved" || order.status === "in-production";
  const detail = useApiData(
    () => getClientOrderDetail(order._apiId!),
    [order._apiId], "load production progress", showReadiness && order._apiId !== undefined,
  );
  const readiness = detail.data ? dispatchReadiness(order.qty, detail.data.workOrders) : null;
  return (
    <Modal title={`Order Details — ${order.id}`} onClose={onClose} size="2xl">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          {[
            ["Order ID", order.id], ["Client", order.client], ["Product", order.product],
            ["Quantity", `${order.qty} pcs`], ["Order Date", order.orderDate],
            ["Required By", order.requiredDate], ["Order Value", order.value], ["Status", order.status.replace("-", " ")],
          ].map(([k, v]) => (
            <div key={k} className="p-3 rounded-xl" style={{ background: "#F9F6F5" }}>
              <p style={{ fontSize: "0.7rem", color: "#9A8A88", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.25rem" }}>{k}</p>
              <p style={{ fontSize: "0.875rem", fontWeight: 600, color: "#1C1C1C" }}>{v}</p>
            </div>
          ))}
        </div>

        {/* Dispatch readiness from the linked work orders */}
        {showReadiness && (
          detail.loading ? <p style={{ fontSize: "0.8rem", color: "#7A6C6A" }}>Checking production progress…</p>
          : detail.error ? <p style={{ fontSize: "0.8rem", color: "#C0392B" }}>{detail.error}</p>
          : readiness && !readiness.linked ? (
            <p className="p-3 rounded-xl" style={{ fontSize: "0.8rem", color: "#7A6C6A", background: "#F9F6F5" }}>
              No work order is linked to this order yet, so production progress cannot be checked.
            </p>
          ) : readiness && (
            <div className="p-4 rounded-xl" style={{ background: readiness.ready ? "#F0FAF0" : "#FFF8E1", border: `1px solid ${readiness.ready ? "#C8E6C9" : "#FFE082"}` }}>
              <p style={{ fontSize: "0.775rem", fontWeight: 700, color: readiness.ready ? "#2E7D32" : "#8A6D00", marginBottom: "0.75rem" }}>
                {readiness.ready ? "READY TO DISPATCH" : "NOT READY TO DISPATCH YET"}
              </p>
              {readiness.items.map((c) => (
                <div key={c.label} className="flex items-center gap-2 mb-1.5">
                  <CheckCircle2 size={14} color={c.done ? "#2E7D32" : "#D4BFBB"} aria-hidden="true" />
                  <span style={{ fontSize: "0.8rem", color: c.done ? "#1C1C1C" : "#7A6C6A" }}>{c.label}: <strong>{c.detail}</strong>{c.done ? "" : " (not yet)"}</span>
                </div>
              ))}
              <p style={{ fontSize: "0.72rem", color: "#7A6C6A", marginTop: "0.5rem" }}>
                {detail.data!.workOrders.filter((w) => w.status !== "CANCELLED").map((w) => `${w.workOrderNumber} (${w.status.replace(/_/g, " ").toLowerCase()})`).join(", ")}
              </p>
            </div>
          )
        )}

        <div className="flex gap-2 mt-1">
          <button onClick={onClose} style={{ flex: 1, padding: "0.625rem", border: "1px solid #E8E2E0", borderRadius: "0.5rem", background: "#fff", cursor: "pointer", fontSize: "0.875rem" }}>Close</button>
          {order.status === "pending" && onApprove && (
            <button onClick={() => { onApprove(); onClose(); }} style={{ flex: 1, padding: "0.625rem", border: "none", borderRadius: "0.5rem", background: "#2E7D32", color: "#fff", cursor: "pointer", fontSize: "0.875rem", fontWeight: 600 }}>
              Approve Order
            </button>
          )}
          {showReadiness && onCreateWorkOrder && (
            <button onClick={() => { onCreateWorkOrder(); onClose(); }} style={{ flex: 1, padding: "0.625rem", border: "1px solid #A52A2A", borderRadius: "0.5rem", background: "#fff", color: "#A52A2A", cursor: "pointer", fontSize: "0.875rem", fontWeight: 600 }}>
              <Factory size={14} style={{ display: "inline", marginRight: "0.35rem" }} />Create Work Order
            </button>
          )}
          {canDispatch && onDispatch && (
            <button onClick={() => { onDispatch(); onClose(); }} style={{ flex: 1, padding: "0.625rem", border: "none", borderRadius: "0.5rem", background: "#A52A2A", color: "#fff", cursor: "pointer", fontSize: "0.875rem", fontWeight: 600 }}>
              <Truck size={14} style={{ display: "inline", marginRight: "0.35rem" }} />Dispatch
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ── Dispatch Modal ── */
export function DispatchModal({ order, onClose, onConfirm }: { order: ClientOrder; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [step, setStep] = useState<"confirm" | "saving" | "done">("confirm");
  const [error, setError] = useState("");

  const handleDispatch = async () => {
    setStep("saving");
    setError("");
    try {
      await onConfirm();
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dispatch update failed.");
      setStep("confirm");
    }
  };

  return (
    <Modal title="Dispatch Order" onClose={onClose} size="2xl">
      {step === "confirm" && (
        <div className="flex flex-col gap-4">
          <div className="p-4 rounded-xl" style={{ background: "#FFF8E1", border: "1px solid #FFE082" }}>
            <div className="flex items-start gap-2">
              <AlertCircle size={16} color="#F57F17" style={{ flexShrink: 0, marginTop: "0.1rem" }} />
              <p style={{ fontSize: "0.8375rem", color: "#4A4A4A" }}>
                You are about to update the dispatch status for <strong>{order.id}</strong> — <strong>{order.qty} pcs</strong> of <strong>{order.product}</strong> to <strong>{order.client}</strong>.
              </p>
            </div>
          </div>
          {error && <p style={{ color: "#C0392B", fontSize: "0.8rem" }}>{error}</p>}
          <div className="flex gap-2">
            <button onClick={onClose} style={{ flex: 1, padding: "0.625rem", border: "1px solid #E8E2E0", borderRadius: "0.5rem", background: "#fff", cursor: "pointer" }}>Cancel</button>
            <button onClick={handleDispatch} style={{ flex: 2, padding: "0.625rem", border: "none", borderRadius: "0.5rem", background: "#A52A2A", color: "#fff", cursor: "pointer", fontWeight: 600 }}>
              <Truck size={14} style={{ display: "inline", marginRight: "0.35rem" }} /> Confirm Dispatch
            </button>
          </div>
        </div>
      )}
      {step === "saving" && (
        <div className="text-center py-8">
          <div className="w-12 h-12 rounded-full border-4 border-red-100 border-t-red-700 animate-spin mx-auto mb-4" />
          <p style={{ fontWeight: 600, color: "#1C1C1C" }}>Updating dispatch status...</p>
        </div>
      )}
      {step === "done" && (
        <div className="flex flex-col gap-4">
          <div className="text-center py-4">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: "#E8F5E9" }}>
              <CheckCircle2 size={32} color="#2E7D32" />
            </div>
            <h3 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "0.5rem" }}>Dispatch status updated successfully.</h3>
            <p style={{ fontSize: "0.875rem", color: "#7A6C6A" }}>No dispatch documents or notifications were generated by this action.</p>
          </div>
          <button onClick={onClose} style={{ padding: "0.625rem", border: "none", borderRadius: "0.5rem", background: "#A52A2A", color: "#fff", cursor: "pointer", fontWeight: 600 }}>
            Close
          </button>
        </div>
      )}
    </Modal>
  );
}

/* ── Receive Purchase Order ── */
export function ReceivePOModal({ order, onClose, onReceive }: {
  order: SupplierOrder;
  onClose: () => void;
  /** `quantity` is undefined for POs that are not stock items */
  onReceive: (quantity: number | undefined) => Promise<void>;
}) {
  const stock = order.materialId != null;
  const due = quantityDue(order.orderedQty ?? null, order.receivedQty);
  const [qty, setQty] = useState(due !== null ? String(due) : "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const value = Number(qty);
  const qtyError = stock && (qty.trim() === "" || !Number.isFinite(value) || value <= 0) ? "Enter the quantity received." : "";

  const save = async () => {
    if (qtyError || saving) return;
    setSaving(true);
    setError("");
    try {
      await onReceive(stock ? value : undefined);
      onClose();
    } catch (err) {
      setError(saveError(err, "The receipt could not be saved."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Receive ${order.id}`} onClose={onClose}>
      <div className="flex flex-col gap-3.5">
        <p style={{ fontSize: "0.8375rem", color: "#4A4A4A" }}>
          <strong>{order.material}</strong> from <strong>{order.supplier}</strong> · ordered {order.qty}
        </p>
        {stock ? (
          <>
            <p style={{ fontSize: "0.8rem", color: "#7A6C6A" }}>
              {receivedText(order.orderedQty ?? null, order.receivedQty, order.unit ?? null)} so far. The quantity received now is added to stock;
              the PO closes when everything has arrived.
            </p>
            <div>
              <label htmlFor="receive-qty" style={{ display: "block", fontSize: "0.775rem", fontWeight: 600, color: "#4A4A4A", marginBottom: "0.3rem" }}>
                Quantity received now{order.unit ? ` (${order.unit})` : ""} *
              </label>
              <input id="receive-qty" type="number" inputMode="decimal" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)}
                aria-invalid={qtyError !== ""} aria-describedby="receive-qty-error"
                style={{ width: "100%", padding: "0.5rem 0.75rem", border: "1px solid #D4BFBB", borderRadius: "0.375rem", fontSize: "0.8375rem" }} />
              {qtyError && <p id="receive-qty-error" role="alert" style={{ color: "#C0392B", fontSize: "0.75rem", marginTop: "0.25rem" }}>{qtyError}</p>}
            </div>
          </>
        ) : (
          <p style={{ fontSize: "0.8rem", color: "#7A6C6A" }}>This PO is not linked to a stock material, so stock does not change. It is marked delivered.</p>
        )}
        {error && <p role="alert" style={{ color: "#C0392B", fontSize: "0.8rem" }}>{error}</p>}
        <div className="flex gap-2 mt-1">
          <button onClick={onClose} style={{ flex: 1, padding: "0.625rem", border: "1px solid #E8E2E0", borderRadius: "0.5rem", background: "#fff", cursor: "pointer" }}>Cancel</button>
          <button disabled={!!qtyError || saving} onClick={() => void save()} style={{ flex: 2, padding: "0.625rem", border: "none", borderRadius: "0.5rem", background: qtyError ? "#D4BFBB" : "#2E7D32", color: "#fff", cursor: qtyError ? "not-allowed" : "pointer", fontWeight: 600 }}>
            <PackageCheck size={14} style={{ display: "inline", marginRight: "0.35rem" }} />{saving ? "Saving..." : "Confirm Receipt"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ── New Client Order Modal ── */
export function NewClientOrderModal({ clients, clientsLoading, clientsError, parts = [], onClose, onSubmit }: { clients: ClientDto[]; clientsLoading: boolean; clientsError: boolean; parts?: PartSpecDto[]; onClose: () => void; onSubmit: (o: ClientOrder) => Promise<void> }) {
  const [form, setForm] = useState({ clientId: "", partSpecId: "", product: "", qty: "", requiredDate: "", value: "" });
  const chosen = clients.find((c) => String(c.id) === form.clientId);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const dateError = dateBeforeOrderError(form.requiredDate, "Required-by date");
  const isValid = chosen && form.product && form.qty && form.requiredDate && !dateError;

  if (done) return (
    <Modal title="New Client Order" onClose={onClose}>
      <div className="text-center py-6">
        <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "#E8F5E9" }}>
          <CheckCircle2 size={32} color="#2E7D32" />
        </div>
        <h3 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "0.5rem" }}>Order Created</h3>
        <p style={{ fontSize: "0.875rem", color: "#7A6C6A" }}>Order record saved for {chosen?.name}.</p>
        <button onClick={onClose} style={{ marginTop: "1.5rem", padding: "0.625rem 2rem", borderRadius: "0.5rem", background: "#A52A2A", color: "#fff", border: "none", cursor: "pointer", fontWeight: 600 }}>Done</button>
      </div>
    </Modal>
  );

  const today = new Date();
  const dateStr = `${today.getDate()} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][today.getMonth()]}`;

  return (
    <Modal title="Create Client Order" onClose={onClose}>
      <div className="flex flex-col gap-3.5">
        {clientsLoading && <p style={{ fontSize: "0.8rem", color: "#7A6C6A" }}>Loading clients...</p>}
        {clientsError && <p style={{ fontSize: "0.8rem", color: "#C0392B" }}>Unable to load clients.</p>}
        {!clientsLoading && !clientsError && clients.length === 0 && <p style={{ fontSize: "0.8rem", color: "#7A6C6A" }}>No clients available.</p>}
        <div>
          <label htmlFor="new-order-client" style={{ display: "block", fontSize: "0.775rem", fontWeight: 600, color: "#4A4A4A", marginBottom: "0.3rem" }}>Client *</label>
          <select id="new-order-client" value={form.clientId} onChange={(e) => set("clientId", e.target.value)} disabled={clientsLoading}
            style={{ width: "100%", padding: "0.5rem 0.75rem", border: "1px solid #D4BFBB", borderRadius: "0.375rem", fontSize: "0.8375rem", background: "#fff" }}>
            <option value="">{clientsLoading ? "Loading clients…" : "Choose a client"}</option>
            {clients.filter((c) => c.isActive).map((c) => <option key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ""}</option>)}
          </select>
        </div>
        {parts.length > 0 && (
          <div>
            <label htmlFor="new-order-part" style={{ display: "block", fontSize: "0.775rem", fontWeight: 600, color: "#4A4A4A", marginBottom: "0.3rem" }}>Part (Parts Master)</label>
            <select id="new-order-part" value={form.partSpecId}
              onChange={(e) => {
                const part = parts.find((x) => String(x.id) === e.target.value);
                setForm((p) => ({ ...p, partSpecId: e.target.value, ...(part && { product: part.partNumber }) }));
              }}
              style={{ width: "100%", padding: "0.5rem 0.75rem", border: "1px solid #D4BFBB", borderRadius: "0.375rem", fontSize: "0.8375rem", background: "#fff" }}>
              <option value="">Not in the Parts Master (type the product below)</option>
              {parts.map((x) => <option key={x.id} value={x.id}>{x.partNumber} · {x.rmGrade} {x.thicknessMm} mm</option>)}
            </select>
          </div>
        )}
        {[
          { label: "Product / Part *", key: "product", placeholder: "e.g. Steel Frames 2mm" },
          { label: "Quantity (pcs) *", key: "qty", placeholder: "e.g. 500", type: "number" },
          { label: "Required By *", key: "requiredDate", placeholder: "", type: "date" },
          { label: "Order Value (₹)", key: "value", placeholder: "e.g. ₹1,82,000" },
        ].map((f) => (
          <div key={f.key}>
            <label style={{ display: "block", fontSize: "0.775rem", fontWeight: 600, color: "#4A4A4A", marginBottom: "0.3rem" }}>{f.label}</label>
                    <input id={`new-order-${f.key}`} type={f.type || "text"} placeholder={f.placeholder} value={form[f.key as keyof typeof form]}
              onChange={(e) => set(f.key, e.target.value)}
              {...(f.key === "requiredDate" && { min: todayIso(), "aria-invalid": dateError !== "", "aria-describedby": "order-date-error" })}
              style={{ width: "100%", padding: "0.5rem 0.75rem", border: "1px solid #D4BFBB", borderRadius: "0.375rem", fontSize: "0.8375rem", outline: "none" }}
              onFocus={(e) => { e.target.style.borderColor = "#A52A2A"; }}
              onBlur={(e) => { e.target.style.borderColor = "#D4BFBB"; }} />
            {f.key === "requiredDate" && dateError && <p id="order-date-error" role="alert" style={{ color: "#C0392B", fontSize: "0.75rem", marginTop: "0.25rem" }}>{dateError}</p>}
          </div>
        ))}
        {error && <p style={{ color: "#C0392B", fontSize: "0.8rem" }}>{error}</p>}
        <div className="flex gap-2 mt-1">
          <button onClick={onClose} style={{ flex: 1, padding: "0.625rem", border: "1px solid #E8E2E0", borderRadius: "0.5rem", background: "#fff", cursor: "pointer" }}>Cancel</button>
          <button disabled={!isValid || saving} onClick={async () => {
            setSaving(true);
            setError("");
            try {
              await onSubmit({ id: "", client: chosen!.name, clientId: chosen!.id, product: form.product, qty: parseInt(form.qty), orderDate: dateStr, requiredDate: form.requiredDate, status: "pending", value: form.value || "–", partSpecId: form.partSpecId ? Number(form.partSpecId) : null });
              setDone(true);
            } catch (err) {
              setError(saveError(err, "Client order could not be saved."));
            } finally {
              setSaving(false);
            }
          }} style={{ flex: 2, padding: "0.625rem", border: "none", borderRadius: "0.5rem", background: isValid ? "#A52A2A" : "#D4BFBB", color: "#fff", cursor: isValid ? "pointer" : "not-allowed", fontWeight: 600 }}>
            {saving ? "Saving..." : "Create Order"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ══════════════════════════════════════════════
   ORDERS PAGE
══════════════════════════════════════════════ */
