import type { LucideIcon } from "lucide-react";
import { ReactNode, useState } from "react";
import { TrendingUp, TrendingDown, Minus, Search, X, Download, ChevronUp, ChevronDown, AlertCircle, RefreshCw, InboxIcon } from "lucide-react";

/* ── Page wrapper ── */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1 style={{ fontSize: "1.3rem", fontWeight: 700, color: "#1C1C1C" }}>{title}</h1>
        {subtitle && <p style={{ fontSize: "0.8375rem", color: "#7A6C6A", marginTop: "0.2rem" }}>{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ── KPI Card ── */
export function KPICard({
  label, value, sub, trend, trendDir, icon: Icon, accent = "#A52A2A",
}: {
  label: string;
  value: string | number;
  sub?: string;
  trend?: string;
  trendDir?: "up" | "down" | "flat";
  icon?: LucideIcon;
  accent?: string;
}) {
  const TrendIcon = trendDir === "up" ? TrendingUp : trendDir === "down" ? TrendingDown : Minus;
  const trendColor = trendDir === "up" ? "#2E7D32" : trendDir === "down" ? "#C0392B" : "#7A6C6A";
  return (
    <div
      className="p-5 rounded-lg"
      style={{
        background: "#FFFFFF",
        border: "1px solid #E8E2E0",
        boxShadow: "0 1px 6px rgba(0,0,0,0.05)",
      }}
    >
      <div className="flex items-start justify-between mb-3">
        <p style={{ fontSize: "0.775rem", color: "#7A6C6A", fontWeight: 500, letterSpacing: "0.03em", textTransform: "uppercase" }}>{label}</p>
        {Icon && (
          <div className="w-8 h-8 rounded-md flex items-center justify-center" style={{ background: `${accent}12` }}>
            <Icon size={16} color={accent} />
          </div>
        )}
      </div>
      <div style={{ fontSize: "1.6rem", fontWeight: 700, color: "#1C1C1C", lineHeight: 1.1 }}>{value}</div>
      {(sub || trend) && (
        <div className="flex items-center gap-2 mt-2">
          {trend && (
            <span className="flex items-center gap-1" style={{ fontSize: "0.75rem", color: trendColor }}>
              <TrendIcon size={12} /> {trend}
            </span>
          )}
          {sub && <span style={{ fontSize: "0.75rem", color: "#9A8A88" }}>{sub}</span>}
        </div>
      )}
    </div>
  );
}

/* ── Section card ── */
export function Card({ children, className = "", style = {} }: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={className}
      style={{
        background: "#FFFFFF",
        border: "1px solid #E8E2E0",
        borderRadius: "0.5rem",
        boxShadow: "0 1px 6px rgba(0,0,0,0.05)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* ── Card header ── */
export function CardHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid #F0ECEB" }}>
      <div>
        <h3 style={{ fontSize: "0.9rem", fontWeight: 600, color: "#1C1C1C" }}>{title}</h3>
        {subtitle && <p style={{ fontSize: "0.775rem", color: "#7A6C6A", marginTop: "0.1rem" }}>{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ── Status badge ── */
const statusMap: Record<string, { bg: string; color: string }> = {
  success: { bg: "#E8F5E9", color: "#2E7D32" },
  warning: { bg: "#FFF3E0", color: "#E65100" },
  critical: { bg: "#FFEBEE", color: "#C0392B" },
  info: { bg: "#E3F2FD", color: "#1565C0" },
  neutral: { bg: "#ECEFF1", color: "#546E7A" },
  pending: { bg: "#FFF8E1", color: "#F57F17" },
  active: { bg: "#E8F5E9", color: "#2E7D32" },
  completed: { bg: "#E8F5E9", color: "#1B5E20" },
  dispatched: { bg: "#E3F2FD", color: "#0D47A1" },
  delivered: { bg: "#E8F5E9", color: "#2E7D32" },
  "in-production": { bg: "#FFF3E0", color: "#BF360C" },
  approved: { bg: "#E8EAF6", color: "#283593" },
  rejected: { bg: "#FFEBEE", color: "#B71C1C" },
  low: { bg: "#E8F5E9", color: "#2E7D32" },
  medium: { bg: "#FFF8E1", color: "#F57F17" },
  high: { bg: "#FFF3E0", color: "#E65100" },
  open: { bg: "#FFF3E0", color: "#E65100" },
  resolved: { bg: "#E8F5E9", color: "#2E7D32" },
  investigating: { bg: "#E3F2FD", color: "#1565C0" },
  "in stock": { bg: "#E8F5E9", color: "#2E7D32" },
  "low stock": { bg: "#FFF8E1", color: "#F57F17" },
  "out of stock": { bg: "#FFEBEE", color: "#C0392B" },
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const s = statusMap[status.toLowerCase()] ?? { bg: "#ECEFF1", color: "#546E7A" };
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full"
      style={{ background: s.bg, color: s.color, fontSize: "0.72rem", fontWeight: 600, letterSpacing: "0.02em" }}
    >
      {label ?? status}
    </span>
  );
}

/* ── Button ── */
export function Btn({
  children, onClick, variant = "primary", size = "md", disabled = false, className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "success";
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
}) {
  const styles: Record<string, React.CSSProperties> = {
    primary: { background: "#A52A2A", color: "#fff", border: "1px solid #A52A2A" },
    secondary: { background: "#fff", color: "#4E342E", border: "1px solid #D4BFBB" },
    ghost: { background: "transparent", color: "#4E342E", border: "1px solid transparent" },
    danger: { background: "#FFEBEE", color: "#C0392B", border: "1px solid #FFCDD2" },
    success: { background: "#E8F5E9", color: "#2E7D32", border: "1px solid #C8E6C9" },
  };
  const pad = size === "sm" ? "0.375rem 0.75rem" : "0.5rem 1rem";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 rounded-md font-medium transition-all duration-150 ${className}`}
      style={{ ...styles[variant], padding: pad, fontSize: size === "sm" ? "0.775rem" : "0.8375rem", opacity: disabled ? 0.5 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
      onMouseEnter={(e) => { if (!disabled && variant === "primary") e.currentTarget.style.background = "#8B2222"; }}
      onMouseLeave={(e) => { if (!disabled && variant === "primary") e.currentTarget.style.background = "#A52A2A"; }}
    >
      {children}
    </button>
  );
}

/* ── Data table ── */
export function DataTable({ columns, rows, emptyMsg = "No data", searchable = false, paginate, exportFilename }: {
  columns: { key: string; label: string; width?: string }[];
  rows: Record<string, ReactNode>[];
  emptyMsg?: string;
  searchable?: boolean;
  paginate?: number;
  exportFilename?: string;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const filtered = searchable && query
    ? rows.filter((row) =>
        columns.some((col) => {
          const val = row[col.key];
          return typeof val === "string" && val.toLowerCase().includes(query.toLowerCase());
        })
      )
    : rows;

  const sorted = sortKey
    ? [...filtered].sort((a, b) => {
        const av = String(a[sortKey] ?? "");
        const bv = String(b[sortKey] ?? "");
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      })
    : filtered;

  const pageSize = paginate ?? sorted.length;
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const paged = sorted.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
    setPage(0);
  };

  const handleExport = () => {
    const header = columns.map((c) => `"${c.label}"`);
    const dataRows = filtered.map((row) => columns.map((c) => `"${String(row[c.key] ?? "").replace(/"/g, '""')}"`));
    const csv = [header, ...dataRows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = exportFilename ?? "export.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      {(searchable || exportFilename) && (
        <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: "1px solid #E8E2E0" }}>
          {searchable && (
            <div className="flex items-center gap-2 flex-1 max-w-sm px-3 py-1.5 rounded-md" style={{ background: "#F5F0EF" }}>
              <Search size={13} color="#9A8A88" />
              <input
                placeholder="Search..."
                value={query}
                onChange={(e) => { setQuery(e.target.value); setPage(0); }}
                style={{ background: "transparent", border: "none", outline: "none", fontSize: "0.8rem", color: "#1C1C1C", flex: 1 }}
              />
              {query && (
                <button onClick={() => setQuery("")} style={{ background: "none", border: "none", cursor: "pointer", color: "#9A8A88", display: "flex" }}>
                  <X size={12} />
                </button>
              )}
            </div>
          )}
          {exportFilename && (
            <button
              onClick={handleExport}
              style={{ marginLeft: searchable ? "auto" : undefined, display: "flex", alignItems: "center", gap: "0.375rem", padding: "0.375rem 0.75rem", borderRadius: "0.375rem", background: "#fff", border: "1px solid #D4BFBB", fontSize: "0.775rem", fontWeight: 500, color: "#4E342E", cursor: "pointer" }}
            >
              <Download size={13} /> Export CSV
            </button>
          )}
        </div>
      )}
      <div className="overflow-x-auto">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#F7F3F2" }}>
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  style={{
                    padding: "0.625rem 1rem",
                    textAlign: "left",
                    fontSize: "0.72rem",
                    fontWeight: 600,
                    color: "#7A6C6A",
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    width: col.width,
                    whiteSpace: "nowrap",
                    borderBottom: "1px solid #E8E2E0",
                    cursor: "pointer",
                    userSelect: "none",
                  }}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {sortKey === col.key
                      ? sortDir === "asc" ? <ChevronUp size={11} /> : <ChevronDown size={11} />
                      : null}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 ? (
              <tr>
                <td colSpan={columns.length} style={{ padding: "2.5rem", textAlign: "center", color: "#9A8A88", fontSize: "0.875rem" }}>
                  {query ? `No results for "${query}"` : emptyMsg}
                </td>
              </tr>
            ) : (
              paged.map((row, i) => (
                <tr
                  key={i}
                  style={{ borderBottom: "1px solid #F0ECEB" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "#FDFBFB"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  {columns.map((col) => (
                    <td key={col.key} style={{ padding: "0.75rem 1rem", fontSize: "0.8375rem", color: "#2C2C2C", verticalAlign: "middle" }}>
                      {row[col.key]}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {paginate && totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: "1px solid #F0ECEB" }}>
          <span style={{ fontSize: "0.72rem", color: "#9A8A88" }}>
            {safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, sorted.length)} of {sorted.length} records
          </span>
          <div className="flex gap-1">
            <button disabled={safePage === 0} onClick={() => setPage((p) => p - 1)}
              style={{ padding: "0.25rem 0.625rem", borderRadius: "0.375rem", border: "1px solid #E8E2E0", background: "#fff", cursor: safePage === 0 ? "not-allowed" : "pointer", opacity: safePage === 0 ? 0.4 : 1, fontSize: "0.775rem" }}>
              ←
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, k) => {
              const p = Math.max(0, Math.min(safePage - 2, totalPages - 5)) + k;
              if (p >= totalPages) return null;
              return (
                <button key={p} onClick={() => setPage(p)}
                  style={{ padding: "0.25rem 0.5rem", minWidth: "2rem", borderRadius: "0.375rem", border: `1px solid ${p === safePage ? "#A52A2A" : "#E8E2E0"}`, background: p === safePage ? "#A52A2A" : "#fff", color: p === safePage ? "#fff" : "#4A4A4A", cursor: "pointer", fontSize: "0.775rem" }}>
                  {p + 1}
                </button>
              );
            })}
            <button disabled={safePage >= totalPages - 1} onClick={() => setPage((p) => p + 1)}
              style={{ padding: "0.25rem 0.625rem", borderRadius: "0.375rem", border: "1px solid #E8E2E0", background: "#fff", cursor: safePage >= totalPages - 1 ? "not-allowed" : "pointer", opacity: safePage >= totalPages - 1 ? 0.4 : 1, fontSize: "0.775rem" }}>
              →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Tab bar ── */
export function TabBar({ tabs, active, onChange }: { tabs: { id: string; label: string }[]; active: string; onChange: (id: string) => void }) {
  return (
    <div className="flex gap-0 overflow-x-auto" style={{ borderBottom: "2px solid #E8E2E0" }}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className="px-4 py-2.5 whitespace-nowrap transition-all duration-150"
          style={{
            fontSize: "0.8375rem",
            fontWeight: active === tab.id ? 600 : 400,
            color: active === tab.id ? "#A52A2A" : "#7A6C6A",
            borderTop: "none",
            borderRight: "none",
            borderBottom: `2px solid ${active === tab.id ? "#A52A2A" : "transparent"}`,
            borderLeft: "none",
            marginBottom: "-2px",
            background: "transparent",
            cursor: "pointer",
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/* ── Input ── */
export function Input({ label, placeholder, value, onChange, type = "text" }: {
  label?: string; placeholder?: string; value?: string; onChange?: (v: string) => void; type?: string;
}) {
  return (
    <div>
      {label && <label style={{ display: "block", fontSize: "0.775rem", fontWeight: 500, color: "#4A4A4A", marginBottom: "0.3rem" }}>{label}</label>}
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        style={{
          width: "100%",
          padding: "0.5rem 0.75rem",
          border: "1px solid #D4BFBB",
          borderRadius: "0.375rem",
          fontSize: "0.8375rem",
          color: "#1C1C1C",
          background: "#FAFAFA",
          outline: "none",
          transition: "border-color 0.15s",
        }}
        onFocus={(e) => { e.target.style.borderColor = "#A52A2A"; e.target.style.boxShadow = "0 0 0 3px rgba(165,42,42,0.1)"; }}
        onBlur={(e) => { e.target.style.borderColor = "#D4BFBB"; e.target.style.boxShadow = "none"; }}
      />
    </div>
  );
}

/* ── Select ── */
export function Select({ label, options, value, onChange }: {
  label?: string; options: { value: string; label: string }[]; value?: string; onChange?: (v: string) => void;
}) {
  return (
    <div>
      {label && <label style={{ display: "block", fontSize: "0.775rem", fontWeight: 500, color: "#4A4A4A", marginBottom: "0.3rem" }}>{label}</label>}
      <select
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        style={{
          width: "100%",
          padding: "0.5rem 0.75rem",
          border: "1px solid #D4BFBB",
          borderRadius: "0.375rem",
          fontSize: "0.8375rem",
          color: "#1C1C1C",
          background: "#FAFAFA",
          outline: "none",
          cursor: "pointer",
        }}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

/* ── Progress bar ── */
export function ProgressBar({ value, max = 100, color = "#A52A2A", showLabel = true }: {
  value: number; max?: number; color?: string; showLabel?: boolean;
}) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div>
      <div className="flex justify-between mb-1">
        {showLabel && <span style={{ fontSize: "0.75rem", color: "#7A6C6A" }}>{pct.toFixed(1)}%</span>}
      </div>
      <div style={{ height: "6px", background: "#F0ECEB", borderRadius: "999px", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: "999px", transition: "width 0.5s ease" }} />
      </div>
    </div>
  );
}

/* ── Skeleton loader ── */
export function Skeleton({ lines = 4, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`p-5 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="rounded mb-3"
          style={{
            height: "1rem",
            width: i === 0 ? "40%" : i % 3 === 0 ? "60%" : "100%",
            background: "linear-gradient(90deg, #F0ECEB 25%, #E8E2E0 50%, #F0ECEB 75%)",
            backgroundSize: "200% 100%",
            animation: "skeleton-shimmer 1.4s infinite",
          }}
        />
      ))}
      <style>{`@keyframes skeleton-shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
    </div>
  );
}

/* ── Empty state ── */
export function EmptyState({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="w-14 h-14 rounded-full flex items-center justify-center mb-4" style={{ background: "#F5F0EF" }}>
        <InboxIcon size={24} color="#D4BFBB" />
      </div>
      <p style={{ fontSize: "0.9375rem", fontWeight: 600, color: "#4A4A4A", marginBottom: "0.375rem" }}>{title}</p>
      {subtitle && <p style={{ fontSize: "0.8125rem", color: "#9A8A88", maxWidth: 320 }}>{subtitle}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ── Error state ── */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="w-14 h-14 rounded-full flex items-center justify-center mb-4" style={{ background: "#FFEBEE" }}>
        <AlertCircle size={24} color="#C0392B" />
      </div>
      <p style={{ fontSize: "0.9375rem", fontWeight: 600, color: "#1C1C1C", marginBottom: "0.375rem" }}>Something went wrong</p>
      <p style={{ fontSize: "0.8125rem", color: "#7A6C6A", maxWidth: 320, marginBottom: onRetry ? "1rem" : 0 }}>{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 1.25rem", borderRadius: "0.5rem", background: "#A52A2A", color: "#fff", border: "none", cursor: "pointer", fontSize: "0.8375rem", fontWeight: 600 }}
        >
          <RefreshCw size={14} /> Try Again
        </button>
      )}
    </div>
  );
}
