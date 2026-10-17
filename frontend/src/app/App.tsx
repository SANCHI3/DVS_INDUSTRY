import { useEffect, useState } from "react";
import { Toaster, toast } from "sonner";
import { HomePage } from "./components/HomePage";
import { LoginPage } from "./components/LoginPage";
import { ResetPasswordPage } from "./components/ResetPasswordPage";
import { AdminApp } from "./components/admin/AdminApp";
import { SupplierApp } from "./components/supplier/SupplierApp";
import { ClientApp } from "./components/client/ClientApp";
import { logout as apiLogout, getStoredFrontendRole } from "../lib/auth";
import { SESSION_EXPIRED_EVENT } from "../lib/api";
import type { FrontendRole } from "../lib/auth";

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
      {page === "reset" && resetToken !== null && <ResetPasswordPage token={resetToken} onDone={leaveReset} />}
      {page === "admin"      && <AdminApp onLogout={handleLogout} onSessionEnded={handleSessionEnded} userRole="admin" />}
      {page === "production" && <AdminApp onLogout={handleLogout} onSessionEnded={handleSessionEnded} userRole="production" />}
      {page === "store"      && <AdminApp onLogout={handleLogout} onSessionEnded={handleSessionEnded} userRole="store" />}
      {page === "unauthorized" && <div style={{ padding: "2rem" }}>Unauthorized role. Contact an administrator.</div>}
      {page === "supplier"   && <SupplierApp onLogout={handleLogout} />}
      {page === "client"     && <ClientApp  onLogout={handleLogout} />}
    </>
  );
}
