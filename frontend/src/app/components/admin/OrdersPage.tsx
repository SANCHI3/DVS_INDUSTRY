import { useState, useEffect } from "react";
import { toast as showSonnerToast } from "sonner";
import {
  Plus, Download, Eye, CheckCircle2, Truck, X,
  FileText, Package, AlertCircle, Printer,
} from "lucide-react";
import { PageHeader, Card, CardHeader, KPICard, StatusBadge, Btn, DataTable, TabBar } from "../shared/UI";
import { useERP } from "./ERPContext";
import {
  getClientOrders, getPurchaseOrders, getOrderStats,
  getClients, getSuppliers,
  approveClientOrder, dispatchClientOrder, deliverClientOrder,
  createClientOrder, createPurchaseOrder,
  type ClientOrderDto, type PurchaseOrderDto, type OrderStatistics,
  type ClientDto, type SupplierDto,
} from "../../../lib/services/orders.service";

/* ── Types ── */
interface ClientOrder {
  id: string; client: string; product: string; qty: number;
  orderDate: string; requiredDate: string; status: string; value: string;
  dispatch?: string; delivery?: string;
  _apiId?: number;
}
interface SupplierOrder {
  id: string; supplier: string; material: string; qty: string;
  orderDate: string; expectedDel: string; actualDel: string; cost: string; status: string;
  _apiId?: number;
}

/* ── Helpers ── */
function parseMoney(value: string): string | null {
  const normalized = value.replace(/[₹,\s]/g, "");
  return normalized && /^\d+(\.\d{1,2})?$/.test(normalized) ? normalized : null;
}

function parseQuantity(value: string): { quantity: string; unit: string | null } {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?$/);
  return { quantity: match?.[1] ?? value.trim(), unit: match?.[2] ?? null };
}

function downloadCSV(filename: string, rows: string[][]) {
  const csv = rows.map((r) => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.45)" }} onClick={onClose}>
      <div className={`rounded-xl overflow-hidden mx-4 ${wide ? "w-full max-w-2xl" : "w-full max-w-lg"}`}
        style={{ background: "#fff", boxShadow: "0 20px 60px rgba(0,0,0,0.2)", maxHeight: "90vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 sticky top-0" style={{ borderBottom: "1px solid #E8E2E0", background: "#F9F6F5" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#1C1C1C" }}>{title}</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#7A6C6A" }}><X size={18} /></button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

/* ── PO Creation Modal ── */
function POModal({ prefill, suppliers, suppliersLoading, suppliersError, onClose, onSubmit }: {
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
    <Modal title="Create Purchase Order" onClose={onClose} wide>
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
                    <input type={f.type || "text"} placeholder={f.placeholder} value={(form as any)[f.key]}
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
function OrderDetailModal({ order, onClose, onApprove, onDispatch }: {
  order: ClientOrder; onClose: () => void;
  onApprove?: () => void; onDispatch?: () => void;
}) {
  const canDispatch = order.status === "approved";
  return (
    <Modal title={`Order Details — ${order.id}`} onClose={onClose} wide>
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
function DispatchModal({ order, onClose, onConfirm }: { order: ClientOrder; onClose: () => void; onConfirm: () => Promise<void> }) {
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
    <Modal title="Dispatch Order" onClose={onClose} wide>
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
function NewClientOrderModal({ clients, clientsLoading, clientsError, onClose, onSubmit }: { clients: ClientDto[]; clientsLoading: boolean; clientsError: boolean; onClose: () => void; onSubmit: (o: ClientOrder) => Promise<void> }) {
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
                    <input list={f.key === "client" ? "available-clients" : undefined} type={f.type || "text"} placeholder={f.placeholder} value={(form as any)[f.key]}
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
export function OrdersPage({ onNavigate }: { onNavigate?: (section: string) => void }) {
  const [tab, setTab]                       = useState("client-orders");
  const [clientOrders, setClientOrders]     = useState<ClientOrder[]>([]);
  const [supplierOrders, setSupplierOrders] = useState<SupplierOrder[]>([]);
  const [clients, setClients]               = useState<ClientDto[]>([]);
  const [suppliers, setSuppliers]           = useState<SupplierDto[]>([]);
  const [apiStats, setApiStats]             = useState<OrderStatistics | null>(null);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [suppliersLoading, setSuppliersLoading] = useState(true);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [ordersError, setOrdersError] = useState(false);
  const [suppliersError, setSuppliersError] = useState(false);
  const [clientsError, setClientsError] = useState(false);
  const [statsError, setStatsError] = useState(false);
  const [showNewOrder, setShowNewOrder]     = useState(false);
  const [showNewPO, setShowNewPO]           = useState(false);
  const [selectedOrder, setSelectedOrder]   = useState<ClientOrder | null>(null);
  const [dispatchOrder, setDispatchOrder]   = useState<ClientOrder | null>(null);
  const { pendingPO, setPendingPO } = useERP();

  // ── Load real data ──────────────────────────────────────────────────────────
  const loadAll = async (): Promise<void> => {
    setOrdersLoading(true); setSuppliersLoading(true); setClientsLoading(true); setStatsLoading(true);
    setOrdersError(false); setSuppliersError(false); setClientsError(false); setStatsError(false);
    const [coRes, poRes, statsRes, clientRes, supplierRes] = await Promise.all([
      getClientOrders({ pageSize: 50, sortOrder: "desc" }).catch(() => null),
      getPurchaseOrders({ pageSize: 50, sortOrder: "desc" }).catch(() => null),
      getOrderStats().catch(() => null),
      getClients({ pageSize: 100 }).catch(() => null),
      getSuppliers({ pageSize: 100 }).catch(() => null),
    ]);

        if (coRes) setClientOrders(coRes.data.map(o => ({
          id: o.orderNumber,
          client: o.clientName,
          product: o.product,
          qty: o.quantity,
          orderDate: new Date(o.orderDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
          requiredDate: o.requiredDate ? new Date(o.requiredDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—",
          status: o.status.toLowerCase().replace("_", "-"),
          value: o.value ? `₹${parseFloat(o.value).toLocaleString("en-IN")}` : "—",
          dispatch: o.dispatchDate ? new Date(o.dispatchDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : undefined,
          delivery: o.deliveryDate ? new Date(o.deliveryDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : undefined,
          _apiId: o.id,
        }))); else setOrdersError(true);
    if (poRes) setSupplierOrders(poRes.data.map(p => ({
          id: p.poNumber,
          supplier: p.supplierName,
          material: p.material,
          qty: p.quantity,
          orderDate: new Date(p.orderDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
          expectedDel: p.expectedDelivery ? new Date(p.expectedDelivery).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—",
          actualDel: p.actualDelivery ? new Date(p.actualDelivery).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "–",
          cost: p.totalCost ? `₹${parseFloat(p.totalCost).toLocaleString("en-IN")}` : "–",
          status: p.status.toLowerCase().replace("_", "-"),
          _apiId: p.id,
        }))); else setOrdersError(true);
      if (statsRes) setApiStats(statsRes); else setStatsError(true);
      if (clientRes) setClients(clientRes.data); else setClientsError(true);
      if (supplierRes) setSuppliers(supplierRes.data); else setSuppliersError(true);
      setOrdersLoading(false); setSuppliersLoading(false); setClientsLoading(false); setStatsLoading(false);
  };

  useEffect(() => { loadAll(); }, []);

  // Auto-open PO modal if navigated from Inventory with pending PO
  useEffect(() => {
    if (pendingPO) { setTab("supplier-orders"); setShowNewPO(true); }
  }, [pendingPO]);

  const handleApprove = async (id: string) => {
    try {
      const order = clientOrders.find(o => o.id === id);
      if (!order?._apiId) throw new Error("This order is not stored in the database.");
      await approveClientOrder(order._apiId);
      await loadAll();
      showSonnerToast.success(`Client order ${id} approved successfully.`);
    } catch (err) {
      showSonnerToast.error(err instanceof Error ? err.message : "Order approval failed.");
    }
  };

  const handleDispatchDone = async (id: string) => {
    try {
      const order = clientOrders.find(o => o.id === id);
      if (!order?._apiId) throw new Error("This order is not stored in the database.");
      await dispatchClientOrder(order._apiId, {});
      await loadAll();
      showSonnerToast.success("Dispatch status updated successfully.");
    } catch (err) {
      throw err;
    }
  };

  const handleAddOrder = async (o: ClientOrder) => {
    const client = clients.find(c => c.name.toLowerCase() === o.client.toLowerCase());
    if (!client) throw new Error("Select an existing client before creating an order.");
    await createClientOrder({
      clientId: client.id,
      product: o.product,
      quantity: o.qty,
      unit: "pcs",
      value: parseMoney(o.value) ?? null,
      requiredDate: o.requiredDate ? new Date(o.requiredDate).toISOString() : null,
    });
    await loadAll();
    showSonnerToast.success("Client order saved successfully.");
  };

  const handleAddPO = async (po: Omit<SupplierOrder, "id" | "orderDate" | "actualDel">) => {
    const supplier = suppliers.find(s => s.name.toLowerCase() === po.supplier.toLowerCase());
    if (!supplier) throw new Error("Select an existing supplier before creating a purchase order.");
    await createPurchaseOrder({
      supplierId: supplier.id,
      material: po.material,
      quantity: parseQuantity(po.qty).quantity,
      unit: parseQuantity(po.qty).unit,
      totalCost: parseMoney(po.cost) ?? null,
      expectedDelivery: po.expectedDel ? new Date(po.expectedDel).toISOString() : null,
      notes: null,
    });
    await loadAll();
    setPendingPO(null);
    showSonnerToast.success("Purchase order saved successfully.");
  };

  const handleExport = () => {
    const rows = [
      ["Order ID", "Client", "Product", "Qty", "Order Date", "Required By", "Value", "Status"],
      ...clientOrders.map((o) => [o.id, o.client, o.product, String(o.qty), o.orderDate, o.requiredDate, o.value, o.status]),
    ];
    downloadCSV("DVS_Client_Orders.csv", rows);
    showSonnerToast.success("Orders exported to CSV");
  };

  const poPrefill = pendingPO ? { material: pendingPO.materialName, qty: pendingPO.reorderQty, cost: pendingPO.unitCost, supplier: pendingPO.preferredSupplier } : undefined;

  return (
    <>
    {showNewOrder && <NewClientOrderModal clients={clients} clientsLoading={clientsLoading} clientsError={clientsError} onClose={() => setShowNewOrder(false)} onSubmit={handleAddOrder} />}
    {showNewPO && <POModal suppliers={suppliers} suppliersLoading={suppliersLoading} suppliersError={suppliersError} prefill={poPrefill} onClose={() => { setShowNewPO(false); setPendingPO(null); }} onSubmit={handleAddPO} />}
    {selectedOrder && !dispatchOrder && (
      <OrderDetailModal
        order={selectedOrder}
        onClose={() => setSelectedOrder(null)}
        onApprove={() => handleApprove(selectedOrder.id)}
        onDispatch={() => { setDispatchOrder(selectedOrder); setSelectedOrder(null); }}
      />
    )}
    {dispatchOrder && (
      <DispatchModal
        order={dispatchOrder}
        onClose={() => setDispatchOrder(null)}
        onConfirm={() => handleDispatchDone(dispatchOrder.id)}
      />
    )}

    <div className="p-6">
      <PageHeader
        title="Orders & Supply Chain"
        subtitle="End-to-end order management — from supplier procurement to client delivery"
        actions={
          <div className="flex gap-2">
            <Btn variant="secondary" size="sm" onClick={handleExport}><Download size={14} /> Export</Btn>
            <Btn size="sm" onClick={() => setShowNewOrder(true)}><Plus size={14} /> New Order</Btn>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <KPICard label="Active Client Orders" value={statsLoading ? "Loading..." : statsError ? "Unavailable" : apiStats ? String(apiStats.clientOrders.total - apiStats.clientOrders.delivered - apiStats.clientOrders.cancelled) : "Unavailable"} sub="in progress" accent="#A52A2A" />
        <KPICard label="Pending Supplier POs" value={statsLoading ? "Loading..." : statsError ? "Unavailable" : apiStats ? String(apiStats.purchaseOrders.pending) : "Unavailable"} sub="awaiting processing" accent="#E65100" trendDir="down" />
        <KPICard label="Dispatched Orders" value={statsLoading ? "Loading..." : statsError ? "Unavailable" : apiStats ? String(apiStats.clientOrders.dispatched) : "Unavailable"} accent="#1565C0" />
        <KPICard label="Fulfillment Rate" value={statsLoading ? "Loading..." : statsError ? "Unavailable" : apiStats?.fulfillmentRate ?? "Unavailable"} accent="#2E7D32" />
      </div>

      <TabBar
        tabs={[
          { id: "client-orders", label: "Client Orders" },
          { id: "supplier-orders", label: "Supplier Orders" },
          { id: "supply-chain", label: "Supply Chain Flow" },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="mt-5">
        {/* ── CLIENT ORDERS ── */}
        {tab === "client-orders" && (
          <Card>
            <CardHeader
              title="Client Orders"
              subtitle={ordersLoading ? "Loading orders..." : ordersError ? "Unable to load orders" : `${clientOrders.length} total orders`}
              actions={<Btn size="sm" onClick={() => setShowNewOrder(true)}><Plus size={13} /> New Order</Btn>}
            />
            <DataTable
              searchable
              paginate={8}
              exportFilename="DVS_Client_Orders.csv"
              emptyMsg={ordersLoading ? "Loading client orders..." : ordersError ? "Unable to load client orders." : "No client orders available."}
              columns={[
                { key: "id", label: "Order ID" },
                { key: "client", label: "Client" },
                { key: "product", label: "Product" },
                { key: "qty", label: "Qty (pcs)" },
                { key: "orderDate", label: "Order Date" },
                { key: "requiredDate", label: "Required By" },
                { key: "value", label: "Value" },
                { key: "status", label: "Status" },
                { key: "actions", label: "Actions" },
              ]}
              rows={clientOrders.map((o) => ({
                id: <span style={{ fontSize: "0.775rem", fontFamily: "JetBrains Mono, monospace", color: "#A52A2A", fontWeight: 600 }}>{o.id}</span>,
                client: <span style={{ fontWeight: 500 }}>{o.client}</span>,
                product: <span style={{ fontSize: "0.8rem" }}>{o.product}</span>,
                qty: o.qty.toLocaleString(),
                orderDate: o.orderDate,
                requiredDate: <span style={{ fontWeight: 500, color: o.status === "pending" ? "#E65100" : "#4A4A4A" }}>{o.requiredDate}</span>,
                value: <span style={{ fontWeight: 600, color: "#1C1C1C" }}>{o.value}</span>,
                status: <StatusBadge status={o.status} label={o.status.replace("-", " ")} />,
                actions: (
                  <div className="flex gap-1.5">
                    <button onClick={() => setSelectedOrder(o)} title="View details" className="p-1.5 rounded" style={{ background: "#F0F4FF", color: "#1565C0" }}><Eye size={12} /></button>
                    {o.status === "pending" && (
                      <button onClick={() => handleApprove(o.id)} title="Approve order" className="p-1.5 rounded" style={{ background: "#E8F5E9", color: "#2E7D32" }}><CheckCircle2 size={12} /></button>
                    )}
                    {o.status === "approved" && (
                      <button onClick={() => setDispatchOrder(o)} title="Dispatch order" className="p-1.5 rounded" style={{ background: "#FFF3E0", color: "#E65100" }}><Truck size={12} /></button>
                    )}
                  </div>
                ),
              }))}
            />
          </Card>
        )}

        {/* ── SUPPLIER ORDERS ── */}
        {tab === "supplier-orders" && (
          <Card>
            <CardHeader
              title="Purchase Orders"
              subtitle="Supplier procurement tracking"
              actions={<Btn size="sm" onClick={() => setShowNewPO(true)}><Plus size={13} /> Create PO</Btn>}
            />
            <DataTable
              columns={[
                { key: "id", label: "PO Number" },
                { key: "supplier", label: "Supplier" },
                { key: "material", label: "Material" },
                { key: "qty", label: "Quantity" },
                { key: "orderDate", label: "Order Date" },
                { key: "expectedDel", label: "Expected Del." },
                { key: "actualDel", label: "Actual Del." },
                { key: "cost", label: "Total Cost" },
                { key: "status", label: "Status" },
              ]}
              searchable
              paginate={8}
              exportFilename="DVS_Purchase_Orders.csv"
              emptyMsg={ordersLoading ? "Loading purchase orders..." : ordersError ? "Unable to load purchase orders." : "No purchase orders available."}
              rows={supplierOrders.map((o) => ({
                id: <span style={{ fontSize: "0.775rem", fontFamily: "JetBrains Mono, monospace", color: "#4E342E", fontWeight: 600 }}>{o.id}</span>,
                supplier: <span style={{ fontWeight: 500 }}>{o.supplier}</span>,
                material: o.material,
                qty: o.qty,
                orderDate: o.orderDate,
                expectedDel: o.expectedDel,
                actualDel: <span style={{ color: o.actualDel === "–" ? "#9A8A88" : "#2E7D32" }}>{o.actualDel}</span>,
                cost: <span style={{ fontWeight: 600 }}>{o.cost}</span>,
                status: <StatusBadge status={o.status} label={o.status.replace("-", " ")} />,
              }))}
            />
          </Card>
        )}

        {/* ── SUPPLY CHAIN ── */}
        {tab === "supply-chain" && (
          <div>
            <Card className="mb-5">
              <CardHeader title="Supply Chain Flow" subtitle="Unavailable from current order APIs" />
              <div className="p-8">
                <p style={{ fontSize: "0.875rem", color: "#7A6C6A", textAlign: "center" }}>No supply-chain flow data available.</p>
              </div>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <Card>
                <CardHeader title="Order Fulfillment Rate" subtitle="Trend unavailable" />
                <div className="p-5">
                  <p style={{ fontSize: "0.8375rem", color: "#7A6C6A" }}>No fulfillment trend data available.</p>
                </div>
              </Card>

              <Card>
                <CardHeader title="Supply Chain Analytics" />
                <div className="p-5 flex flex-col gap-3">
                  {["On-Time Delivery Rate", "Avg Supplier Lead Time", "Order Processing Time", "Client Satisfaction Score", "PO Approval Rate"].map((label) => (
                    <div key={label} className="flex items-center justify-between py-2" style={{ borderBottom: "1px solid #F0ECEB" }}>
                      <span style={{ fontSize: "0.8375rem", color: "#4A4A4A" }}>{label}</span>
                      <span style={{ fontSize: "0.9rem", fontWeight: 700, color: "#7A6C6A" }}>Unavailable</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
    </>
  );
}
