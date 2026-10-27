// ── Shift & Attendance domain interfaces ─────────────────────────────────────
// Pure domain objects — zero Prisma imports.

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'HALF_DAY' | 'LATE' | 'LEAVE' | 'WEEK_OFF';

// ── Shift ─────────────────────────────────────────────────────────────────────

export interface ShiftDto {
  id: number;
  name: string;
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  isNightShift: boolean;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count: { employees: number }; // always present — required by select shape
}

export interface CreateShiftData {
  name: string;
  startTime: string;
  endTime: string;
  isNightShift?: boolean | undefined;
  description?: string | null | undefined;
}

export interface UpdateShiftData {
  name?: string | undefined;
  startTime?: string | undefined;
  endTime?: string | undefined;
  isNightShift?: boolean | undefined;
  description?: string | null | undefined;
}

export interface ShiftFilters {
  search?: string | undefined;
  sortBy?: 'name' | 'startTime' | 'createdAt' | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

export interface ShiftListResult {
  data: ShiftDto[];
  total: number;
}

// ── Attendance ────────────────────────────────────────────────────────────────

export interface AttendanceEmployeeRef {
  id: number;
  employeeCode: string;
  firstName: string;
  lastName: string;
  designation: string;
  department: { id: number; name: string } | null;
  shift: { id: number; name: string } | null;
}

export interface AttendanceDto {
  id: number;
  employeeId: number;
  employee: AttendanceEmployeeRef;
  date: Date;
  clockIn: Date | null;
  clockOut: Date | null;
  workingHours: number | null;
  status: AttendanceStatus;
  remarks: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AttendanceListResult {
  data: AttendanceDto[];
  total: number;
}

// ── Bulk attendance (mark many employees at once) ─────────────────────────────

export interface BulkAttendanceEntry {
  employeeId: number;
  status: AttendanceStatus;
  clockIn?: Date | null | undefined;
  clockOut?: Date | null | undefined;
  remarks?: string | null | undefined;
}

// ── Input types ───────────────────────────────────────────────────────────────

export interface CreateAttendanceData {
  employeeId: number;
  date: Date;
  status: AttendanceStatus;
  clockIn?: Date | null | undefined;
  clockOut?: Date | null | undefined;
  remarks?: string | null | undefined;
}

export interface UpdateAttendanceData {
  status?: AttendanceStatus | undefined;
  clockIn?: Date | null | undefined;
  clockOut?: Date | null | undefined;
  remarks?: string | null | undefined;
}

export interface ClockInData {
  employeeId: number;
  clockIn: Date;
  remarks?: string | null | undefined;
}

export interface ClockOutData {
  clockOut: Date;
  remarks?: string | null | undefined;
}

// ── Filters ───────────────────────────────────────────────────────────────────

export interface AttendanceFilters {
  search?: string | undefined; // employee code or name
  employeeId?: number | undefined;
  departmentId?: number | undefined;
  status?: AttendanceStatus | 'all' | undefined;
  fromDate?: Date | undefined;
  toDate?: Date | undefined;
  date?: Date | undefined; // exact date lookup
  sortOrder?: 'asc' | 'desc' | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

// ── Daily summary (for dashboard / workforce view) ────────────────────────────

export interface DailyAttendanceSummary {
  date: string; // ISO date string
  totalEmployees: number;
  present: number;
  absent: number;
  halfDay: number;
  late: number;
  onLeave: number;
  weekOff: number;
  attendanceRate: string; // e.g. "96.4%"; week-offs are not counted as working days
  byDepartment: Array<{
    departmentId: number;
    departmentName: string;
    present: number;
    attended: number; // present + late + half day
    weekOff: number;
    total: number;
  }>;
}

// ── Attendance trend (7-day / 30-day) ─────────────────────────────────────────

export interface AttendanceTrendEntry {
  date: string; // ISO date, e.g. "2026-10-26"
  present: number;
  absent: number;
  late: number;
  halfDay: number;
  onLeave: number;
  weekOff: number;
}

// ── Employee daily output (per-employee performance) ─────────────────────────
// Separate from work-order output; never added to company production totals.

export interface EmployeeDailyOutputDto {
  id: number;
  employeeId: number;
  employee: AttendanceEmployeeRef;
  date: Date;
  workingHours: number | null;
  expectedParts: number | null;
  producedParts: number | null;
  operationsCount: number | null;
  efficiency: number | null; // produced / expected × 100; null when expected is 0 or missing
  remarks: string | null;
  recordedById: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EmployeeDailyOutputListResult {
  data: EmployeeDailyOutputDto[];
  total: number;
}

export interface CreateEmployeeDailyOutputData {
  employeeId: number;
  date: Date;
  workingHours?: number | null | undefined;
  expectedParts?: number | null | undefined;
  producedParts?: number | null | undefined;
  operationsCount?: number | null | undefined;
  remarks?: string | null | undefined;
  recordedById?: number | null | undefined;
}

export interface UpdateEmployeeDailyOutputData {
  workingHours?: number | null | undefined;
  expectedParts?: number | null | undefined;
  producedParts?: number | null | undefined;
  operationsCount?: number | null | undefined;
  remarks?: string | null | undefined;
}

export interface EmployeeDailyOutputFilters {
  search?: string | undefined;
  employeeId?: number | undefined;
  departmentId?: number | undefined;
  date?: Date | undefined;
  fromDate?: Date | undefined;
  toDate?: Date | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

export interface EmployeeOutputSummary {
  fromDate: string;
  toDate: string;
  employeesRecorded: number;
  records: number;
  totalExpectedParts: number;
  totalProducedParts: number;
  totalOperations: number;
  efficiency: number | null; // over records that have expected > 0
}
