import { useState } from "react";
import { CheckCircle2, Truck, AlertCircle } from "lucide-react";
import { type ClientDto, type SupplierDto } from "../../../../lib/services/orders.service";
import { Modal } from "../../shared/Modal";

/* ── Types ── */
export interface ClientOrder {
  id: string; client: string; product: string; qty: number;
  orderDate: string; requiredDate: string; status: string; value: string;
  dispatch?: string; delivery?: string;
  _apiId?: number;
}
export interface SupplierOrder {
  id: string; supplier: string; material: string; qty: string;
  orderDate: string; expectedDel: string; actualDel: string; cost: string; status: string;
  _apiId?: number;
}

/* ── Helpers ── */
export function parseMoney(value: string): string | null {
  const normalized = value.replace(/[₹,\s]/g, "");
  return normalized && /^\d+(\.\d{1,2})?$/.test(normalized) ? normalized : null;
}

export function parseQuantity(value: string): { quantity: string; unit: string | null } {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?$/);
  return { quantity: match?.[1] ?? value.trim(), unit: match?.[2] ?? null };
}

/* ── PO Creation Modal ── */
export function POModal({ prefill, suppliers, suppliersLoading, suppliersError, onClose, onSubmit }: {
  prefill?: { material: string; qty: number; cost: number; supplier: string };
  suppliers: SupplierDto[];
  suppliersLoading: boolean;
  suppliersError: boolean;
  onClose: () => void;
  onSubmit: (po: Omit<SupplierOrder, "id" | "orderDate" | "actualDel">) => Promise<void>;
}) {
  const [form, setForm] = useState({
    supplier: prefill?.supplier || suppliers[0]?.name || "",
    material: prefill?.material || "",
    qty: prefill?.qty ? `${prefill.qty} kg` : "",
    cost: prefill?.cost ? `₹${(prefill.qty || 0) * prefill.cost}` : "",
      expectedDel: "",
  });
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const isValid = form.supplier && form.material && form.qty && form.expectedDel;

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
        {[
          { label: "Material *", key: "material", placeholder: "e.g. Steel Sheet 2mm" },
          { label: "Quantity *", key: "qty", placeholder: "e.g. 500 kg" },
          { label: "Total Cost (₹)", key: "cost", placeholder: "e.g. ₹36,000" },
          { label: "Expected Delivery *", key: "expectedDel", placeholder: "", type: "date" },
        ].map((f) => (
          <div key={f.key}>
            <label style={{ display: "block", fontSize: "0.775rem", fontWeight: 600, color: "#4A4A4A", marginBottom: "0.3rem" }}>{f.label}</label>
                    <input type={f.type || "text"} placeholder={f.placeholder} value={form[f.key as keyof typeof form]}
              onChange={(e) => set(f.key, e.target.value)}
              style={{ width: "100%", padding: "0.5rem 0.75rem", border: "1px solid #D4BFBB", borderRadius: "0.375rem", fontSize: "0.8375rem", outline: "none" }}
              onFocus={(e) => { e.target.style.borderColor = "#A52A2A"; }}
              onBlur={(e) => { e.target.style.borderColor = "#D4BFBB"; }} />
          </div>
        ))}
        <div className="flex gap-2 mt-2">
          <button onClick={onClose} style={{ flex: 1, padding: "0.625rem", border: "1px solid #E8E2E0", borderRadius: "0.5rem", background: "#fff", cursor: "pointer", fontSize: "0.875rem" }}>Cancel</button>
          {error && <p style={{ color: "#C0392B", fontSize: "0.8rem" }}>{error}</p>}
          <button disabled={!isValid || saving} onClick={async () => {
            setSaving(true);
            setError("");
            try {
              await onSubmit({ supplier: form.supplier, material: form.material, qty: form.qty, cost: form.cost || "–", expectedDel: form.expectedDel, status: "pending" });
              setSubmitted(true);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Purchase order could not be saved.");
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
export function OrderDetailModal({ order, onClose, onApprove, onDispatch }: {
  order: ClientOrder; onClose: () => void;
  onApprove?: () => void; onDispatch?: () => void;
}) {
  const canDispatch = order.status === "approved";
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

        {/* Production checklist for dispatch eligibility */}
        {(order.status === "in-production" || order.status === "approved") && (
          <div className="p-4 rounded-xl" style={{ background: "#F0FAF0", border: "1px solid #C8E6C9" }}>
            <p style={{ fontSize: "0.775rem", fontWeight: 700, color: "#2E7D32", marginBottom: "0.75rem" }}>DISPATCH ELIGIBILITY</p>
            {[
              { label: "Production Complete", done: order.status === "approved" },
              { label: "Quality Inspection Passed", done: order.status === "approved" },
              { label: "Finished Goods Available", done: order.status === "approved" },
            ].map((c) => (
              <div key={c.label} className="flex items-center gap-2 mb-1.5">
                <CheckCircle2 size={14} color={c.done ? "#2E7D32" : "#D4BFBB"} />
                <span style={{ fontSize: "0.8rem", color: c.done ? "#1C1C1C" : "#9A8A88" }}>{c.label}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2 mt-1">
          <button onClick={onClose} style={{ flex: 1, padding: "0.625rem", border: "1px solid #E8E2E0", borderRadius: "0.5rem", background: "#fff", cursor: "pointer", fontSize: "0.875rem" }}>Close</button>
          {order.status === "pending" && onApprove && (
            <button onClick={() => { onApprove(); onClose(); }} style={{ flex: 1, padding: "0.625rem", border: "none", borderRadius: "0.5rem", background: "#2E7D32", color: "#fff", cursor: "pointer", fontSize: "0.875rem", fontWeight: 600 }}>
              Approve Order
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

/* ── New Client Order Modal ── */
export function NewClientOrderModal({ clients, clientsLoading, clientsError, onClose, onSubmit }: { clients: ClientDto[]; clientsLoading: boolean; clientsError: boolean; onClose: () => void; onSubmit: (o: ClientOrder) => Promise<void> }) {
  const [form, setForm] = useState({ client: "", product: "", qty: "", requiredDate: "", value: "" });
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const isValid = form.client && form.product && form.qty && form.requiredDate;

  if (done) return (
    <Modal title="New Client Order" onClose={onClose}>
      <div className="text-center py-6">
        <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "#E8F5E9" }}>
          <CheckCircle2 size={32} color="#2E7D32" />
        </div>
        <h3 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "0.5rem" }}>Order Created</h3>
        <p style={{ fontSize: "0.875rem", color: "#7A6C6A" }}>Order record saved for {form.client}.</p>
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
        {[
          { label: "Client Name *", key: "client", placeholder: "e.g. Reliance Eng." },
          { label: "Product / Part *", key: "product", placeholder: "e.g. Steel Frames 2mm" },
          { label: "Quantity (pcs) *", key: "qty", placeholder: "e.g. 500", type: "number" },
          { label: "Required By *", key: "requiredDate", placeholder: "", type: "date" },
          { label: "Order Value (₹)", key: "value", placeholder: "e.g. ₹1,82,000" },
        ].map((f) => (
          <div key={f.key}>
            <label style={{ display: "block", fontSize: "0.775rem", fontWeight: 600, color: "#4A4A4A", marginBottom: "0.3rem" }}>{f.label}</label>
                    <input list={f.key === "client" ? "available-clients" : undefined} type={f.type || "text"} placeholder={f.placeholder} value={form[f.key as keyof typeof form]}
              onChange={(e) => set(f.key, e.target.value)}
              style={{ width: "100%", padding: "0.5rem 0.75rem", border: "1px solid #D4BFBB", borderRadius: "0.375rem", fontSize: "0.8375rem", outline: "none" }}
              onFocus={(e) => { e.target.style.borderColor = "#A52A2A"; }}
              onBlur={(e) => { e.target.style.borderColor = "#D4BFBB"; }} />
            {f.key === "client" && <datalist id="available-clients">{clients.map((client) => <option key={client.id} value={client.name} />)}</datalist>}
          </div>
        ))}
        {error && <p style={{ color: "#C0392B", fontSize: "0.8rem" }}>{error}</p>}
        <div className="flex gap-2 mt-1">
          <button onClick={onClose} style={{ flex: 1, padding: "0.625rem", border: "1px solid #E8E2E0", borderRadius: "0.5rem", background: "#fff", cursor: "pointer" }}>Cancel</button>
          <button disabled={!isValid || saving} onClick={async () => {
            setSaving(true);
            setError("");
            try {
              await onSubmit({ id: "", client: form.client, product: form.product, qty: parseInt(form.qty), orderDate: dateStr, requiredDate: form.requiredDate, status: "pending", value: form.value || "–" });
              setDone(true);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Client order could not be saved.");
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
