import { Suspense, lazy, useEffect, useState } from "react";
import { Toaster, toast } from "sonner";
import { HomePage } from "./components/HomePage";
import { LoginPage } from "./components/LoginPage";
import { logout as apiLogout, getStoredFrontendRole } from "../lib/auth";
import { SESSION_EXPIRED_EVENT } from "../lib/api";
import type { FrontendRole } from "../lib/auth";

// Signed-in apps load on demand, so the home and login pages don't download
// the dashboards and the charting library.
const ResetPasswordPage = lazy(() => import("./components/ResetPasswordPage").then((m) => ({ default: m.ResetPasswordPage })));
const AdminApp    = lazy(() => import("./components/admin/AdminApp").then((m) => ({ default: m.AdminApp })));
const SupplierApp = lazy(() => import("./components/supplier/SupplierApp").then((m) => ({ default: m.SupplierApp })));
const ClientApp   = lazy(() => import("./components/client/ClientApp").then((m) => ({ default: m.ClientApp })));

function PageLoading() {
  return (
    <div role="status" style={{ padding: "2rem", textAlign: "center", color: "#64748b" }}>
      Loading…
    </div>
  );
}

type Page = "home" | "login" | "reset" | FrontendRole;
type Role = "admin" | "supplier" | "client" | "production" | "store";

function readResetToken(): string | null {
  return new URLSearchParams(window.location.search).get("resetToken");
}

/** Restore the signed-in app after a reload instead of dropping to the home page. */
function initialPage(): Page {
  if (readResetToken() !== null) return "reset";
  return getStoredFrontendRole() ?? "home";
}

export default function App() {
  const [page, setPage]           = useState<Page>(initialPage);
  const [loginRole, setLoginRole] = useState<Role>("admin");
  const [resetToken]              = useState(readResetToken);

  // The API client fires this when the session can no longer be refreshed
  useEffect(() => {
    const onExpired = () => setPage("login");
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  const goToLogin = (role: Role = "admin") => {
    setLoginRole(role);
    setPage("login");
  };

  const handleLoginSuccess = (role: FrontendRole) => {
    setPage(role);
  };

  const handleLogout = async () => {
    await apiLogout();
    setPage("home");
  };

  // The backend ended every session (e.g. password changed): sign in again.
  const handleSessionEnded = async (message: string) => {
    await apiLogout();
    toast.success(message);
    setPage("login");
  };

  const leaveReset = () => {
    // Drop the single-use token from the address bar and history
    window.history.replaceState(null, "", window.location.pathname);
    setPage("login");
  };

  return (
    <>
      <Toaster position="top-right" richColors closeButton />
      {page === "home" && <HomePage onNavigateToLogin={goToLogin} />}
      {page === "login" && (
        <LoginPage
          initialRole={loginRole}
          onNavigateHome={() => setPage("home")}
          onLoginSuccess={handleLoginSuccess}
        />
      )}
      <Suspense fallback={<PageLoading />}>
      {page === "reset" && resetToken !== null && <ResetPasswordPage token={resetToken} onDone={leaveReset} />}
      {page === "admin"      && <AdminApp onLogout={handleLogout} onSessionEnded={handleSessionEnded} userRole="admin" />}
      {page === "production" && <AdminApp onLogout={handleLogout} onSessionEnded={handleSessionEnded} userRole="production" />}
      {page === "store"      && <AdminApp onLogout={handleLogout} onSessionEnded={handleSessionEnded} userRole="store" />}
      {page === "unauthorized" && <div style={{ padding: "2rem" }}>Unauthorized role. Contact an administrator.</div>}
      {page === "supplier"   && <SupplierApp onLogout={handleLogout} />}
      {page === "client"     && <ClientApp  onLogout={handleLogout} />}
      </Suspense>
    </>
  );
}
