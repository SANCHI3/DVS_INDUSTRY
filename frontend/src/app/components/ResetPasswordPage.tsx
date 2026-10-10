import { useState } from "react";
import { Lock, AlertCircle, CheckCircle2 } from "lucide-react";
import { resetPassword } from "../../lib/auth";
import { isApiError } from "../../lib/api";

interface ResetPasswordPageProps {
  token: string;
  onDone: () => void;
}

// Mirrors the backend password policy so users see problems before submitting
const RULES: Array<[RegExp, string]> = [
  [/.{8,}/, "at least 8 characters"],
  [/[A-Z]/, "an uppercase letter"],
  [/[a-z]/, "a lowercase letter"],
  [/[0-9]/, "a number"],
  [/[!@#$%^&*(),.?":{}|<>]/, "a special character"],
];

export function ResetPasswordPage({ token, onDone }: ResetPasswordPageProps) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const missing = RULES.filter(([re]) => !re.test(password)).map(([, label]) => label);

  const submit = async () => {
    setError("");
    if (missing.length > 0) { setError(`Password needs ${missing.join(", ")}.`); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setLoading(true);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(isApiError(err) ? err.message : "Could not reset password. The link may have expired.");
    } finally {
      setLoading(false);
    }
  };

  const input: React.CSSProperties = {
    width: "100%", padding: "0.625rem 0.875rem", borderRadius: "0.5rem",
    border: "1px solid #E8E2E0", fontSize: "0.875rem", outline: "none",
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "#FBF9F8" }}>
      <div className="w-full max-w-sm rounded-xl p-6" style={{ background: "#fff", border: "1px solid #E8E2E0" }}>
        <div className="flex items-center gap-2 mb-4">
          <Lock size={18} color="#A52A2A" />
          <h1 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#1C1C1C" }}>Choose a new password</h1>
        </div>

        {done ? (
          <>
            <p className="flex items-start gap-2 mb-4" style={{ fontSize: "0.85rem", color: "#2E7D32" }}>
              <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
              Your password has been reset. Sign in with your new password.
            </p>
            <button onClick={onDone} className="w-full rounded-lg py-2.5"
              style={{ background: "#A52A2A", color: "#fff", fontWeight: 600, fontSize: "0.875rem" }}>
              Go to sign in
            </button>
          </>
        ) : (
          <div className="flex flex-col gap-3">
            <input type="password" placeholder="New password" autoComplete="new-password"
              value={password} onChange={(e) => setPassword(e.target.value)} style={input} />
            <input type="password" placeholder="Confirm new password" autoComplete="new-password"
              value={confirm} onChange={(e) => setConfirm(e.target.value)} style={input}
              onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} />
            {error && (
              <p className="flex items-start gap-2" style={{ fontSize: "0.8rem", color: "#C0392B" }}>
                <AlertCircle size={14} className="mt-0.5 shrink-0" />{error}
              </p>
            )}
            <button onClick={() => void submit()} disabled={loading} className="w-full rounded-lg py-2.5"
              style={{ background: "#A52A2A", color: "#fff", fontWeight: 600, fontSize: "0.875rem", opacity: loading ? 0.7 : 1 }}>
              {loading ? "Saving…" : "Reset password"}
            </button>
            <button onClick={onDone} style={{ fontSize: "0.775rem", color: "#7A6C6A", background: "none", border: "none" }}>
              Back to sign in
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
