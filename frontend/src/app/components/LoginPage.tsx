import { useState } from "react";
import {
  Shield, Package, Building2, Eye, EyeOff, ArrowLeft, Lock,
  Mail, User, ChevronRight, AlertCircle, CheckCircle2, Factory,
  Users, PackageCheck, ShoppingCart,
} from "lucide-react";
import { login as apiLogin, type FrontendRole } from "../../lib/auth";
import api from "../../lib/api";

type Role = "admin" | "supplier" | "client" | "production" | "store";
type AuthMode = "login" | "signup" | "forgot";

interface LoginPageProps {
  initialRole?: Role;
  onNavigateHome: () => void;
  onLoginSuccess: (role: FrontendRole) => void;
}

const roles = [
  {
    id: "admin" as Role,
    label: "Administrator",
    icon: Shield,
    color: "#A52A2A",
    bgColor: "#FDF5F5",
    borderColor: "#FFCDD2",
    desc: "Full system access",
    permissions: ["Security Monitoring", "Production Management", "All Reports", "User Management"],
    tagline: "Complete control over DVS Industries operations",
  },
  {
    id: "production" as Role,
    label: "Production",
    icon: Factory,
    color: "#4E342E",
    bgColor: "#FBF9F8",
    borderColor: "#D7CCC8",
    desc: "Production module only",
    permissions: ["Production Performance", "Workforce Management", "Attendance Tracking", "Production Reports"],
    tagline: "Dedicated access to production operations",
  },
  {
    id: "store" as Role,
    label: "Store",
    icon: ShoppingCart,
    color: "#E65100",
    bgColor: "#FFF3E0",
    borderColor: "#FFE0B2",
    desc: "Orders & supply only",
    permissions: ["Client Orders", "Supplier Orders", "Supply Chain", "Order Reports"],
    tagline: "Dedicated access to orders and supply chain",
  },
  {
    id: "supplier" as Role,
    label: "Supplier",
    icon: Package,
    color: "#2E7D32",
    bgColor: "#F0FAF0",
    borderColor: "#C8E6C9",
    desc: "Materials & order supply",
    permissions: ["Material Catalog", "Purchase Orders", "Delivery Management", "Performance Reports"],
    tagline: "Manage your materials and supply chain with DVS",
  },
  {
    id: "client" as Role,
    label: "Client",
    icon: Building2,
    color: "#1565C0",
    bgColor: "#F0F4FF",
    borderColor: "#C5CAE9",
    desc: "Order tracking & management",
    permissions: ["Product Catalog", "Order Placement", "Shipment Tracking", "Invoice Downloads"],
    tagline: "Browse products and manage your orders seamlessly",
  },
];

function PasswordStrengthBar({ password }: { password: string }) {
  if (!password) return null;
  const checks = [
    password.length >= 8,
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ];
  const score = checks.filter(Boolean).length;
  const colors = ["#C0392B", "#E65100", "#F57F17", "#2E7D32"];
  const labels = ["Weak", "Fair", "Good", "Strong"];
  return (
    <div className="mt-2">
      <div className="flex gap-1 mb-1">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex-1 h-1.5 rounded-full" style={{ background: i < score ? colors[score - 1] : "#E8E2E0", transition: "background 0.2s" }} />
        ))}
      </div>
      {score > 0 && <p style={{ fontSize: "0.7rem", color: colors[score - 1] }}>{labels[score - 1]} password</p>}
    </div>
  );
}

export function LoginPage({ initialRole, onNavigateHome, onLoginSuccess }: LoginPageProps) {
  const [selectedRole, setSelectedRole] = useState<Role>(initialRole ?? "admin");
  const [mode, setMode] = useState<AuthMode>("login");
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const role = roles.find((r) => r.id === selectedRole)!;
  const Icon = role.icon;

  const reset = () => { setError(""); setSuccess(""); setEmail(""); setPassword(""); setConfirmPw(""); setName(""); setCompany(""); };

  const handleRoleSelect = (r: Role) => { setSelectedRole(r); reset(); };

  const handleLogin = async () => {
    setError(""); setSuccess("");
    if (!email || !password) { setError("Please fill in all fields."); return; }
    setLoading(true);
    try {
      const { user, frontendRole } = await apiLogin(email, password);
      setSuccess(`Authenticated. Loading ${user.fullName.split(" ")[0]}'s dashboard…`);
      setTimeout(() => onLoginSuccess(frontendRole), 800);
    } catch (err: unknown) {
      const msg = err && typeof err === "object" && "message" in err
        ? (err as { message: string }).message
        : "Invalid email or password. Please try again.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async () => {
    setError("Accounts are created by an administrator. Please request access from your system administrator.");
  };

  const handleForgot = async () => {
    setError(""); setSuccess("");
    if (!email) { setError("Please enter your registered email address."); return; }
    setLoading(true);
    try {
      await api.post("/auth/forgot-password", { email });
      setSuccess(`If ${email} is registered, a reset link has been sent. It expires in 15 minutes.`);
    } catch {
      // Always show success for security (don't reveal whether email exists)
      setSuccess(`If ${email} is registered, a reset link has been sent.`);
    } finally {
      setLoading(false);
    }
  };

  const inputBase: React.CSSProperties = {
    width: "100%",
    padding: "0.625rem 0.875rem 0.625rem 2.5rem",
    border: "1px solid #D4BFBB",
    borderRadius: "0.5rem",
    fontSize: "0.875rem",
    color: "#1C1C1C",
    background: "#FAFAFA",
    outline: "none",
    transition: "border-color 0.15s, box-shadow 0.15s",
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.style.borderColor = role.color;
    e.target.style.boxShadow = `0 0 0 3px ${role.color}18`;
  };
  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.style.borderColor = "#D4BFBB";
    e.target.style.boxShadow = "none";
  };

  return (
    <div className="min-h-screen flex" style={{ background: "#FAFAFA", fontFamily: "'Inter', sans-serif" }}>
      {/* ── LEFT PANEL ── */}
      <div
        className="hidden lg:flex flex-col w-96 flex-shrink-0 relative overflow-hidden"
        style={{ background: "#FFFFFF", borderRight: "1px solid #E8E2E0" }}
      >
        {/* Subtle top accent bar */}
        <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, #A52A2A, #4E342E)` }} />

        <div className="flex flex-col flex-1 p-8">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-10">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "#A52A2A" }}>
              <Factory size={18} color="#fff" />
            </div>
            <div>
              <p style={{ fontSize: "0.9rem", fontWeight: 800, color: "#1C1C1C", letterSpacing: "0.06em" }}>DVS INDUSTRIES</p>
              <p style={{ fontSize: "0.6rem", color: "#A52A2A", letterSpacing: "0.12em", fontWeight: 600 }}>ENTERPRISE PLATFORM</p>
            </div>
          </div>

          {/* Role selector — grouped */}
          <div className="mb-6 flex flex-col gap-4">
            {[
              { groupLabel: "DVS LOGIN", groupIds: ["admin", "production", "store"] as Role[] },
              { groupLabel: "PARTNER LOGIN", groupIds: ["supplier", "client"] as Role[] },
            ].map((group) => (
              <div key={group.groupLabel}>
                <p style={{ fontSize: "0.62rem", fontWeight: 700, color: "#B0A0A0", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.625rem", paddingBottom: "0.375rem", borderBottom: "1px solid #F0ECEB" }}>
                  {group.groupLabel}
                </p>
                <div className="flex flex-col gap-2">
                  {roles.filter((r) => group.groupIds.includes(r.id)).map((r) => {
                    const RIcon = r.icon;
                    const active = selectedRole === r.id;
                    return (
                      <button
                        key={r.id}
                        onClick={() => handleRoleSelect(r.id)}
                        className="flex items-center gap-3 p-3 rounded-xl text-left w-full transition-all duration-150"
                        style={{
                          background: active ? r.bgColor : "#FAFAFA",
                          border: `1.5px solid ${active ? r.color : "#E8E2E0"}`,
                          cursor: "pointer",
                        }}
                      >
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: active ? r.color : "#F0ECEB" }}>
                          <RIcon size={15} color={active ? "#fff" : "#9A8A88"} />
                        </div>
                        <div className="flex-1">
                          <p style={{ fontSize: "0.8375rem", fontWeight: 600, color: active ? "#1C1C1C" : "#4A4A4A" }}>{r.label}</p>
                          <p style={{ fontSize: "0.7rem", color: active ? r.color : "#9A8A88" }}>{r.desc}</p>
                        </div>
                        {active && <ChevronRight size={14} color={r.color} />}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Access permissions */}
          <div
            className="rounded-xl p-4 mb-6"
            style={{ background: role.bgColor, border: `1px solid ${role.borderColor}` }}
          >
            <p style={{ fontSize: "0.68rem", fontWeight: 700, color: role.color, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
              Access Permissions
            </p>
            {role.permissions.map((p) => (
              <div key={p} className="flex items-center gap-2 mb-2">
                <CheckCircle2 size={12} color={role.color} />
                <span style={{ fontSize: "0.8rem", color: "#4A4A4A" }}>{p}</span>
              </div>
            ))}
          </div>

          {/* Tagline */}
          <div className="mt-auto">
            <p style={{ fontSize: "0.8125rem", color: "#7A6C6A", lineHeight: 1.6, fontStyle: "italic" }}>
              "{role.tagline}"
            </p>
            <div className="mt-6 pt-5" style={{ borderTop: "1px solid #F0ECEB" }}>
              <button
                onClick={onNavigateHome}
                className="flex items-center gap-2 transition-colors"
                style={{ background: "none", border: "none", cursor: "pointer", color: "#9A8A88", fontSize: "0.8125rem" }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "#4A4A4A"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "#9A8A88"; }}
              >
                <ArrowLeft size={14} /> Back to Homepage
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── RIGHT PANEL ── */}
      <div className="flex-1 flex items-center justify-center p-6 overflow-y-auto">
        <div className="w-full max-w-[420px]">
          {/* Mobile: back + role select */}
          <div className="lg:hidden mb-6">
            <button
              onClick={onNavigateHome}
              className="flex items-center gap-1.5 mb-4"
              style={{ background: "none", border: "none", cursor: "pointer", color: "#7A6C6A", fontSize: "0.8125rem" }}
            >
              <ArrowLeft size={14} /> Back to Homepage
            </button>
            {/* Mobile role tabs — grouped */}
            <div className="flex flex-col gap-3 mb-5">
              {[
                { groupLabel: "DVS LOGIN", ids: ["admin", "production", "store"] as Role[] },
                { groupLabel: "PARTNER LOGIN", ids: ["supplier", "client"] as Role[] },
              ].map((group) => (
                <div key={group.groupLabel}>
                  <p style={{ fontSize: "0.62rem", fontWeight: 700, color: "#B0A0A0", letterSpacing: "0.1em", marginBottom: "0.5rem" }}>{group.groupLabel}</p>
                  <div className="flex gap-2">
                    {roles.filter((r) => group.ids.includes(r.id)).map((r) => {
                      const RIcon = r.icon;
                      const active = selectedRole === r.id;
                      return (
                        <button key={r.id} onClick={() => handleRoleSelect(r.id)}
                          className="flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl"
                          style={{ background: active ? r.bgColor : "#fff", border: `1.5px solid ${active ? r.color : "#E8E2E0"}`, cursor: "pointer" }}>
                          <RIcon size={16} color={active ? r.color : "#9A8A88"} />
                          <span style={{ fontSize: "0.65rem", color: active ? r.color : "#7A6C6A", fontWeight: active ? 600 : 400 }}>{r.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Form card */}
          <div
            className="rounded-2xl overflow-hidden"
            style={{
              background: "#FFFFFF",
              border: "1px solid #E8E2E0",
              boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
            }}
          >
            {/* Card top accent */}
            <div className="h-1" style={{ background: `linear-gradient(90deg, ${role.color}, #4E342E)` }} />

            <div className="p-8">
              {/* Header */}
              <div className="mb-6">
                <div className="flex items-center gap-2.5 mb-3">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center"
                    style={{ background: role.bgColor, border: `1.5px solid ${role.borderColor}` }}
                  >
                    <Icon size={18} color={role.color} />
                  </div>
                  <div>
                    <p style={{ fontSize: "0.68rem", fontWeight: 700, color: role.color, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                      {role.label} Portal
                    </p>
                    <h1 style={{ fontSize: "1.4rem", fontWeight: 700, color: "#1C1C1C", lineHeight: 1.2 }}>
                      {mode === "login" ? "Welcome Back" : mode === "signup" ? "Request Account Access" : "Reset Password"}
                    </h1>
                  </div>
                </div>
                <p style={{ fontSize: "0.8125rem", color: "#7A6C6A" }}>
                  {mode === "login"
                    ? `Sign in to access your ${role.label} dashboard`
                    : mode === "signup"
                    ? "Registration is managed by an administrator."
                    : "We'll send a reset link to your email"}
                </p>
              </div>

              {/* Mode tabs */}
              {mode !== "forgot" && (
                <div
                  className="flex p-1 rounded-lg mb-5"
                  style={{ background: "#F5F0EF" }}
                >
                  {(["login", "signup"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => { setMode(m); reset(); }}
                      className="flex-1 py-2 rounded-md transition-all"
                      style={{
                        background: mode === m ? "#fff" : "transparent",
                        color: mode === m ? "#1C1C1C" : "#7A6C6A",
                        fontWeight: mode === m ? 600 : 400,
                        fontSize: "0.8375rem",
                        border: "none",
                        cursor: "pointer",
                        boxShadow: mode === m ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
                      }}
                    >
                      {m === "login" ? "Sign In" : "Sign Up"}
                    </button>
                  ))}
                </div>
              )}

              {/* Alerts */}
              {error && (
                <div
                  className="flex items-start gap-2.5 px-4 py-3 rounded-lg mb-4"
                  style={{ background: "#FFEBEE", border: "1px solid #FFCDD2" }}
                >
                  <AlertCircle size={15} color="#C0392B" style={{ flexShrink: 0, marginTop: "0.1rem" }} />
                  <p style={{ fontSize: "0.8125rem", color: "#C0392B", lineHeight: 1.5 }}>{error}</p>
                </div>
              )}
              {success && (
                <div
                  className="flex items-start gap-2.5 px-4 py-3 rounded-lg mb-4"
                  style={{ background: "#E8F5E9", border: "1px solid #C8E6C9" }}
                >
                  <CheckCircle2 size={15} color="#2E7D32" style={{ flexShrink: 0, marginTop: "0.1rem" }} />
                  <p style={{ fontSize: "0.8125rem", color: "#2E7D32", lineHeight: 1.5 }}>{success}</p>
                </div>
              )}

              {/* Fields */}
              {mode !== "signup" && <div className="flex flex-col gap-3.5">
                <div>
                  <label style={{ display: "block", fontSize: "0.775rem", fontWeight: 600, color: "#4A4A4A", marginBottom: "0.35rem" }}>Email Address *</label>
                  <div className="relative">
                    <Mail size={14} color="#B0A0A0" style={{ position: "absolute", left: "0.75rem", top: "50%", transform: "translateY(-50%)" }} />
                    <input type="email" placeholder="Enter your email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputBase} onFocus={handleFocus} onBlur={handleBlur} />
                  </div>
                </div>

                {mode !== "forgot" && (
                  <div>
                    <label style={{ display: "block", fontSize: "0.775rem", fontWeight: 600, color: "#4A4A4A", marginBottom: "0.35rem" }}>Password *</label>
                    <div className="relative">
                      <Lock size={14} color="#B0A0A0" style={{ position: "absolute", left: "0.75rem", top: "50%", transform: "translateY(-50%)" }} />
                      <input
                        type={showPass ? "text" : "password"}
                        placeholder="Enter password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        style={{ ...inputBase, paddingRight: "2.75rem" }}
                        onFocus={handleFocus}
                        onBlur={handleBlur}
                      />
                      <button type="button" onClick={() => setShowPass(!showPass)} style={{ position: "absolute", right: "0.75rem", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#B0A0A0" }}>
                        {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                  </div>
                )}

              </div>}

              {/* Forgot password link */}
              {mode === "login" && (
                <div className="text-right mt-2">
                  <button onClick={() => { setMode("forgot"); reset(); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.775rem", color: role.color, fontWeight: 500 }}>
                    Forgot password?
                  </button>
                </div>
              )}

              {/* Submit button */}
              <button
                onClick={mode === "login" ? handleLogin : mode === "signup" ? handleSignup : handleForgot}
                disabled={loading}
                className="w-full mt-5 flex items-center justify-center gap-2 py-3 rounded-xl transition-all"
                style={{
                  background: loading ? "#D4BFBB" : role.color,
                  color: "#fff",
                  fontWeight: 600,
                  fontSize: "0.9375rem",
                  border: "none",
                  cursor: loading ? "not-allowed" : "pointer",
                  boxShadow: loading ? "none" : `0 4px 14px ${role.color}40`,
                }}
                onMouseEnter={(e) => { if (!loading) e.currentTarget.style.filter = "brightness(0.92)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.filter = "none"; }}
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    Processing…
                  </>
                ) : mode === "login" ? (
                  <> Sign In <ChevronRight size={17} /></>
                ) : mode === "signup" ? (
                  <> Request administrator access <ChevronRight size={17} /></>
                ) : (
                  <> Send Reset Link <ChevronRight size={17} /></>
                )}
              </button>

              {/* Back to sign in from forgot */}
              {mode === "forgot" && (
                <button
                  onClick={() => { setMode("login"); reset(); }}
                  className="w-full mt-3 py-2.5 rounded-xl flex items-center justify-center gap-2"
                  style={{ background: "none", border: "1px solid #E8E2E0", color: "#7A6C6A", fontSize: "0.875rem", cursor: "pointer" }}
                >
                  <ArrowLeft size={14} /> Back to Sign In
                </button>
              )}

              {mode === "signup" && (
                <div
                  className="mt-5 p-3.5 rounded-xl"
                  style={{ background: "#F7F3F2", border: "1px solid #EAE2DF" }}
                >
                  <p style={{ fontSize: "0.8rem", color: "#7A6C6A" }}>Registration is managed by an administrator.</p>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <p style={{ textAlign: "center", fontSize: "0.72rem", color: "#B0A0A0", marginTop: "1.5rem" }}>
            DVS Industries © 2026 · Enterprise Platform v2.1
          </p>
        </div>
      </div>
    </div>
  );
}