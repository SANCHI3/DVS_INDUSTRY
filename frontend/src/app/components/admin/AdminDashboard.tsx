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
import { getAlerts, type SecurityAlertDto } from "../../../lib/services/security.service";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 10_00_000) return `₹${(n / 10_00_000).toFixed(1)}L`;
  if (n >= 1_000)     return `₹${(n / 1_000).toFixed(1)}K`;
  return `₹${n}`;
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function dataMessage(loading: boolean, failed: boolean): string {
  if (loading) return "Loading…";
  if (failed) return "Unavailable";
  return "No data available";
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AdminDashboard({ onNavigate }: { onNavigate: (s: string) => void }) {
  const [period, setPeriod] = useState<"today" | "week" | "month">("today");
  const [kpis,    setKpis]   = useState<DashboardKPIs | null>(null);
  const [charts,  setCharts] = useState<DashboardCharts | null>(null);
  const [alerts,  setAlerts] = useState<SecurityAlertDto[] | null>(null);
  const [dashboardError, setDashboardError] = useState(false);
  const [alertsError, setAlertsError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.allSettled([
      getDashboard(),
      getAlerts({ status: "ACTIVE", pageSize: 5, sortBy: "severity", sortOrder: "desc" }),
    ]).then(([dashResult, alertResult]) => {
      if (cancelled) return;
      if (dashResult.status === "fulfilled") {
        setKpis(dashResult.value.kpis);
        setCharts(dashResult.value.charts);
      } else {
        setDashboardError(true);
      }
      if (alertResult.status === "fulfilled") {
        setAlerts(alertResult.value.data);
      } else {
        setAlertsError(true);
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
    date: o.date,
  })) ?? [];

  const liveAlerts = alerts?.slice(0, 4).map(a => ({
    id: a.alertNumber,
    type: a.type.replace(/_/g, " ").toLowerCase().replace(/^\w/, c => c.toUpperCase()),
    location: a.location ?? "—",
    severity: a.severity.toLowerCase(),
    status: a.status.toLowerCase(),
    time: fmtTime(a.createdAt),
  })) ?? [];

  // AI insights derived from KPIs
  const aiInsights = kpis ? [
    kpis.lowStockCount > 0
      ? { type: "warn", msg: `${kpis.lowStockCount} material(s) below minimum stock level — check inventory` }
      : { type: "success", msg: "All inventory levels within safe thresholds" },
    kpis.overdueWorkOrders > 0
      ? { type: "warn", msg: `${kpis.overdueWorkOrders} work order(s) past scheduled end — review production` }
      : { type: "success", msg: "All work orders on schedule" },
    kpis.criticalAlerts > 0
      ? { type: "warn", msg: `${kpis.criticalAlerts} critical security alert(s) active — immediate attention required` }
      : { type: "info", msg: "No critical security alerts active" },
    { type: "info", msg: `Order fulfillment rate: ${kpis.orderFulfillmentRate} · Production: ${kpis.productionCompletionRate}` },
    kpis.attendanceTodayRate
      ? { type: kpis.attendanceTodayPresent < kpis.activeEmployees * 0.8 ? "warn" : "success", msg: `Today's attendance rate: ${kpis.attendanceTodayRate} (${kpis.attendanceTodayPresent} present)` }
      : { type: "info", msg: "Attendance data not yet recorded today" },
  ] : [];

  // ── KPI values (real or fallback) ──────────────────────────────────────────

  const hasKpis = kpis !== null;
  const activeAlertCnt = kpis === null ? dataMessage(loading, dashboardError) : String(kpis.activeAlerts);

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
        <div className="flex gap-2">
          {(["today", "week", "month"] as const).map((p) => (
            <button key={p} disabled title="The existing dashboard API returns current aggregate data only" onClick={() => setPeriod(p)}
              style={{
                padding: "0.375rem 0.875rem", borderRadius: "0.375rem",
                fontSize: "0.775rem", fontWeight: 500, cursor: "pointer", textTransform: "capitalize",
                background: period === p ? "#A52A2A" : "#fff",
                color:      period === p ? "#fff"    : "#4A4A4A",
                border: `1px solid ${period === p ? "#A52A2A" : "#E8E2E0"}`,
                opacity: 0.65,
              }}
            >
              {p === "today" ? "Today" : p === "week" ? "This Week" : "This Month"}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard label="Active Work Orders" value={hasKpis ? String(kpis.activeWorkOrders) : dataMessage(loading, dashboardError)} sub={hasKpis ? `Completion: ${kpis.productionCompletionRate}` : undefined} icon={Factory} />
        <KPICard label="Production Rate" value={hasKpis ? kpis.productionCompletionRate : dataMessage(loading, dashboardError)} icon={TrendingUp} accent="#2E7D32" />
        <KPICard label="Workers Present" value={hasKpis ? String(kpis.attendanceTodayPresent) : dataMessage(loading, dashboardError)} sub={hasKpis ? `of ${kpis.activeEmployees} active` : undefined} icon={Users} accent="#1565C0" />
        <KPICard label="Inventory Value" value={hasKpis ? fmt(parseFloat(kpis.totalInventoryValue)) : dataMessage(loading, dashboardError)} sub={hasKpis ? `${kpis.lowStockCount} low stock` : undefined} icon={Package} accent="#4E342E" />
        <KPICard label="Active Orders" value={hasKpis ? String(kpis.activeClientOrders) : dataMessage(loading, dashboardError)} sub={hasKpis ? `${kpis.pendingClientOrders} pending` : undefined} icon={ShoppingCart} accent="#E65100" />
        <KPICard label="Pending POs" value={hasKpis ? String(kpis.pendingPurchaseOrders) : dataMessage(loading, dashboardError)} icon={Truck} accent="#C0392B" />
        <KPICard label="Security Alerts" value={activeAlertCnt} sub={hasKpis ? `${kpis.criticalAlerts} critical · ${kpis.criticalIncidents} open critical incidents` : undefined} icon={Shield} accent="#C0392B" />
        <KPICard label="Scrap This Month" value={hasKpis ? `${parseFloat(kpis.totalScrapThisMonth).toFixed(1)} kg` : dataMessage(loading, dashboardError)} icon={AlertTriangle} accent="#E65100" />
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        {/* Production trend — use scrap trend as proxy for real data until prod trend endpoint added */}
        <Card style={{ gridColumn: "span 2" }}>
          <CardHeader title="Production vs Target" subtitle="Expected vs Actual units produced" />
          <div className="p-5"><p style={{ color: "#7A6C6A", fontSize: "0.8375rem" }}>Production target data is unavailable from the existing dashboard APIs.</p></div>
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
          <CardHeader title="Attendance Trend" subtitle="Present count (last 7 days)" />
          <div className="p-4">
            {attTrend.length > 0 ? <ResponsiveContainer width="100%" height={150}>
              <LineChart data={attTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0ECEB" />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#9A8A88" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#9A8A88" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ fontSize: "0.8rem" }} />
                <Line type="monotone" dataKey="present" stroke="#1565C0" strokeWidth={2} dot={{ r: 3, fill: "#1565C0" }} name="Present" />
              </LineChart>
            </ResponsiveContainer> : <p style={{ color: "#7A6C6A", fontSize: "0.8375rem" }}>{dataMessage(loading, dashboardError)}</p>}
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
          <CardHeader title="Security Alerts" subtitle="Active incidents"
            actions={<Btn size="sm" onClick={() => onNavigate("security-live")}>View All</Btn>}
          />
          <div>
            {liveAlerts.length === 0 ? <p className="p-5" style={{ color: alertsError ? "#C0392B" : "#7A6C6A", fontSize: "0.8375rem" }}>{dataMessage(loading, alertsError)}</p> : liveAlerts.map((a) => (
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
