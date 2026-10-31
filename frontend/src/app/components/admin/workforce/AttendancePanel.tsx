import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Edit2, FileSpreadsheet, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Btn, Card, CardHeader, DataTable, EmptyState, ErrorState, KPICard } from "../../shared/UI";
import { describeApiError } from "../../../../lib/api";
import { getStoredBackendRole } from "../../../../lib/auth";
import { getDepartments } from "../../../../lib/services/departments.service";
import {
  deleteAttendance, getAttendance, getAttendanceSummary, getAttendanceTrend, type AttendanceDto, type AttendanceQuery,
  type AttendanceStatus,
} from "../../../../lib/services/workforce.service";
import { useApiData } from "../../../../lib/useApiData";
import {
  ATTENDANCE_STATUSES, apiDay, attendanceStatusInfo, formatDay, fullName,
  localIsoDate, localTime, workforcePermissions,
} from "../../../../lib/workforce";
import { AttendanceDialog } from "./AttendanceDialog";
import { AttendanceImportDialog } from "./AttendanceImportDialog";
import { InlineNotice, LoadingLine, Pager, filterStyle } from "./formControls";
import { DemoTag, isDemoEmployee } from "../production/DemoData";

const PAGE_SIZE = 25;

function shortDay(isoDay: string) {
  const [y, m, d] = isoDay.split("-").map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

export function AttendancePanel() {
  const perms = useMemo(() => workforcePermissions(getStoredBackendRole()), []);
  const today = localIsoDate();
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [departmentId, setDepartmentId] = useState("");
  const [status, setStatus] = useState<AttendanceStatus | "all">("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [trendDays, setTrendDays] = useState(7);
  const [dialog, setDialog] = useState<{ record: AttendanceDto | null } | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const rangeValid = fromDate !== "" && toDate !== "" && fromDate <= toDate;
  const dept = departmentId ? { departmentId: Number(departmentId) } : {};
  const query = (p: number, pageSize: number): AttendanceQuery => ({
    page: p, pageSize, fromDate, toDate, status, sortOrder: "desc", ...dept, ...(search ? { search } : {}),
  });

  const enabled = perms.viewAttendance;
  const departments = useApiData(() => getDepartments(), [], "load departments", enabled);
  const summary = useApiData(() => getAttendanceSummary({ date: toDate, ...dept }), [toDate, departmentId], "load the attendance summary", enabled && toDate !== "");
  const trend = useApiData(() => getAttendanceTrend({ days: trendDays, endDate: toDate, ...dept }), [trendDays, toDate, departmentId], "load the attendance trend", enabled && toDate !== "");
  const list = useApiData(() => getAttendance(query(page, PAGE_SIZE)), [page, fromDate, toDate, departmentId, status, search], "load attendance records", enabled && rangeValid);

  if (!perms.viewAttendance) {
    return (
      <Card>
        <EmptyState
          title="Attendance is restricted for your role"
          subtitle="Attendance records are available to HR, managers and administrators. Ask one of them for the report you need."
        />
      </Card>
    );
  }

  const resetPage = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setPage(1); };

  const handleDelete = async (r: AttendanceDto) => {
    const label = `${fullName(r.employee)} on ${apiDay(r.date)}`;
    if (!confirm(`Delete the attendance record for ${label}? This cannot be undone.`)) return;
    try {
      await deleteAttendance(r.id);
      toast.success(`Attendance for ${label} deleted.`);
      list.reload(); summary.reload(); trend.reload();
    } catch (err) {
      toast.error(describeApiError(err, `delete attendance for ${label}`));
    }
  };

  const s = summary.data;
  const kpi = (n: number | undefined) => (summary.loading ? "…" : summary.error ? "Unavailable" : String(n ?? 0));
  const onDay = `on ${formatDay(toDate)}`;
  const chartData = (trend.data ?? []).map((t) => ({ ...t, label: shortDay(t.date) }));
  const hasTrendData = chartData.some((t) => t.present + t.absent + t.late + t.halfDay + t.onLeave + t.weekOff > 0);
  const records = list.data?.data ?? [];
  const total = list.data?.meta.total ?? 0;
  const filtersActive = departmentId !== "" || status !== "all" || search !== "";

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-3">
        <KPICard label="Present" value={kpi(s?.present)} sub={s ? `${s.attendanceRate} attended · ${onDay}` : onDay} accent="#2E7D32" />
        <KPICard label="Late" value={kpi(s?.late)} sub={s ? `${s.halfDay} half day` : undefined} accent="#E65100" />
        <KPICard label="Absent" value={kpi(s?.absent)} accent="#C0392B" />
        <KPICard label="On Leave" value={kpi(s?.onLeave)} accent="#1565C0" />
        <KPICard label="Week Off" value={kpi(s?.weekOff)} sub="Not counted as working days" accent="#6A1B9A" />
      </div>
      {summary.error && <div className="mb-4"><InlineNotice tone="error" onRetry={summary.reload}>{summary.error}</InlineNotice></div>}
      {s && s.totalEmployees > 0 && (
        <p className="mb-4" style={{ fontSize: "0.75rem", color: "#9A8A88" }}>
          {s.totalEmployees} active employees; {Math.max(0, s.totalEmployees - (s.present + s.late + s.halfDay + s.absent + s.onLeave + s.weekOff))} have no attendance recorded {onDay}.
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        <Card>
          <CardHeader
            title="Daily Attendance Trend"
            subtitle={`Last ${trendDays} days to ${formatDay(toDate)}`}
            actions={
              <select aria-label="Trend length" value={trendDays} onChange={(e) => setTrendDays(Number(e.target.value))} style={filterStyle}>
                {[7, 14, 30].map((d) => <option key={d} value={d}>{d} days</option>)}
              </select>
            }
          />
          <div className="p-5">
            {trend.loading ? <LoadingLine text={trend.waking ? "The server is starting up…" : "Loading attendance trend…"} />
              : trend.error ? <InlineNotice tone="error" onRetry={trend.reload}>{trend.error}</InlineNotice>
                : !hasTrendData ? <p style={{ fontSize: "0.8375rem", color: "#7A6C6A" }}>No attendance has been recorded in this period.</p>
                  : (
                    <ResponsiveContainer width="100%" height={220}>
                      <AreaChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#F0ECEB" />
                        <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9A8A88" }} axisLine={false} tickLine={false} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#9A8A88" }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ fontSize: "0.8rem" }} />
                        <Legend wrapperStyle={{ fontSize: "0.72rem" }} />
                        <Area id="att-area-present" type="monotone" dataKey="present" stroke="#2E7D32" fill="#E8F5E9" strokeWidth={2} name="Present" />
                        <Area id="att-area-late" type="monotone" dataKey="late" stroke="#E65100" fill="#FFF3E0" strokeWidth={1.5} name="Late" />
                        <Area id="att-area-absent" type="monotone" dataKey="absent" stroke="#C0392B" fill="#FFEBEE" strokeWidth={1.5} name="Absent" />
                        <Area id="att-area-leave" type="monotone" dataKey="onLeave" stroke="#1565C0" fill="#E3F2FD" strokeWidth={1.5} name="On Leave" />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Department Attendance Rate" subtitle={`Present, late or half day, of working headcount ${onDay}`} />
          <div className="p-5">
            {summary.loading ? <LoadingLine text="Loading department rates…" />
              : summary.error ? <InlineNotice tone="error" onRetry={summary.reload}>{summary.error}</InlineNotice>
                : !s || s.byDepartment.length === 0 ? <p style={{ fontSize: "0.8375rem", color: "#7A6C6A" }}>No active employees are assigned to departments yet.</p>
                  : s.byDepartment.map((d) => {
                    const working = d.total - d.weekOff;
                    const rate = working > 0 ? (d.attended / working) * 100 : null;
                    const color = rate === null ? "#9A8A88" : rate >= 97 ? "#2E7D32" : rate >= 94 ? "#E65100" : "#C0392B";
                    return (
                      <div key={d.departmentId} className="mb-3">
                        <div className="flex justify-between mb-1">
                          <span style={{ fontSize: "0.8125rem", color: "#4A4A4A" }}>{d.departmentName} <span style={{ color: "#9A8A88" }}>({d.attended}/{working})</span></span>
                          <span style={{ fontSize: "0.8125rem", fontWeight: 600, color }}>{rate === null ? "N/A" : `${rate.toFixed(1)}%`}</span>
                        </div>
                        <div style={{ height: "6px", background: "#F0ECEB", borderRadius: "999px", overflow: "hidden" }}>
                          <div style={{ width: `${rate ?? 0}%`, height: "100%", background: color, borderRadius: "999px" }} />
                        </div>
                      </div>
                    );
                  })}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Attendance Records"
          subtitle={list.loading ? "Loading…" : rangeValid ? `${total} record${total === 1 ? "" : "s"} · ${fromDate === toDate ? formatDay(fromDate) : `${formatDay(fromDate)} to ${formatDay(toDate)}`}` : undefined}
          actions={
            <div className="flex gap-2">
              {perms.editAttendance && (
                <Btn variant="secondary" size="sm" onClick={() => setImporting(true)}>
                  <FileSpreadsheet size={13} /> Upload Excel
                </Btn>
              )}
              {perms.editAttendance && <Btn size="sm" onClick={() => setDialog({ record: null })}><Plus size={13} /> Record Attendance</Btn>}
            </div>
          }
        />
        <div className="flex flex-wrap items-end gap-3 px-5 py-3" style={{ borderBottom: "1px solid #F0ECEB" }}>
          <label style={{ fontSize: "0.72rem", color: "#4A4A4A", fontWeight: 600 }}>From
            <input type="date" value={fromDate} max={today} onChange={(e) => resetPage(setFromDate)(e.target.value)} style={{ ...filterStyle, display: "block", marginTop: 2 }} />
          </label>
          <label style={{ fontSize: "0.72rem", color: "#4A4A4A", fontWeight: 600 }}>To
            <input type="date" value={toDate} max={today} onChange={(e) => resetPage(setToDate)(e.target.value)} style={{ ...filterStyle, display: "block", marginTop: 2 }} />
          </label>
          <select aria-label="Filter by department" value={departmentId} onChange={(e) => resetPage(setDepartmentId)(e.target.value)} style={filterStyle}>
            <option value="">All departments</option>
            {(departments.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select aria-label="Filter by status" value={status} onChange={(e) => resetPage(setStatus)(e.target.value as AttendanceStatus | "all")} style={filterStyle}>
            <option value="all">All statuses</option>
            {ATTENDANCE_STATUSES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
          </select>
          <div className="flex items-center gap-2 flex-1 min-w-[12rem] px-3 rounded-md" style={{ border: "1px solid #E8E2E0", height: "2.25rem" }}>
            <Search size={13} color="#9A8A88" />
            <input aria-label="Search by employee ID or name" placeholder="Employee ID or name…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
              style={{ border: "none", outline: "none", fontSize: "0.8rem", flex: 1, background: "transparent" }} />
          </div>
        </div>
        {!rangeValid ? (
          <div className="p-5"><InlineNotice tone="warning">Choose a "From" date that is on or before the "To" date.</InlineNotice></div>
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : list.loading ? (
          <div className="px-5 py-10 text-center" role="status" style={{ fontSize: "0.8375rem", color: "#7A6C6A" }}>
            {list.waking ? "The server is starting up after being idle. This can take up to a minute…" : "Loading attendance records…"}
          </div>
        ) : records.length === 0 ? (
          <EmptyState
            title="No attendance records found"
            subtitle={filtersActive ? "No records match these filters. Change or clear them to see more." : "No attendance has been recorded for this period yet."}
          />
        ) : (
          <>
            <DataTable
              columns={[
                { key: "date", label: "Date" },
                { key: "emp", label: "Employee" },
                { key: "dept", label: "Department" },
                { key: "shift", label: "Shift" },
                { key: "status", label: "Status" },
                { key: "in", label: "Check-In" },
                { key: "out", label: "Check-Out" },
                { key: "hours", label: "Hours" },
                { key: "remarks", label: "Remarks" },
                ...(perms.editAttendance ? [{ key: "actions", label: "Actions" }] : []),
              ]}
              rows={records.map((r) => {
                const cfg = attendanceStatusInfo(r.status);
                const muted = <span style={{ color: "#B0A3A1" }}>—</span>;
                return {
                  date: <span style={{ fontSize: "0.8rem", whiteSpace: "nowrap" }}>{formatDay(apiDay(r.date))}</span>,
                  emp: (
                    <div>
                      <p style={{ fontSize: "0.8375rem", fontWeight: 600 }}>{fullName(r.employee)}</p>
                      <p style={{ fontSize: "0.7rem", color: "#9A8A88", fontFamily: "JetBrains Mono, monospace" }}>{r.employee.employeeCode}{isDemoEmployee(r.employee.employeeCode) && <DemoTag />}</p>
                    </div>
                  ),
                  dept: r.employee.department?.name ?? <span style={{ color: "#9A8A88" }}>Unassigned</span>,
                  shift: r.employee.shift?.name ?? <span style={{ color: "#9A8A88" }}>Unassigned</span>,
                  status: <span className="inline-flex items-center px-2 py-0.5 rounded-full" style={{ background: cfg.bg, color: cfg.color, fontSize: "0.72rem", fontWeight: 600 }}>{cfg.label}</span>,
                  in: r.clockIn ? <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.8rem" }}>{localTime(r.clockIn)}</span> : muted,
                  out: r.clockOut ? <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.8rem" }}>{localTime(r.clockOut)}</span> : muted,
                  hours: r.workingHours !== null ? <span style={{ fontWeight: 600, color: r.workingHours >= 8 ? "#2E7D32" : "#E65100" }}>{r.workingHours} h</span> : muted,
                  remarks: r.remarks ? <span style={{ fontSize: "0.78rem", color: "#4A4A4A" }}>{r.remarks}</span> : muted,
                  actions: (
                    <div className="flex gap-1.5">
                      <button type="button" aria-label={`Edit attendance for ${fullName(r.employee)}`} title="Edit" onClick={() => setDialog({ record: r })} className="p-1.5 rounded" style={{ background: "#F5F0EF", color: "#4E342E", border: "none", cursor: "pointer" }}>
                        <Edit2 size={12} />
                      </button>
                      {perms.deleteAttendance && (
                        <button type="button" aria-label={`Delete attendance for ${fullName(r.employee)}`} title="Delete" onClick={() => void handleDelete(r)} className="p-1.5 rounded" style={{ background: "#FFEBEE", color: "#C0392B", border: "none", cursor: "pointer" }}>
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  ),
                };
              })}
            />
            <Pager page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
          </>
        )}
      </Card>

      {dialog && (
        <AttendanceDialog
          key={dialog.record?.id ?? "new"}
          record={dialog.record}
          defaultDate={toDate}
          onClose={() => setDialog(null)}
          onOpenExisting={(record) => setDialog({ record })}
          onSaved={(message) => { toast.success(message); setDialog(null); list.reload(); summary.reload(); trend.reload(); }}
        />
      )}

      {importing && (
        <AttendanceImportDialog
          defaultDate={toDate || today}
          onClose={() => setImporting(false)}
          onImported={(message, day) => {
            toast.success(message);
            // Show the imported day, read back from the database
            if (day !== fromDate || day !== toDate) { setFromDate(day); setToDate(day); setPage(1); }
            else { list.reload(); summary.reload(); trend.reload(); }
          }}
        />
      )}
    </div>
  );
}
