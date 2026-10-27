import { useEffect, type CSSProperties, type ReactNode } from "react";
import { AlertCircle, Info, Loader2, RefreshCw } from "lucide-react";

export const inputStyle: CSSProperties = {
  width: "100%",
  height: "2.375rem",
  padding: "0 0.75rem",
  border: "1px solid #D4BFBB",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  background: "#fff",
  color: "#1C1C1C",
  outline: "none",
};

export const disabledInputStyle: CSSProperties = { ...inputStyle, background: "#F7F3F2", color: "#4A4A4A" };

export const filterStyle: CSSProperties = {
  height: "2.25rem",
  padding: "0 0.75rem",
  border: "1px solid #E8E2E0",
  borderRadius: "0.375rem",
  fontSize: "0.8375rem",
  background: "#fff",
  color: "#1C1C1C",
};

/** Label, control, then a hint or a validation message (linked for screen readers). */
export function Field({ id, label, required, hint, error, children }: {
  id: string;
  label: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} style={{ display: "block", fontSize: "0.775rem", fontWeight: 600, color: "#4A4A4A", marginBottom: "0.35rem" }}>
        {label}{required && <span style={{ color: "#A52A2A" }}> *</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-msg`} role="alert" style={{ fontSize: "0.72rem", color: "#C0392B", marginTop: "0.3rem" }}>{error}</p>
      ) : hint ? (
        <p id={`${id}-msg`} style={{ fontSize: "0.72rem", color: "#9A8A88", marginTop: "0.3rem" }}>{hint}</p>
      ) : null}
    </div>
  );
}

export function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-3 mt-1">
      <h3 style={{ fontSize: "0.8125rem", fontWeight: 700, color: "#A52A2A", letterSpacing: "0.04em", textTransform: "uppercase" }}>{title}</h3>
      {subtitle && <p style={{ fontSize: "0.75rem", color: "#9A8A88", marginTop: "0.15rem" }}>{subtitle}</p>}
    </div>
  );
}

const TONES = {
  error: { bg: "#FFEBEE", border: "#FFCDD2", color: "#B71C1C", Icon: AlertCircle },
  warning: { bg: "#FFF8E1", border: "#FFE082", color: "#8D5A00", Icon: AlertCircle },
  info: { bg: "#F5F0EF", border: "#E8E2E0", color: "#4E342E", Icon: Info },
} as const;

/** One-line status message with an optional Retry, for a card or a form. */
export function InlineNotice({ tone, children, onRetry }: { tone: keyof typeof TONES; children: ReactNode; onRetry?: () => void }) {
  const t = TONES[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className="flex items-start gap-2 px-3 py-2 rounded-md" style={{ background: t.bg, border: `1px solid ${t.border}`, color: t.color, fontSize: "0.8rem" }}>
      <t.Icon size={14} style={{ marginTop: 2, flexShrink: 0 }} />
      <div className="flex-1">{children}</div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="flex items-center gap-1" style={{ background: "none", border: "none", color: t.color, fontWeight: 600, cursor: "pointer", fontSize: "0.775rem" }}>
          <RefreshCw size={12} /> Retry
        </button>
      )}
    </div>
  );
}

export function LoadingLine({ text }: { text: string }) {
  return (
    <p role="status" className="flex items-center gap-2" style={{ fontSize: "0.8375rem", color: "#7A6C6A" }}>
      <Loader2 size={14} className="animate-spin" /> {text}
    </p>
  );
}

/** "Showing 26–50 of 312" with previous/next, for server-side pages. */
export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const btn = (disabled: boolean): CSSProperties => ({
    padding: "0.3rem 0.75rem", borderRadius: "0.375rem", border: "1px solid #E8E2E0", background: "#fff",
    fontSize: "0.775rem", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.4 : 1,
  });
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" style={{ borderTop: "1px solid #F0ECEB" }}>
      <span style={{ fontSize: "0.75rem", color: "#7A6C6A" }}>Showing {from}–{to} of {total} records</span>
      <div className="flex items-center gap-2">
        <button type="button" style={btn(page <= 1)} disabled={page <= 1} onClick={() => onPage(page - 1)}>← Previous</button>
        <span style={{ fontSize: "0.75rem", color: "#4A4A4A" }}>Page {page} of {totalPages}</span>
        <button type="button" style={btn(page >= totalPages)} disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next →</button>
      </div>
    </div>
  );
}

/** Centred dialog with a sticky header and footer; the body scrolls on short screens. */
export function DialogFrame({ title, subtitle, onClose, footer, children, width = "max-w-3xl" }: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative w-full ${width} flex flex-col rounded-xl overflow-hidden`}
        style={{ background: "#fff", maxHeight: "92vh", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-6 py-4" style={{ borderBottom: "1px solid #E8E2E0", background: "#F9F6F5" }}>
          <div>
            <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#1C1C1C" }}>{title}</h2>
            {subtitle && <p style={{ fontSize: "0.8rem", color: "#7A6C6A", marginTop: "0.2rem" }}>{subtitle}</p>}
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="p-1 rounded-md" style={{ color: "#7A6C6A", background: "none", border: "none", cursor: "pointer" }}>
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-3 px-6 py-3" style={{ borderTop: "1px solid #E8E2E0", background: "#fff" }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function PrimaryButton({ children, type = "button", disabled, onClick }: { children: ReactNode; type?: "button" | "submit"; disabled?: boolean; onClick?: () => void }) {
  return (
    <button type={type} disabled={disabled} onClick={onClick} className="flex items-center gap-1.5 px-4 py-2 rounded-md"
      style={{ background: "#A52A2A", color: "#fff", fontSize: "0.875rem", fontWeight: 600, border: "none", opacity: disabled ? 0.6 : 1, cursor: disabled ? "not-allowed" : "pointer" }}>
      {children}
    </button>
  );
}

export function SecondaryButton({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="flex items-center gap-1.5 px-4 py-2 rounded-md"
      style={{ border: "1px solid #D4BFBB", background: "#fff", color: "#4A4A4A", fontSize: "0.875rem", opacity: disabled ? 0.6 : 1, cursor: disabled ? "not-allowed" : "pointer" }}>
      {children}
    </button>
  );
}
