import { useEffect, useState } from "react";
import { BarChart3, MapPin, Plus, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "../shared/AppShell";
import { PageHeader, KPICard, Card, CardHeader, StatusBadge, Btn, DataTable } from "../shared/UI";
import { getUser } from "../../../lib/auth";
import {
  createClientOrder,
  getClientOrders,
  getClients,
  type ClientDto,
  type ClientOrderDto,
} from "../../../lib/services/orders.service";

type ClientPortalData = {
  profile: ClientDto | null;
  orders: ClientOrderDto[];
  loading: boolean;
  error: string | null;
};

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "–";
}

function formatMoney(value: string | null, currency = "INR"): string {
  if (value === null) return "–";
  return `${currency === "INR" ? "₹" : `${currency} `}${Number(value).toLocaleString("en-IN")}`;
}

function statusLabel(status: string): string {
  return status.toLowerCase().replace(/_/g, " ");
}

function EmptyState({ message }: { message: string }) {
  return <p className="p-5" style={{ color: "#7A6C6A", fontSize: "0.8375rem" }}>{message}</p>;
}

function UnavailablePage({ title, subtitle }: { title: string; subtitle: string }) {
  return <div className="p-6"><PageHeader title={title} subtitle={subtitle} /><Card><EmptyState message="This feature is not supported by the existing backend." /></Card></div>;
}

function ClientDashboard({ onNavigate, data }: { onNavigate: (section: string) => void; data: ClientPortalData }) {
  const { profile, orders, loading, error } = data;
  const activeOrders = orders.filter((order) => !["DELIVERED", "CANCELLED"].includes(order.status));
  const completedOrders = orders.filter((order) => order.status === "DELIVERED");
  const totalSpend = orders.reduce((sum, order) => sum + Number(order.value ?? 0), 0);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 style={{ fontSize: "1.3rem", fontWeight: 700 }}>Client Dashboard</h1>
          <p style={{ fontSize: "0.8375rem", color: "#7A6C6A" }}>{profile ? `${profile.name} · Client ID: ${profile.code}` : "Client profile unavailable"}</p>
        </div>
        <Btn onClick={() => onNavigate("orders")}><Plus size={14} /> New Order</Btn>
      </div>

      {error && <p className="mb-5" style={{ color: "#C0392B", fontSize: "0.8375rem" }}>{error}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <KPICard label="Active Orders" value={loading ? "—" : activeOrders.length} sub="in progress" accent="#A52A2A" />
        <KPICard label="Completed Orders" value={loading ? "—" : completedOrders.length} accent="#2E7D32" />
        <KPICard label="Pending Deliveries" value={loading ? "—" : orders.filter((order) => order.status === "DISPATCHED").length} accent="#E65100" />
        <KPICard label="Order Value" value={loading ? "—" : formatMoney(totalSpend.toFixed(2))} accent="#4E342E" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        <Card style={{ gridColumn: "span 2" }}>
          <CardHeader title="Client Profile" subtitle="Data from the existing Client API" />
          {profile ? <div className="p-5 grid grid-cols-2 gap-3" style={{ fontSize: "0.8375rem" }}>
            <p><strong>Name:</strong> {profile.name}</p><p><strong>Code:</strong> {profile.code}</p>
            <p><strong>Contact:</strong> {profile.contactName ?? "—"}</p><p><strong>Email:</strong> {profile.email ?? "—"}</p>
            <p><strong>Phone:</strong> {profile.phone ?? "—"}</p><p><strong>Location:</strong> {[profile.city, profile.state, profile.country].filter(Boolean).join(", ") || "—"}</p>
          </div> : <EmptyState message="No Client record matches the authenticated user's email." />}
        </Card>
        <Card>
          <CardHeader title="Client Analytics" subtitle="Available from current order data" />
          <div className="p-5 flex flex-col gap-3">
            <p style={{ fontSize: "0.8375rem" }}>Orders loaded: <strong>{loading ? "—" : orders.length}</strong></p>
            <p style={{ fontSize: "0.8375rem" }}>Delivered: <strong>{loading ? "—" : completedOrders.length}</strong></p>
            <p style={{ fontSize: "0.8375rem" }}>Total order value: <strong>{loading ? "—" : formatMoney(totalSpend.toFixed(2))}</strong></p>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card style={{ gridColumn: "span 2" }}>
          <CardHeader title="Active Orders" subtitle="Orders currently in progress" actions={<Btn size="sm" variant="ghost" onClick={() => onNavigate("orders")}>View All</Btn>} />
          {activeOrders.length === 0 ? <EmptyState message={loading ? "Loading orders…" : "No active orders found."} /> : activeOrders.map((order) => (
            <div key={order.id} className="flex items-center gap-4 px-5 py-3.5" style={{ borderBottom: "1px solid #F7F3F2" }}>
              <div className="flex-shrink-0"><p style={{ fontSize: "0.8rem", fontWeight: 700, color: "#A52A2A" }}>{order.orderNumber}</p><p style={{ fontSize: "0.7rem", color: "#9A8A88" }}>{formatDate(order.orderDate)}</p></div>
              <div className="flex-1 min-w-0"><p style={{ fontSize: "0.8375rem", fontWeight: 500 }}>{order.product}</p><p style={{ fontSize: "0.72rem", color: "#9A8A88" }}>{order.quantity} {order.unit} · {formatMoney(order.value, order.currency)}</p></div>
              <div className="text-right flex-shrink-0"><StatusBadge status={statusLabel(order.status)} label={statusLabel(order.status)} /><p style={{ fontSize: "0.7rem", color: "#9A8A88", marginTop: "0.2rem" }}>Due: {formatDate(order.requiredDate)}</p></div>
            </div>
          ))}
        </Card>
        <Card>
          <CardHeader title="Quick Actions" />
          <div className="p-4 flex flex-col gap-2.5">
            <Btn onClick={() => onNavigate("orders")}><ShoppingCart size={14} /> Manage Orders</Btn>
            <Btn variant="secondary" onClick={() => onNavigate("tracking")}><MapPin size={14} /> Shipment Tracking</Btn>
            <Btn variant="secondary" onClick={() => onNavigate("reports")}><BarChart3 size={14} /> Reports</Btn>
          </div>
        </Card>
      </div>
    </div>
  );
}

function OrderManagement({ data, onRefresh }: { data: ClientPortalData; onRefresh: () => Promise<void> }) {
  const [tab, setTab] = useState<"active" | "history">("active");
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [product, setProduct] = useState("");
  const [quantity, setQuantity] = useState("");
  const [requiredDate, setRequiredDate] = useState("");
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const orders = data.orders.filter((order) => tab === "active" ? !["DELIVERED", "CANCELLED"].includes(order.status) : ["DELIVERED", "CANCELLED"].includes(order.status));

  const submitOrder = async () => {
    if (!data.profile || !product.trim() || !quantity || !requiredDate) { setError("Client, product, quantity, and required date are required."); return; }
    setSaving(true); setError(null);
    try {
      await createClientOrder({ clientId: data.profile.id, product, quantity: Number(quantity), value: value || null, requiredDate });
      await onRefresh();
      setShowNewOrder(false); setProduct(""); setQuantity(""); setRequiredDate(""); setValue("");
      toast.success("Order submitted successfully");
    } catch { setError("Order could not be submitted."); } finally { setSaving(false); }
  };

  return <div className="p-6">
    <PageHeader title="Order Management" subtitle="Track, manage, and review your orders from DVS Industries" actions={<Btn onClick={() => setShowNewOrder(true)}><Plus size={14} /> New Order</Btn>} />
    {showNewOrder && <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={() => setShowNewOrder(false)}><div className="w-full max-w-md rounded-xl p-6" style={{ background: "#fff" }} onClick={(event) => event.stopPropagation()}><h3 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "1rem" }}>Create New Order</h3><div className="flex flex-col gap-3"><input placeholder="Product" value={product} onChange={(event) => setProduct(event.target.value)} /><input placeholder="Quantity" type="number" value={quantity} onChange={(event) => setQuantity(event.target.value)} /><input type="date" value={requiredDate} onChange={(event) => setRequiredDate(event.target.value)} /><input placeholder="Order value (optional)" value={value} onChange={(event) => setValue(event.target.value)} />{error && <p style={{ color: "#C0392B", fontSize: "0.8rem" }}>{error}</p>}<div className="flex gap-2"><Btn onClick={submitOrder} disabled={saving}>{saving ? "Saving…" : "Submit Order"}</Btn><Btn variant="secondary" onClick={() => setShowNewOrder(false)}>Cancel</Btn></div></div></div></div>}
    <div className="flex gap-0 mb-5" style={{ borderBottom: "2px solid #E8E2E0" }}>{[["active", "Active Orders"], ["history", "Order History"]].map(([id, label]) => <button key={id} onClick={() => setTab(id as "active" | "history")} style={{ padding: "0.625rem 1rem", fontSize: "0.8375rem", fontWeight: tab === id ? 600 : 400, color: tab === id ? "#A52A2A" : "#7A6C6A", borderTop: "none", borderLeft: "none", borderRight: "none", borderBottom: `2px solid ${tab === id ? "#A52A2A" : "transparent"}`, marginBottom: "-2px", background: "transparent", cursor: "pointer" }}>{label}</button>)}</div>
    <Card><DataTable searchable paginate={10} columns={[{ key: "id", label: "Order ID" }, { key: "product", label: "Product" }, { key: "qty", label: "Qty" }, { key: "orderDate", label: "Ordered" }, { key: "requiredDate", label: "Required By" }, { key: "value", label: "Value" }, { key: "status", label: "Status" }]} rows={orders.map((order) => ({ id: <span style={{ fontSize: "0.775rem", fontFamily: "JetBrains Mono, monospace", color: "#A52A2A", fontWeight: 700 }}>{order.orderNumber}</span>, product: <span style={{ fontWeight: 500 }}>{order.product}</span>, qty: `${order.quantity} ${order.unit}`, orderDate: formatDate(order.orderDate), requiredDate: formatDate(order.requiredDate), value: <span style={{ fontWeight: 600 }}>{formatMoney(order.value, order.currency)}</span>, status: <StatusBadge status={statusLabel(order.status)} label={statusLabel(order.status)} /> }))} /></Card>
    {!data.loading && orders.length === 0 && <Card><EmptyState message="No orders found in this view." /></Card>}
  </div>;
}

function ClientAppUnavailable({ title, subtitle }: { title: string; subtitle: string }) { return <UnavailablePage title={title} subtitle={subtitle} />; }

export function ClientApp({ onLogout }: { onLogout: () => void }) {
  const [section, setSection] = useState("dashboard");
  const [data, setData] = useState<ClientPortalData>({ profile: null, orders: [], loading: true, error: null });

  const loadData = async () => {
    const user = getUser();
    if (!user?.email) { setData({ profile: null, orders: [], loading: false, error: "Authenticated client email is unavailable." }); return; }
    setData((current) => ({ ...current, loading: true, error: null }));
    try {
      const [clientResult, orderResult] = await Promise.all([getClients(), getClientOrders()]);
      const profile = clientResult.data.find((client) => client.email?.toLowerCase() === user.email.toLowerCase()) ?? null;
      setData({ profile, orders: orderResult.data, loading: false, error: profile ? null : "No Client record matches the authenticated user's email." });
    } catch { setData({ profile: null, orders: [], loading: false, error: "Client data could not be loaded." }); }
  };

  useEffect(() => { void loadData(); }, []);

  const renderSection = () => {
    switch (section) {
      case "dashboard": return <ClientDashboard onNavigate={setSection} data={data} />;
      case "orders": return <OrderManagement data={data} onRefresh={loadData} />;
      case "catalog": return <ClientAppUnavailable title="Product Catalog" subtitle="Product catalog data is not supported by the existing backend" />;
      case "tracking": return <ClientAppUnavailable title="Shipment Tracking" subtitle="Shipment tracking numbers and carrier events are not supported by the existing backend" />;
      case "notifications": return <ClientAppUnavailable title="Notifications" subtitle="Client notifications are not supported by the existing backend" />;
      case "support": return <ClientAppUnavailable title="Support Center" subtitle="Support tickets and messaging are not supported by the existing backend" />;
      case "reports": return <ClientAppUnavailable title="Reports & Analytics" subtitle="Client-specific reports and invoice downloads are not supported by the existing backend" />;
      default: return <ClientDashboard onNavigate={setSection} data={data} />;
    }
  };

  return <AppShell role="client" activeSection={section} onSectionChange={setSection} onLogout={onLogout}>{renderSection()}</AppShell>;
}