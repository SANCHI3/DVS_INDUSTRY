import { useCallback, useEffect, useMemo, useState } from "react";
import { useSectionHash } from "../../../lib/useSectionHash";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, MessageSquare, RefreshCw } from "lucide-react";
import { AppShell } from "../shared/AppShell";
import { PageHeader, KPICard, Card, CardHeader, StatusBadge, Btn, DataTable } from "../shared/UI";
import { PortalMessages } from "../shared/PortalMessages";

import { getUser } from "../../../lib/auth";
import { describeApiError, fetchAllPages, isApiError, withServerWake } from "../../../lib/api";
import { downloadCSV } from "../../../lib/csv";
import {
  getPurchaseOrders, getSuppliers, type PurchaseOrderDto, type SupplierDto,
} from "../../../lib/services/orders.service";
import { getPortalMessages, type PortalMessageDto } from "../../../lib/services/portal.service";
import {
  deliveryStats, purchaseOrderTrend, suppliedMaterials, supplierNotifications,
} from "../../../lib/portalInsights";

const ACCENT = "#2E7D32";

type SupplierData = {
  profile: SupplierDto | null;
  purchaseOrders: PurchaseOrderDto[];
  messages: PortalMessageDto[];
  loading: boolean;
  error: string | null;
};

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "–";
}

function formatMoney(value: string | number | null, currency = "INR"): string {
  if (value === null) return "–";
  return `${currency === "INR" ? "₹" : currency + " "}${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function statusLabel(status: string): string {
  return status.toLowerCase().replace(/_/g, " ");
}

function EmptyState({ message }: { message: string }) {
  return <p className="p-5" style={{ color: "#7A6C6A", fontSize: "0.8375rem" }}>{message}</p>;
}

function LoadError({ data, onRetry }: { data: SupplierData; onRetry: () => void }) {
  if (!data.error) return null;
  return (
    <div className="mb-5 flex items-center justify-between gap-3 rounded-lg px-4 py-3" role="alert" style={{ background: "#FFEBEE", color: "#C0392B", fontSize: "0.8375rem" }}>
      <span>{data.error}</span>
      <Btn size="sm" variant="secondary" onClick={onRetry}><RefreshCw size={13} /> Try again</Btn>
    </div>
  );
}

function SupplierDashboard({ onNavigate, data, onRetry }: { onNavigate: (s: string) => void; data: SupplierData; onRetry: () => void }) {
  const { profile, purchaseOrders, messages, loading } = data;
  const open = purchaseOrders.filter((po) => !["DELIVERED", "CANCELLED"].includes(po.status));
  const pending = purchaseOrders.filter((po) => po.status === "PENDING").length;
  const delivered = purchaseOrders.filter((po) => po.status === "DELIVERED").length;
  const procurementTotal = purchaseOrders.filter((po) => po.status !== "CANCELLED")
    .reduce((sum, po) => sum + Number(po.totalCost ?? 0), 0);
  const materials = suppliedMaterials(purchaseOrders);
  const stats = deliveryStats(purchaseOrders);
  const fromDvs = messages.filter((m) => m.fromDvs).slice(-3).reverse();
  const dash = (v: string | number) => (loading ? "—" : String(v));

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 style={{ fontSize: "1.3rem", fontWeight: 700 }}>Supplier Dashboard</h1>
          <p style={{ fontSize: "0.8375rem", color: "#7A6C6A" }}>
            {profile ? `${profile.name} · Partner ID: ${profile.code}` : loading ? "Loading…" : "Supplier profile unavailable"}
          </p>
        </div>
      </div>

      <LoadError data={data} onRetry={onRetry} />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-5">
        <KPICard label="Open Orders" value={dash(open.length)} sub="from DVS" accent={ACCENT} />
        <KPICard label="Awaiting Confirmation" value={dash(pending)} accent="#E65100" />
        <KPICard label="Delivered Orders" value={dash(delivered)} accent={ACCENT} />
        <KPICard label="Procurement Total" value={loading ? "—" : formatMoney(procurementTotal)} accent="#4E342E" />
        <KPICard label="Materials Supplied" value={dash(materials.length)} sub="distinct materials" accent="#1565C0" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        <Card style={{ gridColumn: "span 2" }}>
          <CardHeader title="Supplier Profile" subtitle="As held by DVS Industries" />
          {profile ? <div className="p-5 grid grid-cols-2 gap-3" style={{ fontSize: "0.8375rem" }}>
            <p><strong>Name:</strong> {profile.name}</p><p><strong>Code:</strong> {profile.code}</p>
            <p><strong>Contact:</strong> {profile.contactName ?? "—"}</p><p><strong>Email:</strong> {profile.email ?? "—"}</p>
            <p><strong>Phone:</strong> {profile.phone ?? "—"}</p><p><strong>Location:</strong> {[profile.city, profile.state, profile.country].filter(Boolean).join(", ") || "—"}</p>
            <p><strong>GSTIN:</strong> {profile.gstin ?? "—"}</p><p><strong>Lead time:</strong> {profile.leadTimeDays === null ? "—" : `${profile.leadTimeDays} days`}</p>
            <p style={{ gridColumn: "span 2" }}><strong>Materials:</strong> {profile.materials ?? "—"}</p>
          </div> : <EmptyState message={loading ? "Loading profile…" : "No supplier record matches this login's email. Ask DVS to set it on your supplier record."} />}
        </Card>

        <Card>
          <CardHeader title="On-Time Delivery" subtitle="Delivered orders vs. expected date" />
          <div className="p-5 flex flex-col items-center justify-center">
            <div className="w-28 h-28 rounded-full flex items-center justify-center mb-4" style={{ background: "linear-gradient(135deg, #E8F5E9, #C8E6C9)", border: `4px solid ${ACCENT}` }}>
              <p style={{ fontSize: "1.5rem", fontWeight: 800, color: ACCENT }}>{stats.onTimePct === null ? "—" : `${stats.onTimePct.toFixed(0)}%`}</p>
            </div>
            <p style={{ fontSize: "0.8rem", color: "#4A4A4A", textAlign: "center" }}>
              {stats.measured ? `${stats.onTime} of ${stats.measured} deliveries on time` : "Measured once DVS records deliveries with an expected date"}
            </p>
            {profile?.rating && <p style={{ fontSize: "0.8rem", color: "#7A6C6A", marginTop: "0.4rem" }}>DVS rating: {profile.rating} / 5</p>}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <CardHeader title="Recent Orders from DVS" actions={<Btn size="sm" onClick={() => onNavigate("purchase-orders")}>View All</Btn>} />
          {purchaseOrders.length === 0 ? <EmptyState message={loading ? "Loading orders…" : "No purchase orders yet."} /> : purchaseOrders.slice(0, 4).map((o) => (
            <div key={o.id} className="flex items-center gap-3 px-5 py-3.5" style={{ borderBottom: "1px solid #F7F3F2" }}>
              <div>
                <p style={{ fontSize: "0.8rem", fontWeight: 600, color: ACCENT }}>{o.poNumber}</p>
                <p style={{ fontSize: "0.7rem", color: "#9A8A88" }}>{formatDate(o.orderDate)}</p>
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate" style={{ fontSize: "0.8125rem", fontWeight: 500 }}>{o.material}</p>
                <p style={{ fontSize: "0.72rem", color: "#9A8A88" }}>{o.quantity} {o.unit ?? ""} · {formatMoney(o.totalCost, o.currency)}</p>
              </div>
              <StatusBadge status={o.status} label={statusLabel(o.status)} />
            </div>
          ))}
        </Card>

        <Card>
          <CardHeader title="Messages from DVS" actions={<Btn size="sm" onClick={() => onNavigate("communication")}><MessageSquare size={13} /> Open</Btn>} />
          {fromDvs.length === 0 ? <EmptyState message={loading ? "Loading messages…" : "No messages from DVS yet. Use Communication to contact the DVS purchase team."} /> : fromDvs.map((m) => (
            <div key={m.id} className="px-5 py-3.5" style={{ borderBottom: "1px solid #F7F3F2" }}>
              <p style={{ fontSize: "0.8125rem", whiteSpace: "pre-wrap" }}>{m.body.length > 160 ? `${m.body.slice(0, 160)}…` : m.body}</p>
              <p style={{ fontSize: "0.7rem", color: "#9A8A88", marginTop: "0.2rem" }}>{formatDate(m.createdAt)}</p>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

function MaterialCatalog({ data }: { data: SupplierData }) {
  const rows = suppliedMaterials(data.purchaseOrders);
  return (
    <div className="p-6">
      <PageHeader title="Material Catalog" subtitle="Materials DVS Industries buys from you, from your purchase orders" />
      {data.profile?.materials && (
        <Card className="mb-5"><div className="p-5" style={{ fontSize: "0.8375rem" }}><strong>Registered materials:</strong> {data.profile.materials}</div></Card>
      )}
      <Card>
        <DataTable
          searchable
          paginate={10}
          exportFilename="material-catalog.csv"
          emptyMsg={data.loading ? "Loading…" : "No materials ordered yet."}
          columns={[
            { key: "material", label: "Material" },
            { key: "orders", label: "Orders" },
            { key: "qty", label: "Total Quantity" },
            { key: "rate", label: "Last Rate" },
            { key: "value", label: "Total Value" },
            { key: "last", label: "Last Ordered" },
          ]}
          rows={rows.map((m) => ({
            material: <span style={{ fontWeight: 500 }}>{m.material}</span>,
            orders: m.orders,
            qty: `${m.quantity.toLocaleString("en-IN")} ${m.unit}`,
            rate: m.lastRate === null ? "–" : `${formatMoney(m.lastRate)} / ${m.unit || "unit"}`,
            value: formatMoney(m.value),
            last: formatDate(m.lastOrder),
          }))}
        />
      </Card>
    </div>
  );
}

function PurchaseOrders({ data }: { data: SupplierData }) {
  return (
    <div className="p-6">
      <PageHeader title="Purchase Orders" subtitle="Orders received from DVS Industries" />
      <Card>
        <DataTable
          searchable
          paginate={10}
          exportFilename="purchase-orders.csv"
          emptyMsg={data.loading ? "Loading…" : "No purchase orders found for this supplier."}
          columns={[
            { key: "id", label: "PO Number" },
            { key: "material", label: "Material" },
            { key: "qty", label: "Quantity" },
            { key: "orderDate", label: "Order Date" },
            { key: "deadline", label: "Expected Delivery" },
            { key: "value", label: "Value" },
            { key: "status", label: "Status" },
            { key: "notes", label: "Notes" },
          ]}
          rows={data.purchaseOrders.map((o) => ({
            id: <span style={{ fontSize: "0.775rem", fontFamily: "JetBrains Mono, monospace", color: ACCENT, fontWeight: 600 }}>{o.poNumber}</span>,
            material: <span style={{ fontWeight: 500 }}>{o.material}</span>,
            qty: `${o.quantity} ${o.unit ?? ""}`,
            orderDate: formatDate(o.orderDate),
            deadline: <span style={{ fontWeight: 500, color: o.status === "PENDING" ? "#E65100" : "#4A4A4A" }}>{formatDate(o.expectedDelivery)}</span>,
            value: <span style={{ fontWeight: 600 }}>{formatMoney(o.totalCost, o.currency)}</span>,
            status: <StatusBadge status={o.status} label={statusLabel(o.status)} />,
            notes: <span style={{ fontSize: "0.75rem", color: "#7A6C6A" }}>{o.notes ?? "—"}</span>,
          }))}
        />
      </Card>
      <p className="mt-3" style={{ fontSize: "0.75rem", color: "#9A8A88" }}>Order status is updated by the DVS store team. Use Communication to confirm dates or report a delay.</p>
    </div>
  );
}

function DeliveryManagement({ data }: { data: SupplierData }) {
  const { purchaseOrders, loading } = data;
  const today = Date.now();
  const lateness = (o: PurchaseOrderDto) => {
    if (!o.expectedDelivery) return "—";
    const end = o.actualDelivery ? Date.parse(o.actualDelivery) : today;
    const days = Math.round((end - Date.parse(o.expectedDelivery)) / 86_400_000);
    if (o.status === "CANCELLED") return "—";
    if (days > 0) return <span style={{ color: "#C0392B", fontWeight: 600 }}>{days} day{days === 1 ? "" : "s"} late</span>;
    return <span style={{ color: ACCENT }}>{o.actualDelivery ? "On time" : "On track"}</span>;
  };
  return (
    <div className="p-6">
      <PageHeader title="Delivery Management" subtitle="Delivery status of every purchase order" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <KPICard label="Awaiting Confirmation" value={loading ? "—" : purchaseOrders.filter((o) => o.status === "PENDING").length} accent="#E65100" />
        <KPICard label="Confirmed" value={loading ? "—" : purchaseOrders.filter((o) => o.status === "CONFIRMED").length} accent="#1565C0" />
        <KPICard label="In Transit" value={loading ? "—" : purchaseOrders.filter((o) => o.status === "IN_TRANSIT").length} accent="#6A1B9A" />
        <KPICard label="Delivered" value={loading ? "—" : purchaseOrders.filter((o) => o.status === "DELIVERED").length} accent={ACCENT} />
      </div>
      <Card>
        <DataTable
          searchable
          paginate={10}
          emptyMsg={loading ? "Loading…" : "No delivery records found for this supplier."}
          columns={[
            { key: "id", label: "PO Number" },
            { key: "material", label: "Material" },
            { key: "qty", label: "Quantity" },
            { key: "expected", label: "Expected" },
            { key: "actual", label: "Delivered" },
            { key: "timing", label: "Timing" },
            { key: "status", label: "Status" },
          ]}
          rows={purchaseOrders.map((o) => ({
            id: <span style={{ fontSize: "0.775rem", fontFamily: "JetBrains Mono, monospace", color: ACCENT }}>{o.poNumber}</span>,
            material: o.material,
            qty: `${o.quantity} ${o.unit ?? ""}`,
            expected: formatDate(o.expectedDelivery),
            actual: formatDate(o.actualDelivery),
            timing: lateness(o),
            status: <StatusBadge status={o.status} label={statusLabel(o.status)} />,
          }))}
        />
      </Card>
    </div>
  );
}

function Communication({ onMessages }: { onMessages: (messages: PortalMessageDto[]) => void }) {
  return (
    <div className="p-6">
      <PageHeader title="Communication Center" subtitle="Message the DVS Industries purchase team" />
      <Card>
        <CardHeader title="Conversation with DVS Industries" subtitle="Replies appear here; the page checks for new messages every 30 seconds" />
        <PortalMessages asDvs={false} accent={ACCENT} placeholder="e.g. PO-MAL-96-1 will dispatch on Friday" onMessages={onMessages} />
      </Card>
    </div>
  );
}

function SupplierPerformance({ data }: { data: SupplierData }) {
  const { profile, purchaseOrders, loading } = data;
  const stats = deliveryStats(purchaseOrders);
  const trend = purchaseOrderTrend(purchaseOrders);
  const closed = purchaseOrders.filter((po) => po.status !== "CANCELLED");
  const delivered = closed.filter((po) => po.status === "DELIVERED").length;
  const completion = closed.length ? `${((delivered / closed.length) * 100).toFixed(1)}%` : "—";
  return (
    <div className="p-6">
      <PageHeader title="My Performance" subtitle="On-time delivery and order completion, from your purchase orders" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <KPICard label="On-Time Delivery" value={loading || stats.onTimePct === null ? "—" : `${stats.onTimePct.toFixed(1)}%`} sub={stats.measured ? `${stats.measured} measured` : "no measured deliveries yet"} accent={ACCENT} />
        <KPICard label="Order Completion" value={loading ? "—" : completion} sub="delivered / ordered" accent={ACCENT} />
        <KPICard label="Average Delay" value={stats.avgDaysLate === null ? "—" : `${stats.avgDaysLate.toFixed(1)} days`} sub="late deliveries only" accent="#E65100" />
        <KPICard label="DVS Rating" value={profile?.rating ? `${profile.rating}/5` : "—"} sub={profile?.reliability ?? undefined} accent="#F57F17" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <CardHeader title="Orders per Month" subtitle="Last 6 months" />
          <div className="p-5">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0ECEB" />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#9A8A88" }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#9A8A88" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ fontSize: "0.8rem" }} />
                <Bar dataKey="orders" name="Orders" fill={ACCENT} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <CardHeader title="On-Time Delivery Trend" subtitle="By order month; gaps mean no measured deliveries" />
          <div className="p-5">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0ECEB" />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#9A8A88" }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "#9A8A88" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ fontSize: "0.8rem" }} formatter={(v) => [`${Number(v).toFixed(0)}%`, "On time"]} />
                <Line type="monotone" dataKey="onTimePct" stroke={ACCENT} strokeWidth={2} connectNulls dot />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  );
}

function SupplierReports({ data }: { data: SupplierData }) {
  const { profile, purchaseOrders, loading } = data;
  const materials = suppliedMaterials(purchaseOrders);
  const trend = purchaseOrderTrend(purchaseOrders, 12);
  const code = profile?.code ?? "supplier";

  const exportOrders = () => downloadCSV(`${code}-purchase-orders.csv`, [
    ["PO Number", "Material", "Quantity", "Unit", "Total Cost", "Currency", "Order Date", "Expected Delivery", "Actual Delivery", "Status", "Notes"],
    ...purchaseOrders.map((o) => [o.poNumber, o.material, o.quantity, o.unit, o.totalCost, o.currency, o.orderDate.slice(0, 10),
      o.expectedDelivery?.slice(0, 10), o.actualDelivery?.slice(0, 10), o.status, o.notes]),
  ]);
  const exportMaterials = () => downloadCSV(`${code}-materials.csv`, [
    ["Material", "Orders", "Total Quantity", "Unit", "Total Value (INR)", "Last Rate (INR)", "Last Ordered"],
    ...materials.map((m) => [m.material, m.orders, m.quantity, m.unit, m.value.toFixed(2), m.lastRate?.toFixed(3), m.lastOrder.slice(0, 10)]),
  ]);
  const exportMonthly = () => downloadCSV(`${code}-monthly-summary.csv`, [
    ["Month", "Orders", "Value (INR)", "On-time %"],
    ...trend.map((t) => [t.month, t.orders, t.value.toFixed(2), t.onTimePct?.toFixed(1)]),
  ]);

  const reports = [
    { title: "Purchase order register", detail: `${purchaseOrders.length} orders with dates, values and status`, run: exportOrders },
    { title: "Materials supplied", detail: `${materials.length} materials with quantities, values and last rate`, run: exportMaterials },
    { title: "Monthly summary", detail: "Orders, value and on-time share for the last 12 months", run: exportMonthly },
  ];

  return (
    <div className="p-6">
      <PageHeader title="Reports" subtitle="Download your records with DVS Industries as CSV (opens in Excel)" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        {reports.map((r) => (
          <Card key={r.title}>
            <div className="p-5 flex flex-col gap-3 h-full">
              <p style={{ fontSize: "0.9375rem", fontWeight: 600 }}>{r.title}</p>
              <p style={{ fontSize: "0.8rem", color: "#7A6C6A", flex: 1 }}>{loading ? "Loading…" : r.detail}</p>
              <Btn onClick={r.run} disabled={loading || purchaseOrders.length === 0}><Download size={14} /> Download CSV</Btn>
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
              <YAxis tick={{ fontSize: 10, fill: "#9A8A88" }} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${(Number(v) / 1000).toFixed(0)}k`} />
              <Tooltip contentStyle={{ fontSize: "0.8rem" }} formatter={(v) => [formatMoney(Number(v)), "Value"]} />
              <Bar dataKey="value" fill={ACCENT} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

export function SupplierApp({ onLogout }: { onLogout: () => void }) {
  const [section, setSection] = useSectionHash("dashboard");
  const [data, setData] = useState<SupplierData>({ profile: null, purchaseOrders: [], messages: [], loading: true, error: null });

  const loadData = useCallback(async () => {
    const user = getUser();
    setData((current) => ({ ...current, loading: true, error: null }));
    try {
      const supplierResult = await withServerWake(() => getSuppliers());
      const profile = supplierResult.data.find((supplier) =>
        user?.email && supplier.email?.toLowerCase() === user.email.toLowerCase(),
      ) ?? null;
      if (profile === null) {
        setData({ profile: null, purchaseOrders: [], messages: [], loading: false, error: "No supplier record matches this login's email. Ask DVS to set it on your supplier record." });
        return;
      }
      const [purchaseOrders, messages] = await Promise.all([
        fetchAllPages((page) => getPurchaseOrders({ supplierId: profile.id, page, pageSize: 100, sortBy: "orderDate", sortOrder: "desc" })),
        getPortalMessages().catch(() => [] as PortalMessageDto[]),
      ]);
      setData({ profile, purchaseOrders, messages, loading: false, error: null });
    } catch (err: unknown) {
      // The API answers 404 when no supplier record is linked to this login
      const error = isApiError(err) && err.status === 404
        ? "No supplier record matches this login's email. Ask DVS to set it on your supplier record."
        : describeApiError(err, "load your supplier data");
      setData({ profile: null, purchaseOrders: [], messages: [], loading: false, error });
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  const setMessages = useCallback((messages: PortalMessageDto[]) => setData((current) => ({ ...current, messages })), []);
  const notifications = useMemo(() => supplierNotifications(data.purchaseOrders, data.messages), [data.purchaseOrders, data.messages]);

  const renderSection = () => {
    switch (section) {
      case "catalog": return <MaterialCatalog data={data} />;
      case "purchase-orders": return <PurchaseOrders data={data} />;
      case "delivery": return <DeliveryManagement data={data} />;
      case "communication": return <Communication onMessages={setMessages} />;
      case "performance": return <SupplierPerformance data={data} />;
      case "reports": return <SupplierReports data={data} />;
      default: return <SupplierDashboard onNavigate={setSection} data={data} onRetry={() => void loadData()} />;
    }
  };

  return (
    <AppShell role="supplier" activeSection={section} onSectionChange={setSection} onLogout={onLogout}
      userName={data.profile?.name} portalNotifications={notifications}>
      {renderSection()}
    </AppShell>
  );
}
