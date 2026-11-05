import { useMemo, useState } from "react";
import { Building2, ClipboardList, Clock, Download, Eye, Factory, FileText, Package, Recycle, Shield, Truck, Users, X, type LucideIcon } from "lucide-react";
import { createPortal } from "react-dom";
import { PageHeader, Card, CardHeader, Btn, StatusBadge } from "../shared/UI";
import { toast } from "sonner";
import {
  getAttendanceReport, getClientReport, getInventoryReport, getOrdersReport,
  getProductionReport, getScrapReport, getSecurityReport, getSupplierReport, getWorkforceReport,
  type AttendanceReport, type ClientReport, type InventoryReport, type OrdersReport,
  type ProductionReport, type ScrapReport, type SecurityReport, type SupplierReport, type WorkforceReport,
} from "../../../lib/services/reports.service";
import { downloadCSV } from "../../../lib/csv";
import { formatINR } from "../../../lib/format";
import { getStoredBackendRole } from "../../../lib/auth";
import { reportsFor } from "../../../lib/permissions";
import { useApiData } from "../../../lib/useApiData";
import { getDepartments } from "../../../lib/services/departments.service";

type ReportPayload = InventoryReport | WorkforceReport | OrdersReport | ScrapReport | SupplierReport | ClientReport | ProductionReport | AttendanceReport | SecurityReport;
type ReportId = "production" | "inventory" | "workforce" | "orders" | "scrap" | "supplier" | "client" | "attendance" | "security";
type ReportFilters = { fromDate?: string; toDate?: string; departmentId?: number };

const reportTypes: Array<{ id: ReportId; title: string; desc: string; icon: LucideIcon; color: string }> = [
  { id: "production", title: "Production Report", desc: "Actual vs expected output, efficiency, scrap, department breakdown", icon: Factory, color: "#A52A2A" },
  { id: "inventory", title: "Inventory Report", desc: "Stock levels, material consumption, reorder status, valuation", icon: Package, color: "#4E342E" },
  { id: "workforce", title: "Workforce Report", desc: "Employee status and department breakdown", icon: Users, color: "#1565C0" },
  { id: "attendance", title: "Attendance Report", desc: "Date-range attendance summary by employee", icon: Clock, color: "#1565C0" },
  { id: "orders", title: "Order Report", desc: "Client orders, supplier POs, fulfillment rate, delivery performance", icon: ClipboardList, color: "#2E7D32" },
  { id: "scrap", title: "Scrap Report", desc: "Scrap records grouped by department and material", icon: Recycle, color: "#E65100" },
  { id: "supplier", title: "Supplier Report", desc: "Supplier ratings and purchase-order counts", icon: Truck, color: "#546E7A" },
  { id: "client", title: "Client Report", desc: "Client order counts and delivered revenue", icon: Building2, color: "#283593" },
  { id: "security", title: "Security Report", desc: "Incidents by status and severity, resolution time, alert counts", icon: Shield, color: "#B71C1C" },
];

const fetchers: Partial<Record<ReportId, (filters: ReportFilters) => Promise<ReportPayload>>> = {
  production: (filters) => getProductionReport(filters),
  inventory: (filters) => getInventoryReport(filters),
  workforce: (filters) => getWorkforceReport(filters),
  attendance: (filters) => getAttendanceReport(filters),
  orders: (filters) => getOrdersReport(filters),
  scrap: (filters) => getScrapReport(filters),
  supplier: (filters) => getSupplierReport(filters),
  client: (filters) => getClientReport(filters),
  security: (filters) => getSecurityReport(filters),
};

function rowsToCSV(rows: Array<Record<string, unknown>>): string[][] {
  if (rows.length === 0) return [];
  const headers = Object.keys(rows[0]);
  return [headers, ...rows.map((row) => headers.map((header) => String(row[header] ?? "")))];
}

function reportToCSV(id: ReportId, data: ReportPayload): string[][] {
  if (id === "orders") {
    const report = data as OrdersReport;
    return [["Client Orders"], ...rowsToCSV(report.clientOrders), [], ["Purchase Orders"], ...rowsToCSV(report.purchaseOrders)];
  }
  if (!("rows" in data)) return [];
  return rowsToCSV(data.rows as Array<Record<string, unknown>>);
}

// Summary fields that hold rupee amounts (totalRevenue, totalValue, recoveryValue…)
const MONEY_KEY = /(revenue|procurement|value|cost|spend)$/i;

function getSummary(data: ReportPayload): Array<[string, string]> {
  if (!("summary" in data)) return [];
  return Object.entries(data.summary)
    .filter(([, value]) => typeof value !== "object")
    .map(([key, value]) => [key, MONEY_KEY.test(key) ? formatINR(value as string | number) : String(value)]);
}

/** Print only the report: a DVS header, the period, the summary and every row. */
export function printReport(): void {
  document.body.classList.add("printing-report");
  const done = () => { document.body.classList.remove("printing-report"); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  window.print();
}

function PrintableReport({ report, title }: { report: ReportPayload; title: string }) {
  const summary = getSummary(report);
  const rows = "rows" in report ? (report.rows as Array<Record<string, unknown>>) : [];
  const columns = rows[0] ? Object.keys(rows[0]) : [];
  return createPortal(
    <div className="report-print" aria-hidden="true">
      <header style={{ borderBottom: "2px solid #A52A2A", paddingBottom: "8px", marginBottom: "12px" }}>
        <p style={{ fontSize: "12pt", fontWeight: 800, letterSpacing: "0.06em" }}>DVS INDUSTRIES</p>
        <h1 style={{ fontSize: "16pt", fontWeight: 700 }}>{title}</h1>
        <p style={{ fontSize: "9pt" }}>Period: {report.period} · Generated {new Date(report.generatedAt).toLocaleString("en-IN")}</p>
      </header>
      {summary.length > 0 && (
        <table style={{ marginBottom: "12px", fontSize: "9pt" }}><tbody>
          {summary.map(([key, value]) => <tr key={key}><td style={{ paddingRight: "16px" }}>{key}</td><td style={{ fontWeight: 700 }}>{value}</td></tr>)}
        </tbody></table>
      )}
      {rows.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "8pt" }}>
          <thead><tr>{columns.map((c) => <th key={c} style={{ textAlign: "left", borderBottom: "1px solid #000", padding: "3px" }}>{c}</th>)}</tr></thead>
          <tbody>{rows.map((row, i) => <tr key={i}>{columns.map((c) => <td key={c} style={{ borderBottom: "1px solid #ccc", padding: "3px" }}>{String(row[c] ?? "")}</td>)}</tr>)}</tbody>
        </table>
      )}
    </div>,
    document.body,
  );
}

function PreviewModal({ report, title, onClose, onPrint, onCSV }: { report: ReportPayload | null; title: string; onClose: () => void; onPrint: () => void; onCSV: () => void }) {
  const summary = report ? getSummary(report) : [];
  const rows = report && "rows" in report ? report.rows : [];
  return (
    <>
    {report && <PrintableReport report={report} title={title} />}
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.45)" }} onClick={onClose}>
      <div className="rounded-xl overflow-hidden w-full max-w-3xl mx-4" style={{ background: "#fff", maxHeight: "90vh", overflowY: "auto" }} onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid #E8E2E0", background: "#F9F6F5" }}>
          <div><h2 style={{ fontSize: "1rem", fontWeight: 700 }}>{title}</h2><p style={{ fontSize: "0.72rem", color: "#9A8A88" }}>{report ? report.period : "Unavailable"}</p></div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#7A6C6A" }}><X size={18} /></button>
        </div>
        <div className="p-6">
          {!report ? <p style={{ fontSize: "0.8375rem", color: "#7A6C6A" }}>No data available.</p> : (
            <>
              {summary.length > 0 && <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">{summary.map(([key, value]) => <div key={key} className="p-3 rounded-xl" style={{ background: "#F9F6F5", border: "1px solid #E8E2E0" }}><p style={{ fontSize: "0.68rem", color: "#9A8A88", textTransform: "uppercase" }}>{key}</p><p style={{ fontSize: "1rem", fontWeight: 800, color: "#4E342E", marginTop: "0.25rem" }}>{value}</p></div>)}</div>}
              {rows.length === 0 ? <p style={{ fontSize: "0.8375rem", color: "#7A6C6A" }}>No data available.</p> : <div style={{ overflowX: "auto" }}><table style={{ width: "100%", fontSize: "0.75rem" }}><thead><tr>{Object.keys(rows[0]).map((key) => <th key={key} style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid #E8E2E0" }}>{key}</th>)}</tr></thead><tbody>{rows.slice(0, 25).map((row, index) => <tr key={index}>{Object.keys(rows[0]).map((key) => <td key={key} style={{ padding: "0.5rem", borderBottom: "1px solid #F0ECEB" }}>{String((row as Record<string, unknown>)[key] ?? "")}</td>)}</tr>)}</tbody></table></div>}
            </>
          )}
          <div className="flex gap-2 mt-5"><Btn variant="secondary" onClick={onClose}>Close</Btn><Btn variant="secondary" disabled={!report || rows.length === 0} onClick={onCSV}><Download size={12} /> Export CSV</Btn><Btn disabled={!report} onClick={onPrint}><FileText size={12} /> Print Report</Btn></div>
        </div>
      </div>
    </div>
    </>
  );
}

export function ReportsPage() {
  // Only reports this role may load
  const allowedReports = useMemo(() => reportsFor(getStoredBackendRole()), []);
  const departments = useApiData(() => getDepartments(), [], "load departments");
  const [filters, setFilters] = useState<ReportFilters>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [reports, setReports] = useState<Record<string, ReportPayload>>({});
  const [preview, setPreview] = useState<ReportId | null>(null);

  const generate = async (id: ReportId) => {
    const fetcher = fetchers[id];
    if (!fetcher) { setErrors((state) => ({ ...state, [id]: "This report is not available for your role." })); return; }
    setLoading((state) => ({ ...state, [id]: true }));
    setErrors((state) => ({ ...state, [id]: "" }));
    try {
      const data = await fetcher(filters);
      setReports((state) => ({ ...state, [id]: data }));
      toast.success("Report data loaded successfully.");
    } catch (error) {
      setErrors((state) => ({ ...state, [id]: error instanceof Error ? error.message : "Report data could not be loaded." }));
    } finally {
      setLoading((state) => ({ ...state, [id]: false }));
    }
  };

  const handleCSV = (id: ReportId) => {
    const report = reports[id];
    if (!report) { toast.error("No data available for CSV export."); return; }
    const rows = reportToCSV(id, report);
    if (rows.length === 0) { toast.error("No data available for CSV export."); return; }
    downloadCSV(`DVS_${id}_report.csv`, rows);
  };

  const report = preview ? reports[preview] ?? null : null;
  return (
    <>
      {preview && <PreviewModal report={report} title={reportTypes.find((item) => item.id === preview)?.title ?? "Report"} onClose={() => setPreview(null)} onCSV={() => handleCSV(preview)} onPrint={printReport} />}
      <div className="p-6">
        <PageHeader title="Reports Center" subtitle="Load and export operational reports" />
        <div className="flex flex-wrap items-end gap-3 mb-6 p-4 rounded-xl" style={{ background: "#F9F6F5", border: "1px solid #E8E2E0" }}>
          <label style={{ fontSize: "0.75rem", color: "#4A4A4A" }}>From<input type="date" value={filters.fromDate ?? ""} onChange={(event) => setFilters({ ...filters, fromDate: event.target.value || undefined })} className="block mt-1 p-2 rounded-md" /></label>
          <label style={{ fontSize: "0.75rem", color: "#4A4A4A" }}>To<input type="date" value={filters.toDate ?? ""} onChange={(event) => setFilters({ ...filters, toDate: event.target.value || undefined })} className="block mt-1 p-2 rounded-md" /></label>
          <label style={{ fontSize: "0.75rem", color: "#4A4A4A" }}>Department
            <select value={filters.departmentId ?? ""} onChange={(event) => setFilters({ ...filters, departmentId: event.target.value ? Number(event.target.value) : undefined })} disabled={departments.loading} className="block mt-1 p-2 rounded-md" style={{ minWidth: "11rem", border: "1px solid #E8E2E0", background: "#fff" }}>
              <option value="">All departments</option>
              {(departments.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <span style={{ fontSize: "0.72rem", color: "#7A6C6A" }}>Filters apply when a report is loaded.</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {reportTypes.filter((item) => allowedReports.includes(item.id)).map((item) => {
            const loaded = Boolean(reports[item.id]);
            const error = errors[item.id];
            const unavailable = !fetchers[item.id];
            return <div key={item.id} className="p-5 rounded-lg" style={{ background: "#FFFFFF", border: "1px solid #E8E2E0" }}><div className="flex items-start justify-between mb-3"><span className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `${item.color}14` }}><item.icon size={18} color={item.color} aria-hidden="true" /></span>{loaded && <StatusBadge status="ready" label="Loaded" />}</div><h3 style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.4rem" }}>{item.title}</h3><p style={{ fontSize: "0.72rem", color: "#7A6C6A", lineHeight: 1.55, minHeight: "2.2rem" }}>{item.desc}</p>{error && <p style={{ fontSize: "0.72rem", color: "#C0392B", marginTop: "0.5rem" }}>{error}</p>}<div className="flex gap-1.5 mt-3"><button disabled={unavailable || loading[item.id]} onClick={() => generate(item.id)} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md" style={{ background: unavailable || loading[item.id] ? "#F5F0EF" : item.color, color: unavailable || loading[item.id] ? "#7A6C6A" : "#fff", fontSize: "0.72rem", fontWeight: 600, border: "none", cursor: unavailable || loading[item.id] ? "not-allowed" : "pointer" }}>{unavailable ? "Unavailable" : loading[item.id] ? "Loading..." : "Load Report"}</button>{loaded && <button onClick={() => setPreview(item.id)} className="px-2 py-1.5 rounded-md" style={{ background: "#F0F4FF", color: "#1565C0", border: "none" }}><Eye size={12} /></button>}</div></div>;
          })}
        </div>
        <Card><CardHeader title="Loaded Reports" subtitle="Reports you have loaded in this session" /><div className="p-5">{Object.keys(reports).length === 0 ? <p style={{ fontSize: "0.8375rem", color: "#7A6C6A" }}>No data available.</p> : Object.keys(reports).map((id) => <div key={id} className="flex items-center justify-between py-3" style={{ borderBottom: "1px solid #F0ECEB" }}><span style={{ fontSize: "0.8375rem" }}>{reportTypes.find((item) => item.id === id)?.title ?? id}</span><div className="flex gap-2"><Btn size="sm" variant="secondary" onClick={() => setPreview(id as ReportId)}><Eye size={12} /> Preview</Btn><Btn size="sm" variant="ghost" onClick={() => handleCSV(id as ReportId)}><Download size={12} /> CSV</Btn></div></div>)}</div></Card>
      </div>
    </>
  );
}