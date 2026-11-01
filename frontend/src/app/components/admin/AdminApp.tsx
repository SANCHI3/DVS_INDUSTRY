import { useEffect, useState } from "react";
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
import { useSectionHash } from "../../../lib/useSectionHash";
import { MyProfilePage } from "../shared/MyProfilePage";
import { getStoredBackendRole, getUser } from "../../../lib/auth";
import { baseSection, canOpen, defaultSection } from "../../../lib/permissions";

type UserRole = "admin" | "production" | "store";

interface AdminAppProps {
  onLogout: () => void | Promise<void>;
  /** The backend ended the session (e.g. after a password change); show this on the login page. */
  onSessionEnded: (message: string) => void | Promise<void>;
  /** Kept for the caller; access now comes from the signed-in user's backend role. */
  userRole?: UserRole;
}

export function AdminApp({ onLogout, onSessionEnded }: AdminAppProps) {
  const backendRole = getStoredBackendRole();
  const home = defaultSection(backendRole);
  const [section, setSection] = useSectionHash(home);
  const [userName, setUserName] = useState(() => getUser()?.fullName ?? "");

  // A section this role may not open (typed or old link) lands on its home page
  const allowed = canOpen(backendRole, section);
  useEffect(() => {
    if (!allowed) setSection(home, { replace: true });
  }, [allowed, home, setSection]);
  const shown = allowed ? section : home;

  // A new section starts at the top of the page (its tabs keep their scroll)
  const shownBase = baseSection(shown);
  useEffect(() => {
    document.querySelector("main")?.scrollTo?.({ top: 0 });
  }, [shownBase]);

  const renderSection = () => {
    switch (baseSection(shown)) {
      case "profile": return <MyProfilePage onNameChange={setUserName} onSessionEnded={onSessionEnded} />;
      case "dashboard": return <AdminDashboard onNavigate={setSection} />;
      case "production": return <ProductionPage section="production" />;
      case "workforce": return <ProductionPage section="workforce" />;
      case "security": return <SecurityPage />;
      case "inventory": return <InventoryPage onNavigate={setSection} />;
      case "orders": return <OrdersPage onNavigate={setSection} />;
      case "reports": return <ReportsPage />;
      case "analytics": return <SmartAnalyticsPage />;
      case "users": return <UserManagementPage />;
      default: return <MyProfilePage onNameChange={setUserName} onSessionEnded={onSessionEnded} />;
    }
  };

  return (
    <ERPProvider>
      <AppShell role="admin" userName={userName} activeSection={shown} onSectionChange={setSection} onOpenProfile={() => setSection("profile")} onLogout={onLogout}>
        {renderSection()}
      </AppShell>
      {/* Roles that can read security data get high-priority incidents on
          every page; "View" opens the incident list. */}
      {canOpen(backendRole, "security") && (
        <PriorityIncidentAlert onView={() => setSection("security-incidents")} />
      )}
    </ERPProvider>
  );
}
