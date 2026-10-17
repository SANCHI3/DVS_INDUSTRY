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
import { MyProfilePage } from "../shared/MyProfilePage";
import { getUser } from "../../../lib/auth";

const productionSections = new Set(["production", "production-performance", "production-workforce", "production-attendance"]);
const securitySections = new Set(["security", "security-live", "security-incidents", "security-reports"]);
const inventorySections = new Set(["inventory", "inventory-overview", "inventory-materials", "inventory-calculator", "inventory-scrap", "inventory-procurement"]);
const orderSections = new Set(["orders", "orders-client", "orders-supplier", "orders-supply-chain"]);

type UserRole = "admin" | "production" | "store";

interface AdminAppProps {
  onLogout: () => void | Promise<void>;
  /** The backend ended the session (e.g. after a password change); show this on the login page. */
  onSessionEnded: (message: string) => void | Promise<void>;
  userRole: UserRole;
}

export function AdminApp({ onLogout, onSessionEnded, userRole }: AdminAppProps) {
  const getInitialSection = () => {
    if (userRole === "production") return "production";
    if (userRole === "store") return "orders";
    return "dashboard";
  };

  const [section, setSection] = useState(getInitialSection());
  const [userName, setUserName] = useState(() => getUser()?.fullName ?? "");

  const renderSection = () => {
    if (section === "profile") {
      return <MyProfilePage onNameChange={setUserName} onSessionEnded={onSessionEnded} />;
    }

    if (userRole === "admin") {
      if (section === "dashboard") return <AdminDashboard onNavigate={setSection} />;
      if (productionSections.has(section)) return <ProductionPage />;
      if (securitySections.has(section)) return <SecurityPage />;
      if (inventorySections.has(section)) return <InventoryPage onNavigate={setSection} />;
      if (orderSections.has(section)) return <OrdersPage onNavigate={setSection} />;
      if (section === "reports") return <ReportsPage />;
      if (section === "analytics") return <SmartAnalyticsPage />;
      if (section === "users") return <UserManagementPage />;
      return <AdminDashboard onNavigate={setSection} />;
    }

    if (userRole === "production") return <ProductionPage />;
    if (userRole === "store") return <OrdersPage onNavigate={setSection} />;

    return <AdminDashboard onNavigate={setSection} />;
  };

  return (
    <ERPProvider>
      <AppShell role="admin" userRole={userRole} userName={userName} activeSection={section} onSectionChange={setSection} onOpenProfile={() => setSection("profile")} onLogout={onLogout} notificationCount={0}>
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
