import { useEffect, useState } from "react";
import { LineChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { AppShell } from "../shared/AppShell";
import { PageHeader, KPICard, Card, CardHeader, StatusBadge, Btn, DataTable } from "../shared/UI";

import { getUser } from "../../../lib/auth";
import { isApiError } from "../../../lib/api";
import {
  getPurchaseOrders, getSuppliers, type PurchaseOrderDto, type SupplierDto,
} from "../../../lib/services/orders.service";

type SupplierData = {
  profile: SupplierDto | null;
  purchaseOrders: PurchaseOrderDto[];
  loading: boolean;
  error: string | null;
};

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "–";
}

function formatMoney(value: string | null, currency = "INR"): string {
  if (value === null) return "–";
  return `${currency === "INR" ? "₹" : currency + " "}${Number(value).toLocaleString("en-IN")}`;
}

function statusLabel(status: string): string {
  return status.toLowerCase().replace("_", " ");
}

function EmptyState({ message }: { message: string }) {
  return <p className="p-5" style={{ color: "#7A6C6A", fontSize: "0.8375rem" }}>{message}</p>;
}

function SupplierDashboard({ onNavigate, data }: { onNavigate: (s: string) => void; data: SupplierData }) {
  const { profile, purchaseOrders, loading, error } = data;
  const pending = purchaseOrders.filter((po) => po.status === "PENDING").length;
  const delivered = purchaseOrders.filter((po) => po.status === "DELIVERED").length;
  const procurementTotal = purchaseOrders.reduce((sum, po) => sum + Number(po.totalCost ?? 0), 0);
  const recentOrders = purchaseOrders.slice(0, 3);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 style={{ fontSize: "1.3rem", fontWeight: 700 }}>Supplier Dashboard</h1>
          <p style={{ fontSize: "0.8375rem", color: "#7A6C6A" }}>
            {profile ? `${profile.name} · Partner ID: ${profile.code}` : "Supplier profile unavailable"}
          </p>
        </div>
      </div>

      {error && <p className="mb-5" style={{ color: "#C0392B", fontSize: "0.8375rem" }}>{error}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-5">
        <KPICard label="Active Orders" value={loading ? "—" : String(purchaseOrders.length - delivered)} sub="from DVS" accent="#2E7D32" />
        <KPICard label="Pending Deliveries" value={loading ? "—" : String(pending)} accent="#E65100" />
        <KPICard label="Completed Orders" value={loading ? "—" : String(delivered)} accent="#2E7D32" />
        <KPICard label="Procurement Total" value={loading ? "—" : formatMoney(procurementTotal.toFixed(2))} accent="#4E342E" />
        <KPICard label="Materials Supplied" value="—" sub="Not available in API" accent="#1565C0" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        <Card style={{ gridColumn: "span 2" }}>
          <CardHeader title="Supplier Profile" subtitle="Data from the supplier API" />
          {profile ? <div className="p-5 grid grid-cols-2 gap-3">
            <p><strong>Name:</strong> {profile.name}</p><p><strong>Code:</strong> {profile.code}</p>
            <p><strong>Contact:</strong> {profile.contactName ?? "—"}</p><p><strong>Email:</strong> {profile.email ?? "—"}</p>
            <p><strong>Phone:</strong> {profile.phone ?? "—"}</p><p><strong>Location:</strong> {[profile.city, profile.state, profile.country].filter(Boolean).join(", ") || "—"}</p>
            <p><strong>Lead time:</strong> {profile.leadTimeDays === null ? "—" : `${profile.leadTimeDays} days`}</p><p><strong>Materials:</strong> {profile.materials ?? "—"}</p>
          </div> : <EmptyState message="No supplier record matches the authenticated user's email." />}
        </Card>

        <Card>
          <CardHeader title="Performance Score" subtitle="Available supplier rating" />
          <div className="p-5 flex flex-col items-center justify-center">
            <div
              className="w-28 h-28 rounded-full flex items-center justify-center mb-4"
              style={{ background: "linear-gradient(135deg, #E8F5E9, #C8E6C9)", border: "4px solid #2E7D32" }}
            >
              <div className="text-center">
                <p style={{ fontSize: "1.6rem", fontWeight: 800, color: "#2E7D32" }}>{profile?.rating ?? "—"}</p>
                <p style={{ fontSize: "0.7rem", color: "#2E7D32", fontWeight: 600 }}>/ 5</p>
              </div>
            </div>
            <p style={{ fontSize: "0.875rem", fontWeight: 600, color: "#1C1C1C" }}>{profile?.reliability ?? "Performance data unavailable"}</p>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <CardHeader title="Recent Orders from DVS" actions={<Btn size="sm" onClick={() => onNavigate("purchase-orders")}>View All</Btn>} />
          {recentOrders.length === 0 ? <EmptyState message="No purchase orders found." /> : recentOrders.map((o) => (
            <div key={o.id} className="flex items-center gap-3 px-5 py-3.5" style={{ borderBottom: "1px solid #F7F3F2" }}>
              <div>
                <p style={{ fontSize: "0.8rem", fontWeight: 600, color: "#2E7D32" }}>{o.poNumber}</p>
                <p style={{ fontSize: "0.7rem", color: "#9A8A88" }}>{formatDate(o.orderDate)}</p>
              </div>
              <div className="flex-1">
                <p style={{ fontSize: "0.8125rem", fontWeight: 500 }}>{o.material}</p>
                <p style={{ fontSize: "0.72rem", color: "#9A8A88" }}>{o.quantity} {o.unit ?? ""} · {formatMoney(o.totalCost, o.currency)}</p>
              </div>
              <StatusBadge status={o.status} label={statusLabel(o.status)} />
            </div>
          ))}
        </Card>

        <Card>
          <CardHeader title="Messages from DVS" />
          <EmptyState message="Messaging is not supported by the existing backend." />
        </Card>
      </div>
    </div>
  );
}

function MaterialCatalog() {
  return (
    <div className="p-6">
      <PageHeader title="Material Catalog" subtitle="Supplier catalog management is not supported by the existing backend" />
      <Card>
        <EmptyState message="No supplier material catalog API exists. Material offerings cannot be loaded or edited from the database." />
      </Card>
    </div>
  );
}

function PurchaseOrders({ data }: { data: SupplierData }) {
  const { purchaseOrders, loading } = data;
  return (
    <div className="p-6">
      <PageHeader title="Purchase Orders" subtitle="Orders received from DVS Industries" />
      <Card>
        <DataTable
          searchable
          paginate={10}
          columns={[
            { key: "id", label: "PO Number" },
            { key: "material", label: "Material" },
            { key: "qty", label: "Quantity" },
            { key: "orderDate", label: "Order Date" },
            { key: "deadline", label: "Deadline" },
            { key: "value", label: "Value" },
            { key: "status", label: "Status" },
            { key: "actions", label: "Actions" },
          ]}
          rows={purchaseOrders.map((o) => ({
            id: <span style={{ fontSize: "0.775rem", fontFamily: "JetBrains Mono, monospace", color: "#2E7D32", fontWeight: 600 }}>{o.poNumber}</span>,
            material: <span style={{ fontWeight: 500 }}>{o.material}</span>,
            qty: `${o.quantity} ${o.unit ?? ""}`,
            orderDate: formatDate(o.orderDate),
            deadline: <span style={{ fontWeight: 500, color: o.status === "PENDING" ? "#E65100" : "#4A4A4A" }}>{formatDate(o.expectedDelivery)}</span>,
            value: <span style={{ fontWeight: 600 }}>{formatMoney(o.totalCost, o.currency)}</span>,
            status: <StatusBadge status={o.status} label={statusLabel(o.status)} />,
            actions: <span style={{ color: "#7A6C6A", fontSize: "0.75rem" }}>Status managed by DVS</span>,
          }))}
        />
        {!loading && purchaseOrders.length === 0 && <EmptyState message="No purchase orders found for this supplier." />}
      </Card>
    </div>
  );
}

function DeliveryManagement({ data }: { data: SupplierData }) {
  const { purchaseOrders, loading } = data;
  return (
    <div className="p-6">
      <PageHeader title="Delivery Management" subtitle="Track purchase-order delivery status" />
      <Card className="mb-5">
        <DataTable
          searchable
          paginate={10}
          columns={[
            { key: "id", label: "PO Number" },
            { key: "po", label: "Supplier" },
            { key: "material", label: "Material" },
            { key: "qty", label: "Quantity" },
            { key: "dispatch", label: "Actual Delivery" },
            { key: "expected", label: "Expected Del." },
            { key: "status", label: "Status" },
            { key: "actions", label: "Actions" },
          ]}
          rows={purchaseOrders.map((o) => ({
            id: <span style={{ fontSize: "0.775rem", fontFamily: "JetBrains Mono, monospace", color: "#2E7D32" }}>{o.poNumber}</span>,
            po: o.supplierName,
            material: o.material,
            qty: `${o.quantity} ${o.unit ?? ""}`,
            dispatch: formatDate(o.actualDelivery),
            expected: formatDate(o.expectedDelivery),
            status: <StatusBadge status={o.status} label={statusLabel(o.status)} />,
          }))}
        />
        {!loading && purchaseOrders.length === 0 && <EmptyState message="No delivery records found for this supplier." />}
      </Card>
    </div>
  );
}

function Communication() {
  return (
    <div className="p-6">
      <PageHeader title="Communication Center" subtitle="Messaging and notifications are not supported by the existing backend" />
      <Card><EmptyState message="No communication API or persisted supplier notifications are available." /></Card>
    </div>
  );
}

function SupplierPerformance({ data }: { data: SupplierData }) {
  const { profile, purchaseOrders } = data;
  const delivered = purchaseOrders.filter((po) => po.status === "DELIVERED").length;
  const completion = purchaseOrders.length ? `${((delivered / purchaseOrders.length) * 100).toFixed(1)}%` : "—";
  return (
    <div className="p-6">
      <PageHeader title="My Performance" subtitle="On-time delivery, quality, and reliability metrics" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <KPICard label="On-Time Delivery" value="—" sub="Not available in API" accent="#2E7D32" />
        <KPICard label="Order Completion" value={completion} accent="#2E7D32" />
        <KPICard label="Quality Rating" value={profile?.rating ? `${profile.rating}/5.0` : "—"} accent="#F57F17" />
        <KPICard label="Supplier Reliability" value={profile?.reliability ?? "—"} accent="#2E7D32" />
      </div>
      <Card>
        <CardHeader title="On-Time Delivery Trend" />
        <div className="p-5">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={[]}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F0ECEB" />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#9A8A88" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#9A8A88" }} axisLine={false} tickLine={false} domain={[88, 100]} />
              <Tooltip contentStyle={{ fontSize: "0.8rem" }} formatter={(v) => [`${v}%`]} />
            </LineChart>
          </ResponsiveContainer>
          <EmptyState message="Historical performance trend is not provided by the existing backend." />
        </div>
      </Card>
    </div>
  );
}

function SupplierReports() {
  return (
    <div className="p-6">
      <PageHeader title="Reports" subtitle="Supplier-specific reports are not supported by the existing backend" />
      <Card><EmptyState message="No supplier report or document-generation API is available." /></Card>
    </div>
  );
}

export function SupplierApp({ onLogout }: { onLogout: () => void }) {
  const [section, setSection] = useState("dashboard");
  const [data, setData] = useState<SupplierData>({ profile: null, purchaseOrders: [], loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    const user = getUser();

    getSuppliers().then(async (supplierResult) => {
      const profile = supplierResult.data.find((supplier) =>
        user?.email && supplier.email?.toLowerCase() === user.email.toLowerCase(),
      ) ?? null;
      const purchaseOrderResult = profile
        ? await getPurchaseOrders({ supplierId: profile.id, sortBy: "orderDate", sortOrder: "desc" })
        : { data: [] as PurchaseOrderDto[] };
      if (cancelled) return;
      setData({
        profile,
        purchaseOrders: purchaseOrderResult.data,
        loading: false,
        error: profile ? null : "No supplier record matches the authenticated user's email.",
      });
    }).catch((err: unknown) => {
      // The API answers 404 when no supplier record is linked to this login
      const error = isApiError(err) && err.status === 404
        ? "No supplier record matches the authenticated user's email."
        : "Supplier data could not be loaded.";
      if (!cancelled) setData({ profile: null, purchaseOrders: [], loading: false, error });
    });

    return () => { cancelled = true; };
  }, []);

  const renderSection = () => {
    switch (section) {
      case "dashboard": return <SupplierDashboard onNavigate={setSection} data={data} />;
      case "catalog": return <MaterialCatalog />;
      case "purchase-orders": return <PurchaseOrders data={data} />;
      case "delivery": return <DeliveryManagement data={data} />;
      case "communication": return <Communication />;
      case "performance": return <SupplierPerformance data={data} />;
      case "reports": return <SupplierReports />;
      default: return <SupplierDashboard onNavigate={setSection} data={data} />;
    }
  };

  return (
    <AppShell role="supplier" activeSection={section} onSectionChange={setSection} onLogout={onLogout}>
      {renderSection()}
    </AppShell>
  );
}
