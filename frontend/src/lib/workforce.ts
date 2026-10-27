/**
 * Production & Workforce helpers shared by the Workforce and Attendance tabs:
 * role permissions (mirroring the backend), efficiency, labels, dates, CSV
 * rows and form validation. No React, so it is unit-tested directly.
 */

import type { CsvCell } from "./csv";
import type { EmployeeDto, EmployeeStatus } from "./services/employees.service";
import type { AttendanceDto, AttendanceStatus, EmployeeOutputDto } from "./services/workforce.service";

// ── Permissions (the backend enforces these; the UI only hides what would fail) ─

export interface WorkforcePermissions {
  editEmployees: boolean;    // create/update employees, assign department/shift
  deleteEmployees: boolean;
  viewPay: boolean;          // salary and daily wage rate
  createLookups: boolean;    // new departments and shifts
  viewAttendance: boolean;
  editAttendance: boolean;
  deleteAttendance: boolean;
  editPerformance: boolean;  // per-employee daily output
}

export function workforcePermissions(backendRole: string | null): WorkforcePermissions {
  const role = (backendRole ?? "").toUpperCase();
  const is = (...roles: string[]) => roles.includes(role);
  return {
    editEmployees: is("ADMIN", "HR"),
    deleteEmployees: is("ADMIN"),
    viewPay: is("ADMIN", "HR"),
    createLookups: is("ADMIN", "HR"),
    viewAttendance: is("ADMIN", "MANAGER", "HR"),
    editAttendance: is("ADMIN", "HR"),
    deleteAttendance: is("ADMIN"),
    editPerformance: is("ADMIN", "HR", "PRODUCTION"),
  };
}

export interface ProductionPermissions {
  editTargets: boolean;        // company-wide monthly target and KPI thresholds
  deleteTargets: boolean;
  createWorkOrders: boolean;
  editWorkOrders: boolean;
  deleteWorkOrders: boolean;
  recordOutput: boolean;
  changeWorkOrderStatus: boolean;
}

/** Mirrors backend/src/routes/production.routes.ts. */
export function productionPermissions(backendRole: string | null): ProductionPermissions {
  const role = (backendRole ?? "").toUpperCase();
  const is = (...roles: string[]) => roles.includes(role);
  return {
    editTargets: is("ADMIN", "MANAGER"),
    deleteTargets: is("ADMIN"),
    createWorkOrders: is("ADMIN", "PRODUCTION"),
    editWorkOrders: is("ADMIN", "PRODUCTION"),
    deleteWorkOrders: is("ADMIN"),
    recordOutput: is("ADMIN", "PRODUCTION"),
    changeWorkOrderStatus: is("ADMIN", "MANAGER", "PRODUCTION"),
  };
}

/**
 * Exact text an administrator must type to remove a worker, e.g.
 * "REMOVE EMP-TEST-001 — Alex Morgan" (the dash is an em dash, U+2014).
 */
export function removalPhrase(e: { employeeCode: string; firstName: string; lastName: string }): string {
  return `REMOVE ${e.employeeCode} — ${fullName(e)}`;
}

// ── Efficiency ───────────────────────────────────────────────────────────────

/** produced / expected × 100 to one decimal; null when it cannot be calculated. */
export function calculateEfficiency(expected: number | null | undefined, produced: number | null | undefined): number | null {
  if (expected == null || produced == null) return null;
  if (!Number.isFinite(expected) || !Number.isFinite(produced) || expected <= 0) return null;
  return Math.round((produced / expected) * 1000) / 10;
}

export function formatEfficiency(value: number | null): string {
  return value === null ? "N/A" : `${value.toFixed(1)}%`;
}

export function efficiencyColor(value: number | null): string {
  if (value === null) return "#7A6C6A";
  if (value >= 95) return "#2E7D32";
  if (value >= 80) return "#E65100";
  return "#C0392B";
}

// ── Labels ───────────────────────────────────────────────────────────────────

export const ATTENDANCE_STATUSES: { value: AttendanceStatus; label: string; bg: string; color: string }[] = [
  { value: "PRESENT", label: "Present", bg: "#E8F5E9", color: "#2E7D32" },
  { value: "LATE", label: "Late", bg: "#FFF8E1", color: "#F57F17" },
  { value: "HALF_DAY", label: "Half Day", bg: "#FFF3E0", color: "#E65100" },
  { value: "ABSENT", label: "Absent", bg: "#FFEBEE", color: "#C0392B" },
  { value: "LEAVE", label: "On Leave", bg: "#E3F2FD", color: "#1565C0" },
  { value: "WEEK_OFF", label: "Week Off", bg: "#F3E5F5", color: "#6A1B9A" },
];

export function attendanceStatusInfo(status: AttendanceStatus) {
  return ATTENDANCE_STATUSES.find((s) => s.value === status) ?? ATTENDANCE_STATUSES[0]!;
}

/** Statuses a user may set; TERMINATED comes only from deleting the employee. */
export const EDITABLE_EMPLOYEE_STATUSES: { value: Exclude<EmployeeStatus, "TERMINATED">; label: string }[] = [
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
  { value: "ON_LEAVE", label: "On Leave" },
];

export function employeeStatusLabel(status: EmployeeStatus): string {
  return status === "TERMINATED" ? "Terminated" : EDITABLE_EMPLOYEE_STATUSES.find((s) => s.value === status)?.label ?? status;
}

export const EMPLOYMENT_TYPES = [
  { value: "FULL_TIME", label: "Full time" },
  { value: "PART_TIME", label: "Part time" },
  { value: "CONTRACT", label: "Contract" },
  { value: "INTERN", label: "Intern" },
] as const;

export function fullName(e: { firstName: string; lastName: string }): string {
  return `${e.firstName} ${e.lastName}`.trim();
}

// ── Dates ────────────────────────────────────────────────────────────────────

/** YYYY-MM-DD in the browser's timezone (toISOString would give the UTC day). */
export function localIsoDate(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The calendar day of an API date (stored as midnight UTC). */
export function apiDay(value: string): string {
  return value.slice(0, 10);
}

export function formatDay(isoDay: string): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  if (!y || !m || !d) return isoDay;
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/** HH:MM in local time for a clock-in/out timestamp, or "" when missing. */
export function localTime(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** ISO timestamp for a local day + HH:MM, or null when the time is blank. */
export function combineDayAndTime(isoDay: string, time: string): string | null {
  if (!time) return null;
  return new Date(`${isoDay}T${time}`).toISOString();
}

// ── Lookups ──────────────────────────────────────────────────────────────────

export function sameName(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
}

export function findByName<T extends { name: string }>(items: T[], name: string): T | undefined {
  return name.trim() === "" ? undefined : items.find((i) => sameName(i.name, name));
}

/** A 2–10 character department code (A–Z, 0–9, _) not already in use. */
export function suggestDepartmentCode(name: string, taken: string[]): string {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  let base = words.length > 1 ? words.map((w) => w[0]).join("") : (words[0] ?? "");
  if (base.length < 2) base = (words.join("") + "DEPT").slice(0, 4);
  base = base.slice(0, 8);
  const used = new Set(taken.map((c) => c.toUpperCase()));
  if (!used.has(base)) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${base}${n}`.slice(0, 10);
    if (!used.has(candidate)) return candidate;
  }
  return base;
}

// ── Number fields ────────────────────────────────────────────────────────────

/** "" → null, otherwise the number (NaN when it is not one). */
export function parseOptionalNumber(text: string): number | null {
  const t = text.trim();
  return t === "" ? null : Number(t);
}

export function numberToField(value: number | null | undefined): string {
  return value == null ? "" : String(value);
}

// ── Form validation ──────────────────────────────────────────────────────────

export interface EmployeeFormValues {
  employeeCode: string;
  firstName: string;
  lastName: string;
  designation: string;
  joiningDate: string;
  dailyWageRate: string;
  workingHours: string;
  expectedParts: string;
  producedParts: string;
  operationsCount: string;
  performanceDate: string;
}

export type FormErrors = Partial<Record<keyof EmployeeFormValues | "department" | "shift", string>>;

export function validateEmployeeForm(v: EmployeeFormValues, opts: { checkProfile: boolean; checkPay: boolean; checkPerformance: boolean }): FormErrors {
  const e: FormErrors = {};
  if (opts.checkProfile) {
    if (!v.employeeCode.trim()) e.employeeCode = "Employee ID is required.";
    else if (!/^[A-Z0-9_-]{1,20}$/.test(v.employeeCode.trim())) e.employeeCode = "Use up to 20 capital letters, digits, - or _.";
    if (!v.firstName.trim()) e.firstName = "First name is required.";
    if (!v.designation.trim()) e.designation = "Designation is required.";
    if (!v.joiningDate || Number.isNaN(new Date(v.joiningDate).getTime())) e.joiningDate = "Enter a valid joining date.";
  }
  if (opts.checkPay && v.dailyWageRate.trim() && !/^\d{1,8}(\.\d{1,2})?$/.test(v.dailyWageRate.trim())) {
    e.dailyWageRate = "Enter a non-negative amount with up to 2 decimals.";
  }
  if (opts.checkPerformance) {
    const nonNegative = (field: "workingHours" | "expectedParts" | "producedParts", max: number, label: string) => {
      const n = parseOptionalNumber(v[field]);
      if (n === null) return;
      if (Number.isNaN(n)) e[field] = `${label} must be a number.`;
      else if (n < 0) e[field] = `${label} cannot be negative.`;
      else if (n > max) e[field] = `${label} cannot exceed ${max}.`;
    };
    nonNegative("workingHours", 24, "Working hours");
    nonNegative("expectedParts", 1_000_000_000, "Expected parts");
    nonNegative("producedParts", 1_000_000_000, "Produced parts");
    const ops = parseOptionalNumber(v.operationsCount);
    if (ops !== null && (!Number.isInteger(ops) || ops < 0)) e.operationsCount = "Enter a whole number of 0 or more.";
    const hasValue = [v.workingHours, v.expectedParts, v.producedParts, v.operationsCount].some((x) => x.trim() !== "");
    if (hasValue && !v.performanceDate) e.performanceDate = "Choose the date these figures are for.";
    if (v.performanceDate && v.performanceDate > localIsoDate()) e.performanceDate = "Performance cannot be recorded for a future date.";
  }
  return e;
}

// ── CSV rows ─────────────────────────────────────────────────────────────────

export interface WorkforceExportRow {
  employee: EmployeeDto;
  output: EmployeeOutputDto | null;
  attendance: AttendanceDto | null;
}

/**
 * Header + one row per employee. Pay and attendance columns exist only when
 * the viewer may see them, so a restricted user's file never contains them.
 */
export function workforceCsvRows(rows: WorkforceExportRow[], opts: { date: string; includePay: boolean; includeAttendance: boolean }): CsvCell[][] {
  const header: CsvCell[] = [
    "Employee ID", "First Name", "Last Name", "Department", "Designation", "Shift",
    "Joining Date", "Employment Type", "Employment Status", "Performance Date",
  ];
  if (opts.includeAttendance) header.push("Attendance Status");
  header.push("Working Hours", "Expected Parts", "Produced Parts", "Efficiency (%)", "Operations");
  if (opts.includePay) header.push("Daily Wage Rate");

  const body = rows.map(({ employee: e, output: o, attendance: a }) => {
    const row: CsvCell[] = [
      e.employeeCode, e.firstName, e.lastName, e.department?.name ?? "", e.designation, e.shift?.name ?? "",
      apiDay(e.joiningDate), e.employmentType, employeeStatusLabel(e.status), opts.date,
    ];
    if (opts.includeAttendance) row.push(a ? attendanceStatusInfo(a.status).label : "Not recorded");
    const efficiency = o?.efficiency ?? null;
    row.push(o?.workingHours ?? "", o?.expectedParts ?? "", o?.producedParts ?? "", efficiency === null ? (o ? "N/A" : "") : efficiency.toFixed(1), o?.operationsCount ?? "");
    if (opts.includePay) row.push(e.dailyWageRate ?? "");
    return row;
  });
  return [header, ...body];
}

export function attendanceCsvRows(records: AttendanceDto[]): CsvCell[][] {
  const header: CsvCell[] = [
    "Date", "Employee ID", "Employee Name", "Department", "Designation", "Shift",
    "Status", "Check-In", "Check-Out", "Hours Worked", "Remarks",
  ];
  return [
    header,
    ...records.map((r) => [
      apiDay(r.date), r.employee.employeeCode, fullName(r.employee), r.employee.department?.name ?? "",
      r.employee.designation, r.employee.shift?.name ?? "", attendanceStatusInfo(r.status).label,
      localTime(r.clockIn), localTime(r.clockOut), r.workingHours ?? "", r.remarks ?? "",
    ]),
  ];
}

/** e.g. DVS_Attendance_2026-10-01_to_2026-10-26_exported_2026-10-26.csv */
export function exportFilename(report: string, scope: string, today: string = localIsoDate()): string {
  return `DVS_${report}_${scope}_exported_${today}.csv`;
}
