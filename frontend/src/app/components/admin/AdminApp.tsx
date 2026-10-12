import { useState } from "react";
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
import { Card, CardHeader } from "../shared/UI";
import { toast } from "sonner";

function SettingsPage() {
  const [company, setCompany] = useState({ name: "DVS Industries", gst: "27AADFD0230G1Z2", address: "Plot B-166, MIDC Malegaon, Sinnar, Nashik, Maharashtra", iso: "ISO 9001:2015", phone: "+91 98765 43210", email: "admin@dvsindustries.com" });
  const [prod, setProd] = useState({ dailyTarget: "420", scrapThreshold: "5", efficiency: "95", shiftStart: "06:00", shiftEnd: "14:00" });
  const [notif, setNotif] = useState({ stockAlert: true, securityAlert: true, orderAlert: true, attendanceAlert: false, emailDigest: true });
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    toast.info("Settings updated for this session only. Persistence is unavailable.");
    setTimeout(() => setSaved(false), 3000);
  };

  const field = (label: string, value: string, onChange: (v: string) => void, type = "text") => (
    <div>
      <label style={{ display: "block", fontSize: "0.775rem", fontWeight: 500, color: "#4A4A4A", marginBottom: "0.3rem" }}>{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        style={{ width: "100%", padding: "0.5rem 0.75rem", border: "1px solid #D4BFBB", borderRadius: "0.375rem", fontSize: "0.8375rem", color: "#1C1C1C", background: "#FAFAFA", outline: "none" }}
        onFocus={(e) => { e.target.style.borderColor = "#A52A2A"; e.target.style.boxShadow = "0 0 0 3px rgba(165,42,42,0.1)"; }}
        onBlur={(e) => { e.target.style.borderColor = "#D4BFBB"; e.target.style.boxShadow = "none"; }}
      />
    </div>
  );

  const toggle = (label: string, desc: string, value: boolean, onChange: (v: boolean) => void) => (
    <div className="flex items-center justify-between py-3" style={{ borderBottom: "1px solid #F0ECEB" }}>
      <div>
        <p style={{ fontSize: "0.8375rem", fontWeight: 500, color: "#1C1C1C" }}>{label}</p>
        <p style={{ fontSize: "0.75rem", color: "#9A8A88" }}>{desc}</p>
      </div>
      <button
        onClick={() => onChange(!value)}
        style={{ width: "44px", height: "24px", borderRadius: "12px", border: "none", background: value ? "#A52A2A" : "#D4BFBB", position: "relative", cursor: "pointer", transition: "background 0.2s", flexShrink: 0 }}
      >
        <span style={{ position: "absolute", top: "2px", left: value ? "22px" : "2px", width: "20px", height: "20px", borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
      </button>
    </div>
  );

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-6">
        <h1 style={{ fontSize: "1.3rem", fontWeight: 700, color: "#1C1C1C" }}>Settings</h1>
        <p style={{ fontSize: "0.8375rem", color: "#7A6C6A", marginTop: "0.2rem" }}>System configuration and preferences</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Company Profile */}
        <Card>
          <CardHeader title="Company Profile" subtitle="Factory identity and contact info" />
          <div className="p-5 flex flex-col gap-4">
            {field("Company Name", company.name, (v) => setCompany((c) => ({ ...c, name: v })))}
            {field("GST Number", company.gst, (v) => setCompany((c) => ({ ...c, gst: v })))}
            {field("ISO Certification", company.iso, (v) => setCompany((c) => ({ ...c, iso: v })))}
            {field("Contact Phone", company.phone, (v) => setCompany((c) => ({ ...c, phone: v })), "tel")}
            {field("Email", company.email, (v) => setCompany((c) => ({ ...c, email: v })), "email")}
            <div>
              <label style={{ display: "block", fontSize: "0.775rem", fontWeight: 500, color: "#4A4A4A", marginBottom: "0.3rem" }}>Address</label>
              <textarea value={company.address} onChange={(e) => setCompany((c) => ({ ...c, address: e.target.value })) } rows={2}
                style={{ width: "100%", padding: "0.5rem 0.75rem", border: "1px solid #D4BFBB", borderRadius: "0.375rem", fontSize: "0.8375rem", color: "#1C1C1C", background: "#FAFAFA", outline: "none", resize: "vertical" }}
                onFocus={(e) => { e.target.style.borderColor = "#A52A2A"; }}
                onBlur={(e) => { e.target.style.borderColor = "#D4BFBB"; }}
              />
            </div>
          </div>
        </Card>

        {/* Production Targets */}
        <Card>
          <CardHeader title="Production Targets" subtitle="Daily goals and thresholds" />
          <div className="p-5 flex flex-col gap-4">
            {field("Daily Production Target (pcs)", prod.dailyTarget, (v) => setProd((p) => ({ ...p, dailyTarget: v })), "number")}
            {field("Scrap Threshold (%)", prod.scrapThreshold, (v) => setProd((p) => ({ ...p, scrapThreshold: v })), "number")}
            {field("Min Efficiency Target (%)", prod.efficiency, (v) => setProd((p) => ({ ...p, efficiency: v })), "number")}
            {field("Morning Shift Start", prod.shiftStart, (v) => setProd((p) => ({ ...p, shiftStart: v })), "time")}
            {field("Morning Shift End", prod.shiftEnd, (v) => setProd((p) => ({ ...p, shiftEnd: v })), "time")}
            <div className="p-3 rounded-lg" style={{ background: "#FFF8E1", border: "1px solid #FFE082" }}>
              <p style={{ fontSize: "0.75rem", color: "#E65100" }}>⚠ Changing production targets will recalculate all efficiency KPIs from today forward.</p>
            </div>
          </div>
        </Card>

        {/* Notification Settings */}
        <Card>
          <CardHeader title="Notification Alerts" subtitle="Control which alerts are active" />
          <div className="p-5">
            {toggle("Stock Level Alerts", "Notify when inventory falls below threshold", notif.stockAlert, (v) => setNotif((n) => ({ ...n, stockAlert: v })))}
            {toggle("Security Incident Alerts", "Notify on new security incidents", notif.securityAlert, (v) => setNotif((n) => ({ ...n, securityAlert: v })))}
            {toggle("New Order Notifications", "Notify when a new client order arrives", notif.orderAlert, (v) => setNotif((n) => ({ ...n, orderAlert: v })))}
            {toggle("Attendance Alerts", "Notify on low attendance or late entries", notif.attendanceAlert, (v) => setNotif((n) => ({ ...n, attendanceAlert: v })))}
            {toggle("Daily Email Digest", "Send a summary email each morning at 07:00", notif.emailDigest, (v) => setNotif((n) => ({ ...n, emailDigest: v })))}
          </div>
        </Card>

        {/* System Info */}
        <Card>
          <CardHeader title="System Information" subtitle="Platform version and status" />
          <div className="p-5 flex flex-col gap-3">
            {[
              ["Platform Version", "DVS SmartFactory v2.4.1"],
              ["Build Date", "14 July 2026"],
              ["Database", "PostgreSQL 15 (Cloud)"],
              ["API Status", "Unavailable — no runtime status source"],
              ["Last Backup", "Unavailable — no backup status source"],
              ["Face Recognition API", "Unavailable — no status source"],
              ["License", "Unavailable — no license status source"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between py-1.5" style={{ borderBottom: "1px solid #F5F0EF" }}>
                <span style={{ fontSize: "0.8125rem", color: "#7A6C6A" }}>{k}</span>
                <span style={{ fontSize: "0.8125rem", fontWeight: 500, color: v?.includes("●") ? (v.includes("Connected") ? "#2E7D32" : "#1565C0") : "#1C1C1C" }}>{v}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          onClick={handleSave}
          style={{ padding: "0.625rem 2rem", borderRadius: "0.5rem", background: saved ? "#2E7D32" : "#A52A2A", color: "#fff", border: "none", cursor: "pointer", fontWeight: 600, fontSize: "0.875rem", transition: "background 0.2s" }}
        >
          {saved ? "✓ Saved" : "Save Changes"}
        </button>
        <span style={{ fontSize: "0.8rem", color: "#9A8A88" }}>UI-only changes; persistence is unavailable</span>
      </div>
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
