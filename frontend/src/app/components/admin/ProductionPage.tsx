import { useEffect, useMemo, useState } from "react";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Download, Plus } from "lucide-react";
import { PageHeader, KPICard, Card, CardHeader, Btn, DataTable, TabBar } from "../shared/UI";
import { WorkforceManagement } from "./WorkforceManagement";
import {
  getProductionKPIs, getProductionTrend, getWorkOrders, type ProductionKPIs,
  type ProductionTrendEntry, type WorkOrderDto,
} from "../../../lib/services/production.service";
import {
  getAttendance, getAttendanceSummary, getAttendanceTrend, type AttendanceDto,
  type WorkforceAttendanceTrendEntry as AttendanceTrendEntry, type DailyAttendanceSummary,
} from "../../../lib/services/workforce.service";

const unavailable = "—";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatTime(value: string | null) {
  if (!value) return unavailable;
  return new Date(value).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function formatDateLabel(value: string) {
  return value;
}

function statusConfig(status: AttendanceDto["status"]) {
  return {
    PRESENT: { bg: "#E8F5E9", color: "#2E7D32", label: "Present" },
    LATE: { bg: "#FFF8E1", color: "#F57F17", label: "Late" },
    LEAVE: { bg: "#E3F2FD", color: "#1565C0", label: "On Leave" },
    HALF_DAY: { bg: "#FFF3E0", color: "#E65100", label: "Half Day" },
    ABSENT: { bg: "#FFEBEE", color: "#C0392B", label: "Absent" },
  }[status];
}

export function ProductionPage() {
  const [tab, setTab] = useState("performance");
  const [kpis, setKpis] = useState<ProductionKPIs | null>(null);
  const [kpisLoading, setKpisLoading] = useState(true);
  const [kpisError, setKpisError] = useState(false);
  const [productionTrend, setProductionTrend] = useState<ProductionTrendEntry[]>([]);
  const [productionTrendLoading, setProductionTrendLoading] = useState(true);
  const [productionTrendError, setProductionTrendError] = useState(false);
  const [workOrders, setWorkOrders] = useState<WorkOrderDto[]>([]);
  const [workOrdersLoading, setWorkOrdersLoading] = useState(true);
  const [workOrdersError, setWorkOrdersError] = useState(false);
  const [attendanceSummary, setAttendanceSummary] = useState<DailyAttendanceSummary | null>(null);
  const [attendanceTrend, setAttendanceTrend] = useState<AttendanceTrendEntry[]>([]);
  const [attendanceLog, setAttendanceLog] = useState<AttendanceDto[]>([]);
  const [attendanceLoading, setAttendanceLoading] = useState(true);
  const [attendanceError, setAttendanceError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      getProductionKPIs(),
      getProductionTrend({ days: 7 }),
      getWorkOrders({ pageSize: 20, status: "all", sortBy: "createdAt", sortOrder: "desc" }),
      getAttendanceSummary({ date: todayIso() }),
      getAttendanceTrend({ days: 7 }),
      getAttendance({ date: todayIso(), pageSize: 100 }),
    ]).then(([kpiRes, prodTrendRes, woRes, summaryRes, attTrendRes, attRes]) => {
      if (cancelled) return;
      if (kpiRes.status === "fulfilled") setKpis(kpiRes.value);
      else setKpisError(true);
      setKpisLoading(false);
      if (prodTrendRes.status === "fulfilled") setProductionTrend(prodTrendRes.value);
      else setProductionTrendError(true);
      setProductionTrendLoading(false);
      if (woRes.status === "fulfilled") setWorkOrders(woRes.value.data);
      else setWorkOrdersError(true);
      setWorkOrdersLoading(false);
      if (summaryRes.status === "fulfilled") setAttendanceSummary(summaryRes.value);
      else setAttendanceError(true);
      if (attTrendRes.status === "fulfilled") setAttendanceTrend(attTrendRes.value);
      else setAttendanceError(true);
      if (attRes.status === "fulfilled") setAttendanceLog(attRes.value.data);
      else setAttendanceError(true);
      setAttendanceLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const productionChartData = useMemo(
    () =>
      productionTrend.map((entry) => ({
        date: formatDateLabel(entry.date),
        produced: entry.produced,
        rejected: entry.rejected,
        scrap: entry.scrap,
      })),
    [productionTrend],
  );

  const attendanceChartData = useMemo(
    () =>
      attendanceTrend.map((entry) => ({
        date: formatDateLabel(entry.date),
        present: entry.present,
        absent: entry.absent,
        late: entry.late,
      })),
    [attendanceTrend],
  );

  const departmentAttendance = attendanceSummary?.byDepartment ?? [];

  return (
    <div className="p-6">
      <PageHeader
        title="Production & Workforce Management"
        subtitle="Monitor output, workforce efficiency, and attendance across all departments"
        actions={
          <div className="flex gap-2">
            <Btn size="sm" onClick={() => setTab("workforce")}><Plus size={14} /> Add Worker</Btn>
          </div>
        }
      />

      <TabBar
        tabs={[
          { id: "performance", label: "Company Performance" },
          { id: "workforce", label: "Workforce Management" },
          { id: "attendance", label: "Attendance" },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="mt-5">
        {tab === "performance" && (
          <div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
              <KPICard label="Active Work Orders" value={kpisLoading ? "Loading..." : kpisError ? unavailable : kpis ? String(kpis.activeWorkOrders) : unavailable} sub={kpis ? `${kpis.completedThisMonth} completed this month` : undefined} />
              <KPICard label="Produced (This Month)" value={kpisLoading ? "Loading..." : kpisError ? unavailable : kpis?.totalProducedQty ?? unavailable} trend={kpis?.overallCompletionRate} trendDir={kpis ? "up" : undefined} accent="#2E7D32" />
              <KPICard label="Completion Rate" value={kpisLoading ? "Loading..." : kpisError ? unavailable : kpis?.overallCompletionRate ?? unavailable} accent="#1565C0" />
              <KPICard label="Rejection Rate" value={kpisLoading ? "Loading..." : kpisError ? unavailable : kpis?.rejectionRate ?? unavailable} sub={kpis ? `${kpis.overdueWorkOrders} overdue WOs` : undefined} accent="#E65100" trendDir={kpis ? "down" : undefined} />
            </div>

            <Card className="mb-5">
              <CardHeader title="Recent Work Orders" subtitle={workOrdersLoading ? "Loading work orders..." : workOrdersError ? "Unable to load work orders" : workOrders.length > 0 ? `${workOrders.length} orders loaded` : "No data available"} />
              <DataTable
                emptyMsg={workOrdersLoading ? "Loading work orders..." : workOrdersError ? "Unable to load work orders." : "No work order data available."}
                columns={[
                  { key: "wo", label: "WO #" },
                  { key: "product", label: "Product" },
                  { key: "dept", label: "Department" },
                  { key: "target", label: "Target" },
                  { key: "produced", label: "Produced" },
                  { key: "rate", label: "Completion" },
                  { key: "priority", label: "Priority" },
                  { key: "status", label: "Status" },
                ]}
                rows={workOrders.map((wo) => ({
                  wo: <span style={{ fontSize: "0.775rem", fontFamily: "JetBrains Mono, monospace", color: "#A52A2A", fontWeight: 600 }}>{wo.workOrderNumber}</span>,
                  product: <span style={{ fontWeight: 500, fontSize: "0.8rem" }}>{wo.product}</span>,
                  dept: <span style={{ fontSize: "0.8rem" }}>{wo.departmentName ?? unavailable}</span>,
                  target: <span style={{ fontSize: "0.8rem" }}>{wo.targetQuantity} {wo.unit}</span>,
                  produced: <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>{wo.producedQty}</span>,
                  rate: <span style={{ fontSize: "0.8rem", fontWeight: 700, color: parseFloat(wo.completionRate) >= 90 ? "#2E7D32" : "#E65100" }}>{wo.completionRate}</span>,
                  priority: <span className="px-2 py-0.5 rounded-full" style={{ fontSize: "0.68rem", fontWeight: 600, background: wo.priority === "URGENT" ? "#FFEBEE" : wo.priority === "HIGH" ? "#FFF3E0" : "#F5F5F5", color: wo.priority === "URGENT" ? "#C0392B" : wo.priority === "HIGH" ? "#E65100" : "#7A6C6A" }}>{wo.priority}</span>,
                  status: <span className="px-2 py-0.5 rounded-full" style={{ fontSize: "0.68rem", fontWeight: 600, background: wo.status === "COMPLETED" ? "#E8F5E9" : wo.status === "IN_PROGRESS" ? "#FFF3E0" : "#F5F5F5", color: wo.status === "COMPLETED" ? "#2E7D32" : wo.status === "IN_PROGRESS" ? "#E65100" : "#7A6C6A" }}>{wo.status.replace("_", " ")}</span>,
                }))}
                paginate={8}
                searchable
              />
            </Card>

            <div className="grid grid-cols-1 gap-5 mb-5">
              <Card>
                <CardHeader title="Weekly Production Trend" subtitle={productionTrendLoading ? "Loading production trend..." : productionTrendError ? "Unable to load production trend" : productionChartData.length > 0 ? "From production trend API" : "No data available"} />
                <div className="p-5">
                  {productionTrendLoading ? (
                    <p style={{ fontSize: "0.8375rem", color: "#7A6C6A" }}>Loading production trend...</p>
                  ) : productionTrendError ? (
                    <p style={{ fontSize: "0.8375rem", color: "#C0392B" }}>Unable to load production trend.</p>
                  ) : productionChartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={200}>
                      <AreaChart data={productionChartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#F0ECEB" />
                        <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#9A8A88" }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 11, fill: "#9A8A88" }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ fontSize: "0.8rem" }} />
                        <Area id="prod-area-produced" type="monotone" dataKey="produced" stroke="#A52A2A" fill="#FDF5F5" strokeWidth={2} name="Produced" />
                        <Area id="prod-area-rejected" type="monotone" dataKey="rejected" stroke="#C0392B" fill="#FFEBEE" strokeWidth={1.5} name="Rejected" />
                        <Area id="prod-area-scrap" type="monotone" dataKey="scrap" stroke="#E65100" fill="#FFF3E0" strokeWidth={1.5} name="Scrap" />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <p style={{ fontSize: "0.8375rem", color: "#7A6C6A" }}>No data available.</p>
                  )}
                </div>
              </Card>

            </div>

          </div>
        )}

        {tab === "workforce" && <WorkforceManagement />}

        {tab === "attendance" && (
          <div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
              <KPICard label="Present Today" value={attendanceLoading ? "Loading..." : attendanceError ? unavailable : attendanceSummary ? String(attendanceSummary.present) : unavailable} trend={attendanceSummary?.attendanceRate} trendDir={attendanceSummary ? "up" : undefined} accent="#2E7D32" />
              <KPICard label="Absent" value={attendanceLoading ? "Loading..." : attendanceError ? unavailable : attendanceSummary ? String(attendanceSummary.absent) : unavailable} accent="#C0392B" />
              <KPICard label="Late Arrival" value={attendanceLoading ? "Loading..." : attendanceError ? unavailable : attendanceSummary ? String(attendanceSummary.late) : unavailable} accent="#E65100" />
              <KPICard label="On Leave" value={attendanceLoading ? "Loading..." : attendanceError ? unavailable : attendanceSummary ? String(attendanceSummary.onLeave) : unavailable} accent="#1565C0" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
              <Card>
                <CardHeader title="Daily Attendance Trend" subtitle={attendanceLoading ? "Loading attendance data..." : attendanceError ? "Unable to load attendance data" : attendanceChartData.length > 0 ? "From attendance trend API" : "No data available"} />
                <div className="p-5">
                  {attendanceLoading ? (
                    <p style={{ fontSize: "0.8375rem", color: "#7A6C6A" }}>Loading attendance data...</p>
                  ) : attendanceError ? (
                    <p style={{ fontSize: "0.8375rem", color: "#C0392B" }}>Unable to load attendance data.</p>
                  ) : attendanceChartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={200}>
                      <AreaChart data={attendanceChartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#F0ECEB" />
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#9A8A88" }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 10, fill: "#9A8A88" }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ fontSize: "0.8rem" }} />
                        <Area id="att-area-present" type="monotone" dataKey="present" stroke="#2E7D32" fill="#E8F5E9" strokeWidth={2} name="Present" />
                        <Area id="att-area-absent" type="monotone" dataKey="absent" stroke="#C0392B" fill="#FFEBEE" strokeWidth={1.5} name="Absent" />
                        <Area id="att-area-late" type="monotone" dataKey="late" stroke="#E65100" fill="#FFF3E0" strokeWidth={1.5} name="Late" />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <p style={{ fontSize: "0.8375rem", color: "#7A6C6A" }}>No data available.</p>
                  )}
                </div>
              </Card>

              <Card>
                <CardHeader title="Department Attendance Rate" subtitle={attendanceLoading ? "Loading attendance data..." : attendanceError ? "Unable to load attendance data" : departmentAttendance.length > 0 ? "From attendance summary API" : "No data available"} />
                <div className="p-5">
                  {attendanceLoading ? <p style={{ fontSize: "0.8375rem", color: "#7A6C6A" }}>Loading attendance data...</p> : attendanceError ? <p style={{ fontSize: "0.8375rem", color: "#C0392B" }}>Unable to load attendance data.</p> : departmentAttendance.length > 0 ? departmentAttendance.map((d) => {
                    const rate = d.total > 0 ? (d.present / d.total) * 100 : 0;
                    return (
                      <div key={d.departmentId} className="mb-3">
                        <div className="flex justify-between mb-1">
                          <span style={{ fontSize: "0.8125rem", color: "#4A4A4A" }}>{d.departmentName}</span>
                          <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: rate >= 97 ? "#2E7D32" : rate >= 94 ? "#E65100" : "#C0392B" }}>
                            {rate.toFixed(1)}%
                          </span>
                        </div>
                        <div style={{ height: "6px", background: "#F0ECEB", borderRadius: "999px", overflow: "hidden" }}>
                          <div style={{ width: `${rate}%`, height: "100%", background: rate >= 97 ? "#2E7D32" : rate >= 94 ? "#E65100" : "#C0392B", borderRadius: "999px" }} />
                        </div>
                      </div>
                    );
                  }) : <p style={{ fontSize: "0.8375rem", color: "#7A6C6A" }}>No data available.</p>}
                </div>
              </Card>
            </div>

            <Card>
              <CardHeader
                title="Today's Attendance Log"
                subtitle={`From attendance API - ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`}
                actions={<Btn variant="secondary" size="sm"><Download size={13} /> Export CSV</Btn>}
              />
              <DataTable
                emptyMsg={attendanceLoading ? "Loading attendance data..." : attendanceError ? "Unable to load attendance data." : "No attendance data available."}
                columns={[
                  { key: "emp", label: "Employee" },
                  { key: "dept", label: "Department" },
                  { key: "status", label: "Status" },
                  { key: "checkIn", label: "Check-In" },
                  { key: "checkOut", label: "Check-Out" },
                  { key: "hours", label: "Hours Worked" },
                  { key: "shift", label: "Shift" },
                ]}
                rows={attendanceLog.map((row) => {
                  const cfg = statusConfig(row.status);
                  return {
                    emp: (
                      <div>
                        <p style={{ fontSize: "0.8375rem", fontWeight: 600 }}>{row.employee.firstName} {row.employee.lastName}</p>
                        <p style={{ fontSize: "0.7rem", color: "#9A8A88", fontFamily: "JetBrains Mono, monospace" }}>{row.employee.employeeCode}</p>
                      </div>
                    ),
                    dept: <span style={{ fontSize: "0.8125rem" }}>{row.employee.department?.name ?? unavailable}</span>,
                    status: <span className="inline-flex items-center px-2 py-0.5 rounded-full" style={{ background: cfg.bg, color: cfg.color, fontSize: "0.72rem", fontWeight: 600 }}>{cfg.label}</span>,
                    checkIn: <span style={{ fontSize: "0.8125rem", fontFamily: "JetBrains Mono, monospace" }}>{formatTime(row.clockIn)}</span>,
                    checkOut: <span style={{ fontSize: "0.8125rem", fontFamily: "JetBrains Mono, monospace" }}>{formatTime(row.clockOut)}</span>,
                    hours: <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: row.workingHours && row.workingHours >= 8 ? "#2E7D32" : row.workingHours ? "#E65100" : "#9A8A88" }}>{row.workingHours !== null ? `${row.workingHours}h` : unavailable}</span>,
                    shift: <span style={{ fontSize: "0.8125rem" }}>{unavailable}</span>,
                  };
                })}
              />
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
