import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { AppShell } from "../shared/AppShell";
import { AdminDashboard } from "./AdminDashboard";
import { ProductionPage } from "./ProductionPage";
import { SecurityPage } from "./SecurityPage";
import { InventoryPage } from "./InventoryPage";
import { OrdersPage } from "./OrdersPage";
import { ReportsPage } from "./ReportsPage";
import { SmartAnalyticsPage } from "./SmartAnalyticsPage";
import { UserManagementPage } from "./UserManagementPage";
import { ERPProvider } from "./ERPContext";
import { PriorityIncidentAlert } from "../shared/PriorityIncidentAlert";
import { Btn, Card, CardHeader } from "../shared/UI";
import api from "../../../lib/api";

type SystemStatus = {
  health: { status: string; database?: string } | null;
  metrics: { uptimeSeconds: number; nodeVersion: string } | null;
};

/** Live system status only; values come from the running backend. */
function SettingsPage() {
  const [status, setStatus] = useState<SystemStatus>({ health: null, metrics: null });
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    Promise.allSettled([
      api.get("/health"),
      api.get("/metrics"),
    ]).then(([health, metrics]) => {
      setStatus({
        health: health.status === "fulfilled" ? health.value.data : null,
        metrics: metrics.status === "fulfilled" ? metrics.value.data : null,
      });
      setLoading(false);
    });
  };
  useEffect(load, []);

  const uptime = status.metrics ? `${Math.floor(status.metrics.uptimeSeconds / 3600)} h ${Math.floor((status.metrics.uptimeSeconds % 3600) / 60)} min` : "Couldn't load";
  const rows: [string, string, boolean | null][] = [
    ["API", status.health ? (status.health.status === "ok" ? "Running" : status.health.status) : "Not reachable", status.health ? status.health.status === "ok" : false],
    ["Database", status.health?.database ? (status.health.database === "ok" ? "Connected" : status.health.database) : "Not reported", status.health?.database === "ok"],
    ["Server uptime", uptime, null],
    ["Node.js", status.metrics?.nodeVersion ?? "Couldn't load", null],
  ];

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 style={{ fontSize: "1.3rem", fontWeight: 700, color: "#1C1C1C" }}>Settings</h1>
          <p style={{ fontSize: "0.8375rem", color: "#7A6C6A", marginTop: "0.2rem" }}>System status. Configuration lives in the .env files on the server.</p>
        </div>
        <Btn variant="secondary" size="sm" onClick={load}><RefreshCw size={14} /> Refresh</Btn>
      </div>
      <Card>
        <CardHeader title="System Information" subtitle="Read live from the backend" />
        <div className="p-5 flex flex-col gap-3">
          {loading ? <p style={{ fontSize: "0.8125rem", color: "#7A6C6A" }}>Checking system status...</p> : rows.map(([k, v, good]) => (
            <div key={k} className="flex items-center justify-between py-1.5" style={{ borderBottom: "1px solid #F5F0EF" }}>
              <span style={{ fontSize: "0.8125rem", color: "#7A6C6A" }}>{k}</span>
              <span style={{ fontSize: "0.8125rem", fontWeight: 500, color: good === null ? "#1C1C1C" : good ? "#2E7D32" : "#C0392B" }}>{v}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

const productionSections = new Set(["production", "production-performance", "production-workforce", "production-attendance"]);
const securitySections = new Set(["security", "security-live", "security-incidents", "security-reports"]);
const inventorySections = new Set(["inventory", "inventory-overview", "inventory-materials", "inventory-calculator", "inventory-scrap", "inventory-procurement"]);
const orderSections = new Set(["orders", "orders-client", "orders-supplier", "orders-supply-chain"]);

type UserRole = "admin" | "production" | "store";

interface AdminAppProps {
  onLogout: () => void | Promise<void>;
  userRole: UserRole;
}

export function AdminApp({ onLogout, userRole }: AdminAppProps) {
  const getInitialSection = () => {
    if (userRole === "production") return "production";
    if (userRole === "store") return "orders";
    return "dashboard";
  };

  const [section, setSection] = useState(getInitialSection());

  const renderSection = () => {
    if (userRole === "admin") {
      if (section === "dashboard") return <AdminDashboard onNavigate={setSection} />;
      if (productionSections.has(section)) return <ProductionPage />;
      if (securitySections.has(section)) return <SecurityPage />;
      if (inventorySections.has(section)) return <InventoryPage onNavigate={setSection} />;
      if (orderSections.has(section)) return <OrdersPage onNavigate={setSection} />;
      if (section === "reports") return <ReportsPage />;
      if (section === "analytics") return <SmartAnalyticsPage />;
      if (section === "users") return <UserManagementPage />;
      if (section === "settings") return <SettingsPage />;
      return <AdminDashboard onNavigate={setSection} />;
    }

    if (userRole === "production") return <ProductionPage />;
    if (userRole === "store") return <OrdersPage onNavigate={setSection} />;

    return <AdminDashboard onNavigate={setSection} />;
  };

  return (
    <ERPProvider>
      <AppShell role="admin" userRole={userRole} activeSection={section} onSectionChange={setSection} onLogout={onLogout} notificationCount={0}>
        {renderSection()}
      </AppShell>
      {/* Security roles get high-priority incidents on every page; the store
          role cannot read security data, so it never subscribes. */}
      {userRole !== "store" && (
        <PriorityIncidentAlert onView={() => setSection(userRole === "admin" ? "security-incidents" : section)} />
      )}
    </ERPProvider>
  );
}
