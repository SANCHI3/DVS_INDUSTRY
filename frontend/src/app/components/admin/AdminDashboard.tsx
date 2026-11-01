import { useState, useEffect } from "react";
import {
  Factory, Users, Package, ShoppingCart, Shield, AlertTriangle, TrendingUp,
  Truck, Plus, FileText, UserPlus, CheckCircle2, Zap,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell,
} from "recharts";
import { KPICard, Card, CardHeader, StatusBadge, Btn } from "../shared/UI";
import { getDashboard, type DashboardKPIs, type DashboardCharts } from "../../../lib/services/dashboard.service";
import { eventTypeLabel } from "../../../lib/incidentLabels";
import { getProductionTrend, type ProductionTrendEntry } from "../../../lib/services/production.service";
import { formatINRCompact } from "../../../lib/format";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Same short date the Orders page uses. */
function fmtOrderDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function fmtQty(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

/** "84.2%" → 84.2 */
function pctValue(text: string | null): number | null {
  return text === null ? null : parseFloat(text);
}

function dataMessage(loading: boolean, failed: boolean): string {
  if (loading) return "Loading…";
  if (failed) return "Couldn't load";
  return "No data available";
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AdminDashboard({ onNavigate }: { onNavigate: (s: string) => void }) {
  const [kpis,    setKpis]   = useState<DashboardKPIs | null>(null);
  const [charts,  setCharts] = useState<DashboardCharts | null>(null);
  const [trend,   setTrend]  = useState<ProductionTrendEntry[] | null>(null);
  const [dashboardError, setDashboardError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.allSettled([
      getDashboard(),
      getProductionTrend({ days: 7 }),
    ]).then(([dashResult, trendResult]) => {
      if (cancelled) return;
      setTrend(trendResult.status === "fulfilled" ? trendResult.value : []);
      if (dashResult.status === "fulfilled") {
        setKpis(dashResult.value.kpis);
        setCharts(dashResult.value.charts);
      } else {
        setDashboardError(true);
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  // ── Derived chart data ─────────────────────────────────────────────────────

  const attTrend = charts?.attendanceTrend?.map(e => ({
    day: e.date,
    present: e.present,
  })) ?? [];
  const attHasPoints = attTrend.some((e) => e.present !== null);

  const scrapTrend = charts?.scrapByDepartment?.slice(0, 6).map(e => ({
    dept: e.dept,
    scrap: e.kg,
  })) ?? [];

  const orderPie = charts?.orderStatusPie ?? [];

  const recentOrders = charts?.recentOrders?.map(o => ({
    id: o.orderNumber,
    client: o.client,
    product: o.product,
    qty: o.qty,
    status: o.status,
    date: fmtOrderDate(o.orderDate),
  })) ?? [];

  const openIncidents = charts?.openIncidents?.map(i => ({
    id: i.incidentNumber,
    type: eventTypeLabel(i.type),
    location: i.location ?? "—",
    severity: i.severity.toLowerCase(),
    status: i.status.toLowerCase(),
    time: fmtWhen(i.occurredAt),
  })) ?? [];

  // AI insights derived from KPIs
  const pm = kpis?.productionMonth;
  const needsAttention = kpis ? kpis.openIncidents + kpis.investigatingIncidents : 0;
  const attendanceRate = pctValue(kpis?.attendanceTodayRate ?? null);
  const aiInsights = kpis && pm ? [
    kpis.lowStockCount > 0
      ? { type: "warn", msg: `${kpis.lowStockCount} material(s) below minimum stock level — check inventory` }
      : { type: "success", msg: "All inventory levels within safe thresholds" },
    kpis.overdueWorkOrders > 0
      ? { type: "warn", msg: `${kpis.overdueWorkOrders} work order(s) past scheduled end — review production` }
      : { type: "success", msg: "All work orders on schedule" },
    pm.completedShort > 0
      ? { type: "warn", msg: `${pm.completedShort} work order(s) closed below target in ${pm.label}` }
      : null,
    kpis.criticalOpenIncidents > 0
      ? { type: "warn", msg: `${kpis.criticalOpenIncidents} critical security incident(s) still open — review on AI Security` }
      : { type: "info", msg: "No critical security incidents open" },
    pm.outputRecords === 0
      ? { type: "info", msg: `No output recorded yet in ${pm.label}` }
      : { type: "info", msg: `${pm.label}: ${fmtQty(pm.outputQty)} ${pm.unit} produced${pm.attainmentRate ? ` (${pm.attainmentRate} of monthly target)` : ""} · order fulfilment ${kpis.orderFulfillmentRate}` },
    kpis.isWeeklyOffToday
      ? { type: "info", msg: "Today is a weekly off for most of the plant — no attendance expected" }
      : attendanceRate === null
        ? { type: "info", msg: "Attendance not yet recorded today" }
        : { type: attendanceRate < 80 ? "warn" : "success", msg: `Today's attendance: ${kpis.attendanceTodayRate} of those due to work (${kpis.attendanceTodayPresent + kpis.attendanceTodayLate} present)` },
  ].filter((i): i is { type: string; msg: string } => i !== null) : [];

  // ── KPI values ────────────────────────────────────────────────────────────

  const hasKpis = kpis !== null && pm !== undefined;
  const pending = dataMessage(loading, dashboardError);

  const production = !hasKpis ? { value: pending, sub: undefined as string | undefined, accent: "#2E7D32" }
    : pm.outputRecords === 0
      ? { value: "No output yet", sub: `Nothing recorded in ${pm.label}`, accent: "#9A8A88" }
      : pm.attainmentRate
        ? { value: pm.attainmentRate, sub: `${fmtQty(pm.outputQty)} of ${fmtQty(pm.monthlyTarget ?? 0)} ${pm.unit} target`, accent: "#2E7D32" }
        : { value: `${fmtQty(pm.outputQty)} ${pm.unit}`, sub: "No monthly target set", accent: "#2E7D32" };

  const workers = !hasKpis ? { value: pending, sub: undefined as string | undefined }
    : kpis.isWeeklyOffToday
      ? { value: "Weekly off", sub: `${kpis.attendanceTodayWeekOff} on weekly off today` }
      : kpis.attendanceTodayRecorded === 0
        ? { value: "Not entered", sub: "Attendance not yet recorded today" }
        : { value: String(kpis.attendanceTodayPresent + kpis.attendanceTodayLate), sub: `of ${kpis.activeEmployees} active · ${kpis.attendanceTodayRate ?? "—"}` };

  return (
    <div className="p-6">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 style={{ fontSize: "1.3rem", fontWeight: 700, color: "#1C1C1C" }}>Operations Dashboard</h1>
          <p style={{ fontSize: "0.8375rem", color: "#7A6C6A" }}>
            DVS Industries ·{" "}
            {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            {loading && <span style={{ color: "#B0A0A0", marginLeft: "0.5rem" }}>Loading…</span>}
          </p>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard label="Active Work Orders" value={hasKpis ? String(kpis.activeWorkOrders) : pending} sub={hasKpis ? `${pm.completedWorkOrders} completed this month${pm.completedShort ? ` · ${pm.completedShort} short of target` : ""}` : undefined} icon={Factory} />
        <KPICard label="Production This Month" value={production.value} sub={production.sub} icon={TrendingUp} accent={production.accent} />
        <KPICard label="Workers Present Today" value={workers.value} sub={workers.sub} icon={Users} accent="#1565C0" />
        <KPICard label="Inventory Value" value={hasKpis ? formatINRCompact(kpis.totalInventoryValue) : dataMessage(loading, dashboardError)} sub={hasKpis ? `${kpis.lowStockCount} low stock` : undefined} icon={Package} accent="#4E342E" />
        <KPICard label="Active Orders" value={hasKpis ? String(kpis.activeClientOrders) : dataMessage(loading, dashboardError)} sub={hasKpis ? `${kpis.pendingClientOrders} pending` : undefined} icon={ShoppingCart} accent="#E65100" />
        <KPICard label="Pending POs" value={hasKpis ? String(kpis.pendingPurchaseOrders) : dataMessage(loading, dashboardError)} icon={Truck} accent="#C0392B" />
        <KPICard label="Open Security Incidents" value={hasKpis ? String(needsAttention) : pending} sub={hasKpis ? `${kpis.criticalOpenIncidents} critical · ${kpis.highOpenIncidents} high${kpis.activeAlerts ? ` · ${kpis.activeAlerts} manual alert(s)` : ""}` : undefined} icon={Shield} accent="#C0392B" />
        <KPICard label="Scrap This Month" value={hasKpis ? `${parseFloat(kpis.totalScrapThisMonth).toFixed(1)} kg` : dataMessage(loading, dashboardError)} icon={AlertTriangle} accent="#E65100" />
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        <Card style={{ gridColumn: "span 2" }}>
          <CardHeader title="Production Output" subtitle="Units produced and rejected per day, last 7 days" />
          <div className="p-4">
            {trend === null ? <p style={{ color: "#7A6C6A", fontSize: "0.8375rem" }}>Loading…</p> : trend.every((t) => t.produced === 0 && t.rejected === 0) ? <p style={{ color: "#7A6C6A", fontSize: "0.8375rem" }}>No production output recorded in the last 7 days.</p> : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F0ECEB" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#9A8A88" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#9A8A88" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ fontSize: "0.8rem" }} />
                  <Bar dataKey="produced" name="Produced" fill="#A52A2A" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="rejected" name="Rejected" fill="#E65100" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        {/* Order status pie */}
        <Card>
          <CardHeader title="Order Status" subtitle="Distribution by status" />
          <div className="p-4 flex flex-col items-center">
            {orderPie.length > 0 ? <ResponsiveContainer width="100%" height={140}>
              <PieChart>
                <Pie data={orderPie} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={40} outerRadius={65} paddingAngle={2}>
                  {orderPie.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                </Pie>
                <Tooltip formatter={(v, n) => [`${v} orders`, n]} contentStyle={{ fontSize: "0.8rem" }} />
              </PieChart>
            </ResponsiveContainer> : <p style={{ color: "#7A6C6A", fontSize: "0.8375rem" }}>{dataMessage(loading, dashboardError)}</p>}
            {orderPie.length > 0 && <div className="grid grid-cols-2 gap-x-4 gap-y-1 w-full mt-2">
              {orderPie.map((o) => (
                <div key={o.name} className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: o.color }} />
                  <span style={{ fontSize: "0.72rem", color: "#7A6C6A" }}>{o.name}: {o.value}</span>
                </div>
              ))}
            </div>}
          </div>
        </Card>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        {/* Attendance trend */}
        <Card>
          <CardHeader title="Attendance Trend" subtitle="Present, last 7 days · gaps are weekly offs or days not yet entered" />
          <div className="p-4">
            {attHasPoints ? <ResponsiveContainer width="100%" height={150}>
              <LineChart data={attTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0ECEB" />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#9A8A88" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#9A8A88" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ fontSize: "0.8rem" }} />
                <Line type="monotone" dataKey="present" stroke="#1565C0" strokeWidth={2} dot={{ r: 3, fill: "#1565C0" }} name="Present" connectNulls={false} />
              </LineChart>
            </ResponsiveContainer> : <p style={{ color: "#7A6C6A", fontSize: "0.8375rem" }}>{charts ? "No attendance recorded in the last 7 days." : dataMessage(loading, dashboardError)}</p>}
          </div>
        </Card>

        {/* Scrap by dept */}
        <Card>
          <CardHeader title="Scrap by Department" subtitle="kg this month" />
          <div className="p-4">
            {scrapTrend.length > 0 ? <ResponsiveContainer width="100%" height={150}>
              <BarChart data={scrapTrend} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#F0ECEB" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: "#9A8A88" }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="dept" tick={{ fontSize: 10, fill: "#9A8A88" }} axisLine={false} tickLine={false} width={55} />
                <Tooltip contentStyle={{ fontSize: "0.8rem" }} />
                <Bar dataKey="scrap" fill="#A52A2A" radius={[0, 3, 3, 0]} name="Scrap (kg)" />
              </BarChart>
            </ResponsiveContainer> : <p style={{ color: "#7A6C6A", fontSize: "0.8375rem" }}>{dataMessage(loading, dashboardError)}</p>}
          </div>
        </Card>

        {/* AI Insights */}
        <Card>
          <CardHeader title="AI Insights" subtitle="Live recommendations" actions={<Zap size={14} color="#A52A2A" />} />
          <div className="p-4 flex flex-col gap-2">
            {aiInsights.length === 0 ? <p style={{ color: "#7A6C6A", fontSize: "0.8375rem" }}>{dataMessage(loading, dashboardError).replace("No data available", "Insights unavailable")}</p> : aiInsights.map((ins, i) => (
              <div key={i} className="flex items-start gap-2 p-2.5 rounded-md"
                style={{
                  background: ins.type === "warn" ? "#FFF8F8" : ins.type === "success" ? "#F0FAF0" : "#F0F4FF",
                  border: `1px solid ${ins.type === "warn" ? "#FFCDD2" : ins.type === "success" ? "#C8E6C9" : "#C5CAE9"}`,
                }}>
                <span style={{ fontSize: "0.875rem", marginTop: "0.05rem" }}>
                  {ins.type === "warn" ? "⚠" : ins.type === "success" ? "✓" : "ℹ"}
                </span>
                <p style={{ fontSize: "0.75rem", color: "#2C2C2C", lineHeight: 1.5 }}>{ins.msg}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Security Alerts */}
        <Card>
          <CardHeader title="Open Security Incidents" subtitle="Most severe first — the same list as AI Security"
            actions={<Btn size="sm" onClick={() => onNavigate("security-incidents")}>View All</Btn>}
          />
          <div>
            {openIncidents.length === 0 ? <p className="p-5" style={{ color: dashboardError ? "#C0392B" : "#7A6C6A", fontSize: "0.8375rem" }}>{charts ? "No open security incidents." : dataMessage(loading, dashboardError)}</p> : openIncidents.map((a) => (
              <div key={a.id} className="flex items-center gap-3 px-5 py-3" style={{ borderBottom: "1px solid #F7F3F2" }}>
                <div className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: a.severity === "critical" ? "#C0392B" : a.severity === "high" ? "#E65100" : a.severity === "medium" ? "#F57F17" : "#2E7D32" }}
                />
                <div className="flex-1 min-w-0">
                  <p style={{ fontSize: "0.8125rem", fontWeight: 500, color: "#1C1C1C" }}>{a.type}</p>
                  <p style={{ fontSize: "0.72rem", color: "#9A8A88" }}>{a.location} · {a.time}</p>
                </div>
                <StatusBadge status={a.status} />
                <StatusBadge status={a.severity} />
              </div>
            ))}
          </div>
        </Card>

        {/* Recent Orders */}
        <Card>
          <CardHeader title="Recent Orders" subtitle="Latest client orders"
            actions={<Btn size="sm" onClick={() => onNavigate("orders-client")}>View All</Btn>}
          />
          <div>
            {recentOrders.length === 0 ? <p className="p-5" style={{ color: dashboardError ? "#C0392B" : "#7A6C6A", fontSize: "0.8375rem" }}>{dataMessage(loading, dashboardError)}</p> : recentOrders.map((o) => (
              <div key={o.id} className="flex items-center gap-3 px-5 py-3" style={{ borderBottom: "1px solid #F7F3F2" }}>
                <div>
                  <p style={{ fontSize: "0.8125rem", fontWeight: 600, color: "#A52A2A" }}>{o.id}</p>
                  <p style={{ fontSize: "0.72rem", color: "#9A8A88" }}>{o.date}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <p style={{ fontSize: "0.8125rem", fontWeight: 500, color: "#1C1C1C" }}>{o.client}</p>
                  <p style={{ fontSize: "0.72rem", color: "#9A8A88" }}>{o.product} · {o.qty} pcs</p>
                </div>
                <StatusBadge status={o.status} label={o.status.replace(/-/g, " ")} />
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="mt-5">
        <Card>
          <div className="px-5 py-4 flex flex-wrap gap-3">
            <p style={{ fontSize: "0.8rem", fontWeight: 600, color: "#7A6C6A", alignSelf: "center", marginRight: "0.5rem", letterSpacing: "0.04em", textTransform: "uppercase" }}>
              Quick Actions:
            </p>
            <Btn onClick={() => onNavigate("orders-client")}><Plus size={14} /> New Client Order</Btn>
            <Btn onClick={() => onNavigate("orders-supplier")}><ShoppingCart size={14} /> Purchase Order</Btn>
            <Btn onClick={() => onNavigate("production-workforce")} variant="secondary"><UserPlus size={14} /> Add Worker</Btn>
            <Btn onClick={() => onNavigate("reports")} variant="secondary"><FileText size={14} /> Generate Report</Btn>
            <Btn onClick={() => onNavigate("security-live")} variant="secondary"><Shield size={14} /> Security Monitor</Btn>
            <Btn onClick={() => onNavigate("inventory-calculator")} variant="secondary"><CheckCircle2 size={14} /> Production Calc</Btn>
          </div>
        </Card>
      </div>
    </div>
  );
}
