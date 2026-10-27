import { useEffect, useMemo, useState } from "react";
import { Download, Edit2, Eye, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card, DataTable, EmptyState, ErrorState, StatusBadge, Btn } from "../shared/UI";
import { describeApiError, fetchAllPages, withServerWake } from "../../../lib/api";
import { getStoredBackendRole } from "../../../lib/auth";
import { downloadCSV } from "../../../lib/csv";
import { getEmployees, type EmployeeDto, type EmployeeQuery } from "../../../lib/services/employees.service";
import { getDepartments } from "../../../lib/services/departments.service";
import {
  getAttendance, getEmployeeOutputs, getShifts, type AttendanceDto, type EmployeeOutputDto,
} from "../../../lib/services/workforce.service";
import { useApiData } from "../../../lib/useApiData";
import {
  attendanceStatusInfo, efficiencyColor, employeeStatusLabel, exportFilename, formatDay,
  formatEfficiency, fullName, localIsoDate, workforceCsvRows, workforcePermissions,
} from "../../../lib/workforce";
import { EmployeeDialog, type EmployeeDialogMode } from "./workforce/EmployeeDialog";
import { RemoveWorkerDialog } from "./workforce/RemoveWorkerDialog";
import { InlineNotice, Pager, filterStyle } from "./workforce/formControls";

const PAGE_SIZE = 25;

const STATUS_FILTERS = [
  { value: "all", label: "All statuses" },
  { value: "ACTIVE", label: "Active" },
  { value: "ON_LEAVE", label: "On leave" },
  { value: "INACTIVE", label: "Inactive" },
  { value: "TERMINATED", label: "Terminated" },
] as const;

const STATUS_BADGE: Record<EmployeeDto["status"], string> = {
  ACTIVE: "active", ON_LEAVE: "pending", INACTIVE: "neutral", TERMINATED: "critical",
};

function NotRecorded() {
  return <span title="Not recorded for this date" aria-label="Not recorded" style={{ color: "#B0A3A1" }}>—</span>;
}

function formatQty(n: number | null | undefined) {
  return n == null ? <NotRecorded /> : n.toLocaleString("en-IN", { maximumFractionDigits: 3 });
}

function byEmployee<T extends { employeeId: number }>(rows: T[] | null): Map<number, T> {
  return new Map((rows ?? []).map((r) => [r.employeeId, r]));
}

/** `addRequest` > 0 opens the Add dialog (from the page header); `onAddHandled` clears it. */
export function WorkforceManagement({ addRequest = 0, onAddHandled }: { addRequest?: number; onAddHandled?: () => void }) {
  const perms = useMemo(() => workforcePermissions(getStoredBackendRole()), []);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [date, setDate] = useState(localIsoDate());
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<{ mode: EmployeeDialogMode; employee: EmployeeDto | null } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [removing, setRemoving] = useState<EmployeeDto | null>(null);

  // Search as the user types, without a request per keystroke
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    if (addRequest === 0) return;
    if (perms.editEmployees) setDialog({ mode: "add", employee: null });
    onAddHandled?.();
  }, [addRequest, perms.editEmployees, onAddHandled]);

  const query = (p: number, pageSize: number): EmployeeQuery => ({
    page: p, pageSize, status, sortBy: "employeeCode", sortOrder: "asc",
    ...(search ? { search } : {}),
  });

  // Departments and shifts feed the Add/Edit form
  const departments = useApiData(() => getDepartments(), [], "load departments");
  const shifts = useApiData(() => getShifts({ pageSize: 100 }).then((r) => r.data), [], "load shifts");
  const employees = useApiData(() => getEmployees(query(page, PAGE_SIZE)), [page, search, status], "load employees");
  const outputs = useApiData(
    () => fetchAllPages((p) => getEmployeeOutputs({ date, page: p, pageSize: 100 })),
    [date], "load daily performance",
  );
  const attendance = useApiData(
    () => fetchAllPages((p) => getAttendance({ date, page: p, pageSize: 100 })),
    [date], "load attendance", perms.viewAttendance,
  );

  const outputByEmployee = useMemo(() => byEmployee<EmployeeOutputDto>(outputs.data), [outputs.data]);
  const attendanceByEmployee = useMemo(() => byEmployee<AttendanceDto>(attendance.data), [attendance.data]);

  const reloadAll = () => {
    employees.reload(); outputs.reload(); departments.reload(); shifts.reload();
    if (perms.viewAttendance) attendance.reload();
  };

  const resetPage = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setPage(1); };

  const handleExport = async () => {
    setExporting(true);
    try {
      const [allEmployees, dayOutputs, dayAttendance] = await withServerWake(() => Promise.all([
        fetchAllPages((p) => getEmployees(query(p, 100))),
        outputs.data ?? fetchAllPages((p) => getEmployeeOutputs({ date, page: p, pageSize: 100 })),
        perms.viewAttendance ? (attendance.data ?? fetchAllPages((p) => getAttendance({ date, page: p, pageSize: 100 }))) : Promise.resolve([]),
      ]));
      if (allEmployees.length === 0) {
        toast.info("No employees match the current filters, so there is nothing to export.");
        return;
      }
      const outMap = byEmployee(dayOutputs);
      const attMap = byEmployee(dayAttendance);
      const rows = allEmployees.map((employee) => ({
        employee, output: outMap.get(employee.id) ?? null, attendance: attMap.get(employee.id) ?? null,
      }));
      downloadCSV(
        exportFilename("Workforce", date),
        workforceCsvRows(rows, { date, includePay: perms.viewPay, includeAttendance: perms.viewAttendance }),
      );
      toast.success(`Exported ${rows.length} employee${rows.length === 1 ? "" : "s"}.`);
    } catch (err) {
      toast.error(describeApiError(err, "export workforce data"));
    } finally {
      setExporting(false);
    }
  };

  const list = employees.data?.data ?? [];
  const total = employees.data?.meta.total ?? 0;
  const filtersActive = search !== "" || status !== "all";

  const columns = [
    { key: "employee", label: "Employee" },
    // Next to the name, so Edit and Remove are on screen without scrolling on a phone
    { key: "actions", label: "Actions" },
    { key: "dept", label: "Department" },
    { key: "shift", label: "Shift" },
    { key: "status", label: "Status" },
    ...(perms.viewAttendance ? [{ key: "attendance", label: "Attendance" }] : []),
    { key: "hours", label: "Hours" },
    { key: "expected", label: "Expected" },
    { key: "produced", label: "Produced" },
    { key: "efficiency", label: "Efficiency" },
    { key: "ops", label: "Ops" },
    ...(perms.viewPay ? [{ key: "wage", label: "Daily Wage" }] : []),
  ];

  const perfUnavailable = outputs.error !== null;
  const rows = list.map((e) => {
    const o = outputByEmployee.get(e.id);
    const a = attendanceByEmployee.get(e.id);
    // The API's figure is authoritative (same rule as the form preview)
    const eff = o?.efficiency ?? null;
    const perfCell = (value: number | null | undefined) =>
      perfUnavailable ? <span style={{ color: "#C0392B", fontSize: "0.75rem" }}>Unavailable</span> : outputs.loading ? "…" : formatQty(value);
    return {
      employee: (
        <div>
          <p style={{ fontWeight: 600, fontSize: "0.8375rem" }}>{fullName(e)}</p>
          <p style={{ fontSize: "0.72rem", color: "#9A8A88" }}>
            <span style={{ fontFamily: "JetBrains Mono, monospace", color: "#A52A2A" }}>{e.employeeCode}</span> · {e.designation}
          </p>
        </div>
      ),
      dept: e.department?.name ?? <span style={{ color: "#9A8A88" }}>Unassigned</span>,
      shift: e.shift?.name ?? <span style={{ color: "#9A8A88" }}>Unassigned</span>,
      status: <StatusBadge status={STATUS_BADGE[e.status]} label={employeeStatusLabel(e.status)} />,
      attendance: attendance.error ? <span style={{ color: "#C0392B", fontSize: "0.75rem" }}>Unavailable</span>
        : attendance.loading ? "…"
          : a ? (() => { const s = attendanceStatusInfo(a.status); return <span className="px-2 py-0.5 rounded-full" style={{ fontSize: "0.7rem", fontWeight: 600, background: s.bg, color: s.color }}>{s.label}</span>; })()
            : <span style={{ fontSize: "0.75rem", color: "#9A8A88" }}>Not recorded</span>,
      hours: perfUnavailable || outputs.loading || o?.workingHours == null ? perfCell(o?.workingHours) : `${o.workingHours} h`,
      expected: perfCell(o?.expectedParts),
      produced: perfCell(o?.producedParts),
      efficiency: perfUnavailable || outputs.loading || !o ? perfCell(null)
        : <span style={{ fontWeight: 700, color: efficiencyColor(eff) }} title={eff === null ? "Expected parts missing or 0" : undefined}>{formatEfficiency(eff)}</span>,
      ops: perfCell(o?.operationsCount),
      wage: e.dailyWageRate ? `₹${Number(e.dailyWageRate).toLocaleString("en-IN", { minimumFractionDigits: 2 })}` : <span style={{ color: "#9A8A88" }}>Not set</span>,
      actions: (
        <div className="flex gap-1.5">
          <button type="button" aria-label={`View ${fullName(e)}`} title="View employee" onClick={() => setDialog({ mode: "view", employee: e })} className="p-2 rounded" style={{ background: "#F5F0EF", color: "#4E342E", border: "none", cursor: "pointer" }}>
            <Eye size={14} />
          </button>
          {(perms.editEmployees || perms.editPerformance) && (
            <button type="button" aria-label={`Edit ${fullName(e)}`} title={perms.editEmployees ? "Edit employee" : "Record performance"} onClick={() => setDialog({ mode: "edit", employee: e })} className="p-2 rounded" style={{ background: "#F5F0EF", color: "#4E342E", border: "none", cursor: "pointer" }}>
              <Edit2 size={14} />
            </button>
          )}
          {perms.deleteEmployees && (
            <button type="button" aria-label={`Remove ${fullName(e)} (${e.employeeCode})`} title="Remove worker (administrators only)" onClick={() => setRemoving(e)} className="p-2 rounded" style={{ background: "#FFEBEE", color: "#C0392B", border: "none", cursor: "pointer" }}>
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ),
    };
  });

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="flex items-center gap-2 flex-1 min-w-[14rem] px-3 rounded-md" style={{ background: "#fff", border: "1px solid #E8E2E0", height: "2.25rem" }}>
          <Search size={14} color="#9A8A88" />
          <input aria-label="Search employees by ID or name" placeholder="Search by employee ID or name…" value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ border: "none", outline: "none", fontSize: "0.8375rem", flex: 1, background: "transparent" }} />
        </div>
        <select aria-label="Filter by employment status" value={status} onChange={(e) => resetPage(setStatus)(e.target.value)} style={filterStyle}>
          {STATUS_FILTERS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <label className="flex items-center gap-2" style={{ fontSize: "0.775rem", color: "#4A4A4A", fontWeight: 600 }}>
          Day
          <input type="date" aria-label="Performance and attendance date" value={date} max={localIsoDate()} onChange={(e) => e.target.value && setDate(e.target.value)} style={filterStyle} />
        </label>
        <Btn size="sm" variant="secondary" onClick={() => void handleExport()} disabled={exporting || employees.loading}>
          <Download size={14} /> {exporting ? "Exporting…" : "Export CSV"}
        </Btn>
        {perms.editEmployees && <Btn size="sm" onClick={() => setDialog({ mode: "add", employee: null })}><Plus size={14} /> Add Employee</Btn>}
      </div>

      {(departments.error || shifts.error) && (
        <div className="mb-3"><InlineNotice tone="warning" onRetry={() => { departments.reload(); shifts.reload(); }}>{departments.error ?? shifts.error}</InlineNotice></div>
      )}
      {outputs.error && <div className="mb-3"><InlineNotice tone="error" onRetry={outputs.reload}>{outputs.error}</InlineNotice></div>}
      {attendance.error && <div className="mb-3"><InlineNotice tone="error" onRetry={attendance.reload}>{attendance.error}</InlineNotice></div>}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3" style={{ borderBottom: "1px solid #F0ECEB" }}>
          <p style={{ fontSize: "0.8125rem", color: "#4A4A4A" }}>
            <strong>{employees.loading ? "Loading…" : `${total} employee${total === 1 ? "" : "s"}`}</strong>
            {filtersActive && !employees.loading && " match the filters"}
          </p>
          <p style={{ fontSize: "0.75rem", color: "#7A6C6A" }}>
            Performance{perms.viewAttendance ? " and attendance" : ""} for <strong>{formatDay(date)}</strong> · — = not recorded
          </p>
        </div>
        {employees.error ? (
          <ErrorState message={employees.waking ? "The server is starting up…" : employees.error} onRetry={employees.reload} />
        ) : employees.loading ? (
          <div className="px-5 py-10 text-center" style={{ fontSize: "0.8375rem", color: "#7A6C6A" }} role="status">
            {employees.waking ? "The server is starting up after being idle. This can take up to a minute…" : "Loading employees…"}
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            title={filtersActive ? "No employees match these filters" : "No employees yet"}
            subtitle={filtersActive ? "Change or clear the filters to see more." : perms.editEmployees ? "Add your first employee to start tracking performance and attendance." : "Employees added by HR will appear here."}
            action={!filtersActive && perms.editEmployees ? <Btn size="sm" onClick={() => setDialog({ mode: "add", employee: null })}><Plus size={14} /> Add Employee</Btn> : undefined}
          />
        ) : (
          <>
            <DataTable columns={columns} rows={rows} />
            <Pager page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
          </>
        )}
      </Card>

      {removing && (
        <RemoveWorkerDialog
          key={removing.id}
          employee={removing}
          onCancel={() => setRemoving(null)}
          onStale={reloadAll}
          onRemoved={(message) => { toast.success(message); setRemoving(null); reloadAll(); }}
        />
      )}

      {dialog && (
        <EmployeeDialog
          key={`${dialog.mode}-${dialog.employee?.id ?? "new"}`}
          mode={dialog.mode}
          employee={dialog.employee}
          initialDate={date}
          departments={departments.data ?? []}
          shifts={shifts.data ?? []}
          perms={perms}
          onClose={() => setDialog(null)}
          onChanged={reloadAll}
          onSaved={(message) => { toast.success(message); setDialog(null); reloadAll(); }}
          onEdit={() => setDialog((d) => (d ? { ...d, mode: "edit" } : d))}
        />
      )}
    </div>
  );
}
