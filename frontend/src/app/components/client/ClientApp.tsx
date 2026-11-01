import { useCallback, useEffect, useMemo, useState } from "react";
import { useSectionHash } from "../../../lib/useSectionHash";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, CheckCircle2, Circle, Download, Headphones, MapPin, Plus, RefreshCw, RotateCcw, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "../shared/AppShell";
import { PageHeader, KPICard, Card, CardHeader, StatusBadge, Btn, DataTable } from "../shared/UI";
import { PortalMessages } from "../shared/PortalMessages";
import { getUser } from "../../../lib/auth";
import { describeApiError, fetchAllPages, isApiError, withServerWake } from "../../../lib/api";
import { downloadCSV } from "../../../lib/csv";
import {
  cancelClientOrder,
  createClientOrder,
  getClientOrders,
  getClients,
  type ClientDto,
  type ClientOrderDto,
} from "../../../lib/services/orders.service";
import { formatINRCompact, formatMoney } from "../../../lib/format";
import { getPortalMessages, type PortalMessageDto } from "../../../lib/services/portal.service";
import {
  clientNotifications, clientOrderTrend, orderTimeline, orderedProducts, type PortalNotification,
} from "../../../lib/portalInsights";

const ACCENT = "#1565C0";
const NO_PROFILE = "No client record matches this login's email. Ask DVS to set it on your client record.";

type ClientPortalData = {
  profile: ClientDto | null;
  orders: ClientOrderDto[];
  messages: PortalMessageDto[];
  loading: boolean;
  error: string | null;
};

/** Prefill for the new-order form (from the catalogue's "Order again"). */
type OrderDraft = { product: string; unit: string; unitPrice: number | null };

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "–";
}

function statusLabel(status: string): string {
  return status.toLowerCase().replace(/_/g, " ");
}

const isOpen = (order: ClientOrderDto) => !["DELIVERED", "CANCELLED"].includes(order.status);

function EmptyState({ message }: { message: string }) {
  return <p className="p-5" style={{ color: "#7A6C6A", fontSize: "0.8375rem" }}>{message}</p>;
}

function LoadError({ data, onRetry }: { data: ClientPortalData; onRetry: () => void }) {
  if (!data.error) return null;
  return (
    <div className="mb-5 flex items-center justify-between gap-3 rounded-lg px-4 py-3" role="alert" style={{ background: "#FFEBEE", color: "#C0392B", fontSize: "0.8375rem" }}>
      <span>{data.error}</span>
      <Btn size="sm" variant="secondary" onClick={onRetry}><RefreshCw size={13} /> Try again</Btn>
    </div>
  );
}

function ClientDashboard({ onNavigate, data, onRetry }: { onNavigate: (section: string) => void; data: ClientPortalData; onRetry: () => void }) {
  const { profile, orders, loading } = data;
  const activeOrders = orders.filter(isOpen);
  const completedOrders = orders.filter((order) => order.status === "DELIVERED");
  const totalSpend = orders.filter((o) => o.status !== "CANCELLED").reduce((sum, order) => sum + Number(order.value ?? 0), 0);
  const dash = (v: string | number) => (loading ? "—" : v);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 style={{ fontSize: "1.3rem", fontWeight: 700 }}>Client Dashboard</h1>
          <p style={{ fontSize: "0.8375rem", color: "#7A6C6A" }}>{profile ? `${profile.name} · Client ID: ${profile.code}` : loading ? "Loading…" : "Client profile unavailable"}</p>
        </div>
        <Btn onClick={() => onNavigate("orders")} disabled={!profile}><Plus size={14} /> New Order</Btn>
      </div>

      <LoadError data={data} onRetry={onRetry} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <KPICard label="Active Orders" value={dash(activeOrders.length)} sub="in progress" accent="#A52A2A" />
        <KPICard label="Delivered Orders" value={dash(completedOrders.length)} accent="#2E7D32" />
        <KPICard label="On the Way" value={dash(orders.filter((order) => order.status === "DISPATCHED").length)} sub="dispatched" accent="#E65100" />
        <KPICard label="Order Value" value={loading ? "—" : formatMoney(totalSpend)} sub="cancelled excluded" accent="#4E342E" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        <Card style={{ gridColumn: "span 2" }}>
          <CardHeader title="Client Profile" subtitle="As held by DVS Industries" />
          {profile ? <div className="p-5 grid grid-cols-2 gap-3" style={{ fontSize: "0.8375rem" }}>
            <p><strong>Name:</strong> {profile.name}</p><p><strong>Code:</strong> {profile.code}</p>
            <p><strong>Contact:</strong> {profile.contactName ?? "—"}</p><p><strong>Email:</strong> {profile.email ?? "—"}</p>
            <p><strong>Phone:</strong> {profile.phone ?? "—"}</p><p><strong>Location:</strong> {[profile.city, profile.state, profile.country].filter(Boolean).join(", ") || "—"}</p>
            <p><strong>GSTIN:</strong> {profile.gstin ?? "—"}</p><p><strong>Address:</strong> {profile.address ?? "—"}</p>
          </div> : <EmptyState message={loading ? "Loading profile…" : NO_PROFILE} />}
        </Card>
        <Card>
          <CardHeader title="Quick Actions" />
          <div className="p-4 flex flex-col gap-2.5">
            <Btn onClick={() => onNavigate("orders")}><ShoppingCart size={14} /> Manage Orders</Btn>
            <Btn variant="secondary" onClick={() => onNavigate("tracking")}><MapPin size={14} /> Shipment Tracking</Btn>
            <Btn variant="secondary" onClick={() => onNavigate("support")}><Headphones size={14} /> Contact DVS</Btn>
            <Btn variant="secondary" onClick={() => onNavigate("reports")}><BarChart3 size={14} /> Reports</Btn>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Active Orders" subtitle="Orders currently in progress" actions={<Btn size="sm" variant="ghost" onClick={() => onNavigate("orders")}>View All</Btn>} />
        {activeOrders.length === 0 ? <EmptyState message={loading ? "Loading orders…" : "No active orders."} /> : activeOrders.map((order) => (
          <div key={order.id} className="flex items-center gap-4 px-5 py-3.5" style={{ borderBottom: "1px solid #F7F3F2" }}>
            <div className="flex-shrink-0"><p style={{ fontSize: "0.8rem", fontWeight: 700, color: "#A52A2A" }}>{order.orderNumber}</p><p style={{ fontSize: "0.7rem", color: "#9A8A88" }}>{formatDate(order.orderDate)}</p></div>
            <div className="flex-1 min-w-0"><p className="truncate" style={{ fontSize: "0.8375rem", fontWeight: 500 }}>{order.product}</p><p style={{ fontSize: "0.72rem", color: "#9A8A88" }}>{order.quantity} {order.unit} · {formatMoney(order.value, order.currency)}</p></div>
            <div className="text-right flex-shrink-0"><StatusBadge status={statusLabel(order.status)} label={statusLabel(order.status)} /><p style={{ fontSize: "0.7rem", color: "#9A8A88", marginTop: "0.2rem" }}>Due: {formatDate(order.requiredDate)}</p></div>
          </div>
        ))}
      </Card>
    </div>
  );
}

function NewOrderDialog({ clientId, draft, onClose, onCreated }: { clientId: number; draft: OrderDraft | null; onClose: () => void; onCreated: () => Promise<void> }) {
  const [product, setProduct] = useState(draft?.product ?? "");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState(draft?.unit ?? "nos");
  const [requiredDate, setRequiredDate] = useState("");
  const [value, setValue] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Suggest the value from the last price paid when ordering again
  const onQuantity = (q: string) => {
    setQuantity(q);
    if (draft?.unitPrice != null && Number(q) > 0) setValue((draft.unitPrice * Number(q)).toFixed(2));
  };

  const submit = async () => {
    const qty = Number(quantity);
    if (!product.trim() || !Number.isInteger(qty) || qty <= 0 || !requiredDate) {
      setError("Product, a whole-number quantity and the required date are needed.");
      return;
    }
    setSaving(true); setError(null);
    try {
      // The server files a client login's order under its own record regardless
      await createClientOrder({ clientId, product: product.trim(), quantity: qty, unit: unit.trim() || "nos", value: value || null, requiredDate, notes: notes.trim() || null });
      await onCreated();
      toast.success("Order sent to DVS for approval");
      onClose();
    } catch (err) {
      setError(describeApiError(err, "submit the order"));
    } finally { setSaving(false); }
  };

  const field = { padding: "0.5rem 0.75rem", borderRadius: "0.5rem", border: "1px solid #E8E2E0", fontSize: "0.8375rem", width: "100%" };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div role="dialog" aria-label="Create new order" className="w-full max-w-md rounded-xl p-6" style={{ background: "#fff" }} onClick={(event) => event.stopPropagation()}>
        <h3 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "1rem" }}>Create New Order</h3>
        <div className="flex flex-col gap-3" style={{ fontSize: "0.8rem" }}>
          <label>Product<input style={field} value={product} onChange={(e) => setProduct(e.target.value)} placeholder="e.g. Assembly Clamp Battery" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label>Quantity<input style={field} type="number" min={1} step={1} value={quantity} onChange={(e) => onQuantity(e.target.value)} /></label>
            <label>Unit<input style={field} value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={20} /></label>
          </div>
          <label>Required by<input style={field} type="date" value={requiredDate} onChange={(e) => setRequiredDate(e.target.value)} /></label>
          <label>Order value in ₹ (optional){draft?.unitPrice != null && <span style={{ color: "#9A8A88" }}> · last price {formatMoney(draft.unitPrice)} / {draft.unit}</span>}
            <input style={field} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
          </label>
          <label>Notes (optional)<textarea style={field} rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="PO number, drawing revision, delivery address…" /></label>
          {error && <p role="alert" style={{ color: "#C0392B", fontSize: "0.8rem" }}>{error}</p>}
          <div className="flex gap-2"><Btn onClick={() => void submit()} disabled={saving}>{saving ? "Sending…" : "Submit Order"}</Btn><Btn variant="secondary" onClick={onClose}>Cancel</Btn></div>
        </div>
      </div>
    </div>
  );
}

function OrderManagement({ data, onRefresh, draft, onDraftUsed }: { data: ClientPortalData; onRefresh: () => Promise<void>; draft: OrderDraft | null; onDraftUsed: () => void }) {
  const [tab, setTab] = useState<"active" | "history">("active");
  const [dialog, setDialog] = useState<{ draft: OrderDraft | null } | null>(draft ? { draft } : null);
  const [cancelling, setCancelling] = useState<number | null>(null);
  useEffect(() => { if (draft) onDraftUsed(); }, [draft, onDraftUsed]);

  const orders = data.orders.filter((order) => (tab === "active" ? isOpen(order) : !isOpen(order)));

  const cancel = async (order: ClientOrderDto) => {
    if (!window.confirm(`Cancel ${order.orderNumber}?`)) return;
    setCancelling(order.id);
    try {
      await cancelClientOrder(order.id);
      await onRefresh();
      toast.success(`${order.orderNumber} cancelled`);
    } catch (err) {
      toast.error(describeApiError(err, "cancel the order"));
    } finally { setCancelling(null); }
  };

  return <div className="p-6">
    <PageHeader title="Order Management" subtitle="Place, track and review your orders with DVS Industries" actions={<Btn onClick={() => setDialog({ draft: null })} disabled={!data.profile}><Plus size={14} /> New Order</Btn>} />
    {dialog && data.profile && <NewOrderDialog clientId={data.profile.id} draft={dialog.draft} onClose={() => setDialog(null)} onCreated={onRefresh} />}
    <div className="flex gap-0 mb-5" style={{ borderBottom: "2px solid #E8E2E0" }}>{([["active", "Active Orders"], ["history", "Order History"]] as const).map(([id, label]) => <button key={id} onClick={() => setTab(id)} style={{ padding: "0.625rem 1rem", fontSize: "0.8375rem", fontWeight: tab === id ? 600 : 400, color: tab === id ? "#A52A2A" : "#7A6C6A", borderTop: "none", borderLeft: "none", borderRight: "none", borderBottom: `2px solid ${tab === id ? "#A52A2A" : "transparent"}`, marginBottom: "-2px", background: "transparent", cursor: "pointer" }}>{label}</button>)}</div>
    <Card><DataTable searchable paginate={10} emptyMsg={data.loading ? "Loading…" : "No orders in this view."}
      columns={[{ key: "id", label: "Order ID" }, { key: "product", label: "Product" }, { key: "qty", label: "Qty" }, { key: "orderDate", label: "Ordered" }, { key: "requiredDate", label: "Required By" }, { key: "value", label: "Value" }, { key: "invoice", label: "Invoice" }, { key: "status", label: "Status" }, { key: "actions", label: "" }]}
      rows={orders.map((order) => ({
        id: <span style={{ fontSize: "0.775rem", fontFamily: "JetBrains Mono, monospace", color: "#A52A2A", fontWeight: 700 }}>{order.orderNumber}</span>,
        product: <span style={{ fontWeight: 500 }}>{order.product}</span>,
        qty: `${order.quantity} ${order.unit}`,
        orderDate: formatDate(order.orderDate),
        requiredDate: formatDate(order.requiredDate),
        value: <span style={{ fontWeight: 600 }}>{formatMoney(order.value, order.currency)}</span>,
        invoice: order.invoiceNumber ?? "—",
        status: <StatusBadge status={statusLabel(order.status)} label={statusLabel(order.status)} />,
        actions: order.status === "PENDING"
          ? <Btn size="sm" variant="ghost" onClick={() => void cancel(order)} disabled={cancelling === order.id}>{cancelling === order.id ? "Cancelling…" : "Cancel"}</Btn>
          : null,
      }))} /></Card>
    <p className="mt-3" style={{ fontSize: "0.75rem", color: "#9A8A88" }}>Orders can be cancelled here until DVS approves them; after that, ask through the Support Center.</p>
  </div>;
}

function ProductCatalog({ data, onOrderAgain }: { data: ClientPortalData; onOrderAgain: (draft: OrderDraft) => void }) {
  const products = orderedProducts(data.orders);
  return <div className="p-6">
    <PageHeader title="Product Catalog" subtitle="Products DVS Industries makes for you, from your order history" />
    <Card><DataTable searchable paginate={10} emptyMsg={data.loading ? "Loading…" : "No products ordered yet. Place your first order from Order Management."}
      columns={[{ key: "product", label: "Product" }, { key: "orders", label: "Orders" }, { key: "qty", label: "Total Quantity" }, { key: "price", label: "Last Price" }, { key: "last", label: "Last Ordered" }, { key: "actions", label: "" }]}
      rows={products.map((p) => ({
        product: <span style={{ fontWeight: 500 }}>{p.product}</span>,
        orders: p.orders,
        qty: `${p.quantity.toLocaleString("en-IN")} ${p.unit}`,
        price: p.lastPrice === null ? "–" : `${formatMoney(p.lastPrice)} / ${p.unit}`,
        last: formatDate(p.lastOrder),
        actions: <Btn size="sm" onClick={() => onOrderAgain({ product: p.product, unit: p.unit, unitPrice: p.lastPrice })} disabled={!data.profile}><RotateCcw size={13} /> Order again</Btn>,
      }))} /></Card>
  </div>;
}

function ShipmentTracking({ data }: { data: ClientPortalData }) {
  const shipments = data.orders.filter((o) => o.status !== "CANCELLED")
    .sort((a, b) => (b.dispatchDate ?? b.orderDate).localeCompare(a.dispatchDate ?? a.orderDate));
  return <div className="p-6">
    <PageHeader title="Shipment Tracking" subtitle="Where each order is, with dispatch documents from DVS" />
    {shipments.length === 0 && <Card><EmptyState message={data.loading ? "Loading shipments…" : "No orders to track yet."} /></Card>}
    <div className="flex flex-col gap-4">
      {shipments.map((order) => (
        <Card key={order.id}>
          <CardHeader title={`${order.orderNumber} · ${order.product}`} subtitle={`${order.quantity} ${order.unit} · ordered ${formatDate(order.orderDate)}`}
            actions={<StatusBadge status={statusLabel(order.status)} label={statusLabel(order.status)} />} />
          <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-5">
            <ol className="flex flex-col gap-2.5" aria-label="Order progress">
              {orderTimeline(order).map((step) => (
                <li key={step.label} className="flex items-center gap-2.5" style={{ fontSize: "0.8375rem", color: step.done ? "#1C1C1C" : "#9A8A88" }}>
                  {step.done ? <CheckCircle2 size={16} color="#2E7D32" /> : <Circle size={16} color="#D4BFBB" />}
                  <span style={{ fontWeight: step.done ? 600 : 400 }}>{step.label}</span>
                  {step.date && step.done && <span style={{ color: "#9A8A88", fontSize: "0.75rem" }}>{formatDate(step.date)}</span>}
                </li>
              ))}
            </ol>
            <div className="grid grid-cols-2 gap-2.5 content-start" style={{ fontSize: "0.8125rem" }}>
              <p><strong>Challan:</strong> {order.challanNumber ?? "—"}</p>
              <p><strong>Invoice:</strong> {order.invoiceNumber ?? "—"}</p>
              <p><strong>Dispatched:</strong> {formatDate(order.dispatchDate)}</p>
              <p><strong>Delivered:</strong> {formatDate(order.deliveryDate)}</p>
              <p style={{ gridColumn: "span 2" }}><strong>Required by:</strong> {formatDate(order.requiredDate)}</p>
              {order.dispatchNote && <p style={{ gridColumn: "span 2", color: "#4A4A4A" }}><strong>Dispatch details:</strong> {order.dispatchNote}</p>}
            </div>
          </div>
        </Card>
      ))}
    </div>
  </div>;
}

function Notifications({ notifications, loading }: { notifications: PortalNotification[]; loading: boolean }) {
  const colour = { info: ACCENT, success: "#2E7D32", warn: "#E65100" };
  return <div className="p-6">
    <PageHeader title="Notifications" subtitle="Order updates and messages from DVS Industries" />
    <Card>
      {notifications.length === 0 ? <EmptyState message={loading ? "Loading…" : "No notifications yet."} /> : notifications.map((n) => (
        <div key={n.id} className="flex items-start gap-3 px-5 py-3.5" style={{ borderBottom: "1px solid #F7F3F2" }}>
          <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5" style={{ background: colour[n.type] }} />
          <div className="flex-1"><p style={{ fontSize: "0.8375rem" }}>{n.msg}</p><p style={{ fontSize: "0.7rem", color: "#9A8A88", marginTop: "0.2rem" }}>{formatDate(n.at)}</p></div>
        </div>
      ))}
    </Card>
  </div>;
}

function SupportCenter({ onMessages }: { onMessages: (messages: PortalMessageDto[]) => void }) {
  return <div className="p-6">
    <PageHeader title="Support Center" subtitle="Ask DVS Industries about orders, deliveries, invoices or quality" />
    <Card>
      <CardHeader title="Conversation with DVS Industries" subtitle="Replies appear here; the page checks for new messages every 30 seconds" />
      <PortalMessages asDvs={false} accent={ACCENT} placeholder="e.g. Please share the test certificate for invoice 26-27/2113" onMessages={onMessages} />
    </Card>
  </div>;
}

function ClientReports({ data }: { data: ClientPortalData }) {
  const { profile, orders, loading } = data;
  const products = orderedProducts(orders);
  const trend = clientOrderTrend(orders, 12);
  const code = profile?.code ?? "client";

  const exportOrders = () => downloadCSV(`${code}-orders.csv`, [
    ["Order Number", "Product", "Quantity", "Unit", "Value", "Currency", "Ordered", "Required By", "Dispatched", "Delivered", "Status", "Challan", "Invoice"],
    ...orders.map((o) => [o.orderNumber, o.product, o.quantity, o.unit, o.value, o.currency, o.orderDate.slice(0, 10), o.requiredDate?.slice(0, 10),
      o.dispatchDate?.slice(0, 10), o.deliveryDate?.slice(0, 10), o.status, o.challanNumber, o.invoiceNumber]),
  ]);
  const invoiced = orders.filter((o) => o.invoiceNumber);
  const exportInvoices = () => downloadCSV(`${code}-invoices.csv`, [
    ["Invoice", "Order Number", "Product", "Quantity", "Unit", "Value", "Currency", "Dispatched", "Challan", "Status"],
    ...invoiced.map((o) => [o.invoiceNumber, o.orderNumber, o.product, o.quantity, o.unit, o.value, o.currency, o.dispatchDate?.slice(0, 10), o.challanNumber, o.status]),
  ]);
  const exportProducts = () => downloadCSV(`${code}-products.csv`, [
    ["Product", "Orders", "Total Quantity", "Unit", "Last Price (INR)", "Last Ordered"],
    ...products.map((p) => [p.product, p.orders, p.quantity, p.unit, p.lastPrice?.toFixed(3), p.lastOrder.slice(0, 10)]),
  ]);

  const reports = [
    { title: "Order register", detail: `${orders.length} orders with dates, values and status`, run: exportOrders, rows: orders.length },
    { title: "Invoice list", detail: `${invoiced.length} invoiced orders with challan numbers`, run: exportInvoices, rows: invoiced.length },
    { title: "Products ordered", detail: `${products.length} products with quantities and last price`, run: exportProducts, rows: products.length },
  ];

  return <div className="p-6">
    <PageHeader title="Reports & Analytics" subtitle="Download your records with DVS Industries as CSV (opens in Excel)" />
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
      {reports.map((r) => (
        <Card key={r.title}>
          <div className="p-5 flex flex-col gap-3 h-full">
            <p style={{ fontSize: "0.9375rem", fontWeight: 600 }}>{r.title}</p>
            <p style={{ fontSize: "0.8rem", color: "#7A6C6A", flex: 1 }}>{loading ? "Loading…" : r.detail}</p>
            <Btn onClick={r.run} disabled={loading || r.rows === 0}><Download size={14} /> Download CSV</Btn>
          </div>
        </Card>
      ))}
    </div>
    <Card>
      <CardHeader title="Order Value per Month" subtitle="Last 12 months, cancelled orders excluded" />
      <div className="p-5">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={trend}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F0ECEB" />
            <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#9A8A88" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "#9A8A88" }} axisLine={false} tickLine={false} tickFormatter={(v) => formatINRCompact(Number(v))} />
            <Tooltip contentStyle={{ fontSize: "0.8rem" }} formatter={(v) => [formatMoney(Number(v)), "Value"]} />
            <Bar dataKey="value" fill={ACCENT} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  </div>;
}

export function ClientApp({ onLogout }: { onLogout: () => void }) {
  const [section, setSection] = useSectionHash("dashboard");
  const [draft, setDraft] = useState<OrderDraft | null>(null);
  const [data, setData] = useState<ClientPortalData>({ profile: null, orders: [], messages: [], loading: true, error: null });

  const loadData = useCallback(async () => {
    const user = getUser();
    setData((current) => ({ ...current, loading: true, error: null }));
    try {
      const clientResult = await withServerWake(() => getClients());
      const profile = clientResult.data.find((client) => user?.email && client.email?.toLowerCase() === user.email.toLowerCase()) ?? null;
      if (profile === null) {
        setData({ profile: null, orders: [], messages: [], loading: false, error: NO_PROFILE });
        return;
      }
      const [orders, messages] = await Promise.all([
        fetchAllPages((page) => getClientOrders({ page, pageSize: 100, sortBy: "orderDate", sortOrder: "desc" })),
        getPortalMessages().catch(() => [] as PortalMessageDto[]),
      ]);
      setData({ profile, orders, messages, loading: false, error: null });
    } catch (err) {
      const error = isApiError(err) && err.status === 404 ? NO_PROFILE : describeApiError(err, "load your client data");
      setData({ profile: null, orders: [], messages: [], loading: false, error });
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  const setMessages = useCallback((messages: PortalMessageDto[]) => setData((current) => ({ ...current, messages })), []);
  const clearDraft = useCallback(() => setDraft(null), []);
  const notifications = useMemo(() => clientNotifications(data.orders, data.messages), [data.orders, data.messages]);
  const orderAgain = (next: OrderDraft) => { setDraft(next); setSection("orders"); };

  const renderSection = () => {
    switch (section) {
      case "orders": return <OrderManagement data={data} onRefresh={loadData} draft={draft} onDraftUsed={clearDraft} />;
      case "catalog": return <ProductCatalog data={data} onOrderAgain={orderAgain} />;
      case "tracking": return <ShipmentTracking data={data} />;
      case "notifications": return <Notifications notifications={notifications} loading={data.loading} />;
      case "support": return <SupportCenter onMessages={setMessages} />;
      case "reports": return <ClientReports data={data} />;
      default: return <ClientDashboard onNavigate={setSection} data={data} onRetry={() => void loadData()} />;
    }
  };

  return <AppShell role="client" activeSection={section} onSectionChange={setSection} onLogout={onLogout}
    userName={data.profile?.name} portalNotifications={notifications}>{renderSection()}</AppShell>;
}
