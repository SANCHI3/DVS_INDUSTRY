import api, { unwrap, unwrapPaged, type PaginatedMeta } from '../api';

// ── Shift ─────────────────────────────────────────────────────────────────────

export interface ShiftDto {
  id:          number;
  name:        string;
  startTime:   string;
  endTime:     string;
  isNightShift: boolean;
  description: string | null;
  createdAt:   string;
  updatedAt:   string;
  _count:      { employees: number };
}

export interface CreateShiftPayload {
  name:         string;
  startTime:    string;
  endTime:      string;
  isNightShift?: boolean;
  description?: string | null;
}

export async function getShifts(params?: { page?: number; pageSize?: number; search?: string }) {
  const res = await api.get<{ success: true; data: ShiftDto[]; meta: PaginatedMeta }>('/workforce/shifts', { params });
  return unwrapPaged(res);
}

export async function createShift(payload: CreateShiftPayload): Promise<ShiftDto> {
  const res = await api.post<{ success: true; data: ShiftDto }>('/workforce/shifts', payload);
  return unwrap(res);
}

export async function updateShift(id: number, payload: Partial<CreateShiftPayload>): Promise<ShiftDto> {
  const res = await api.patch<{ success: true; data: ShiftDto }>(`/workforce/shifts/${id}`, payload);
  return unwrap(res);
}

export async function deleteShift(id: number): Promise<void> {
  await api.delete(`/workforce/shifts/${id}`);
}

// ── Attendance ────────────────────────────────────────────────────────────────

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'HALF_DAY' | 'LATE' | 'LEAVE' | 'WEEK_OFF';

export interface EmployeeRef {
  id: number; employeeCode: string; firstName: string; lastName: string; designation: string;
  department: { id: number; name: string } | null;
  shift: { id: number; name: string } | null;
}

export interface AttendanceDto {
  id:           number;
  employeeId:   number;
  employee:     EmployeeRef;
  date:         string;
  clockIn:      string | null;
  clockOut:     string | null;
  workingHours: number | null;
  status:       AttendanceStatus;
  remarks:      string | null;
  createdAt:    string;
  updatedAt:    string;
}

export interface AttendanceQuery {
  page?: number; pageSize?: number;
  search?: string;
  employeeId?: number; departmentId?: number;
  status?: AttendanceStatus | 'all';
  date?: string; fromDate?: string; toDate?: string;
  sortOrder?: 'asc' | 'desc';
}

export async function getAttendance(params?: AttendanceQuery) {
  const res = await api.get<{ success: true; data: AttendanceDto[]; meta: PaginatedMeta }>('/workforce/attendance', { params });
  return unwrapPaged(res);
}

export async function createAttendance(payload: {
  employeeId: number; date: string; status: AttendanceStatus;
  clockIn?: string | null; clockOut?: string | null; remarks?: string | null;
}): Promise<AttendanceDto> {
  const res = await api.post<{ success: true; data: AttendanceDto }>('/workforce/attendance', payload);
  return unwrap(res);
}

export async function updateAttendance(id: number, payload: {
  status?: AttendanceStatus; clockIn?: string | null; clockOut?: string | null; remarks?: string | null;
}): Promise<AttendanceDto> {
  const res = await api.patch<{ success: true; data: AttendanceDto }>(`/workforce/attendance/${id}`, payload);
  return unwrap(res);
}

export async function deleteAttendance(id: number): Promise<void> {
  await api.delete(`/workforce/attendance/${id}`);
}

// ── Excel attendance upload ──────────────────────────────────────────────────

export type AttendanceImportResult = 'VALID' | 'EXISTING' | 'DUPLICATE' | 'REJECTED';

export interface AttendanceImportRow {
  row:          number;
  employeeCode: string;
  employeeName: string;
  /** The name exactly as the sheet writes it */
  sourceName:   string;
  /** The sheet's shift code as written */
  sourceShift:  string;
  employeeId:   number | null;
  date:         string | null;
  rawStatus:    string;
  status:       AttendanceStatus | null;
  result:       AttendanceImportResult;
  reason:       string | null;
  clockIn:      string | null;
  clockOut:     string | null;
  overtime:     string | null;
  note:         string | null;
}

export interface AttendanceImportReport {
  kind:      'table' | 'monthly';
  date:      string;
  fileName:  string;
  sheetName: string;
  rows:      AttendanceImportRow[];
  summary: {
    totalRows: number;
    valid:     number;
    existing:  number;
    duplicate: number;
    rejected:  number;
    blankRows: number;
  };
  /** Employee IDs in the sheet that Workforce Management does not have */
  unregistered: AttendanceSheetNewEmployee[];
  /** Present on the import response only */
  imported?: number;
}

export interface AttendanceSheetNewEmployee {
  employeeCode: string;
  /** Name and shift exactly as the sheet writes them */
  name:         string;
  shift:        string;
  rows:         number[];
  /** Why it cannot be registered from this sheet; null when it can */
  problem:      string | null;
}

/** What the administrator completes for one employee before registering */
export interface SheetEmployeeRegistration {
  employeeCode:   string;
  firstName:      string;
  lastName:       string;
  designation:    string;
  joiningDate:    string;
  employmentType: 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'INTERN';
  shiftId:        number | null;
}

function sheetForm(file: File, date: string): FormData {
  const form = new FormData();
  form.append('date', date);
  // Places the sheet's punch times on the right instant (IST = 330)
  form.append('utcOffset', String(-new Date().getTimezoneOffset()));
  form.append('file', file);
  return form;
}

// The instance defaults to JSON, which would turn FormData into JSON; this
// header makes axios send real multipart (the browser adds the boundary).
const MULTIPART = { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60_000 };

/** Checks the sheet on the server. Saves nothing. */
export async function previewAttendanceImport(file: File, date: string): Promise<AttendanceImportReport> {
  const res = await api.post<{ success: true; data: AttendanceImportReport }>('/workforce/attendance/import/preview', sheetForm(file, date), MULTIPART);
  return unwrap(res);
}

/** The server checks the same file again and saves only the valid rows. */
export async function importAttendanceSheet(file: File, date: string): Promise<AttendanceImportReport> {
  const res = await api.post<{ success: true; data: AttendanceImportReport }>('/workforce/attendance/import', sheetForm(file, date), MULTIPART);
  return unwrap(res);
}

/**
 * Registers employees the sheet lists but Workforce Management lacks. The
 * server reads the same file again; all are created or none. No attendance is saved.
 */
export async function registerSheetEmployees(
  file: File,
  date: string,
  employees: SheetEmployeeRegistration[],
): Promise<{ created: Array<{ id: number; employeeCode: string; name: string }>; report: AttendanceImportReport }> {
  const form = sheetForm(file, date);
  form.append('employees', JSON.stringify(employees));
  const res = await api.post<{
    success: true;
    data: { created: Array<{ id: number; employeeCode: string; name: string }>; report: AttendanceImportReport };
  }>('/workforce/attendance/import/register-employees', form, MULTIPART);
  return unwrap(res);
}

export async function clockIn(payload: { employeeId: number; clockIn?: string; remarks?: string | null }): Promise<AttendanceDto> {
  const res = await api.post<{ success: true; data: AttendanceDto }>('/workforce/attendance/clock-in', payload);
  return unwrap(res);
}

export async function clockOut(id: number, payload: { clockOut?: string; remarks?: string | null }): Promise<AttendanceDto> {
  const res = await api.patch<{ success: true; data: AttendanceDto }>(`/workforce/attendance/${id}/clock-out`, payload);
  return unwrap(res);
}

export async function bulkMarkAttendance(payload: {
  date: string;
  entries: Array<{ employeeId: number; status: AttendanceStatus; clockIn?: string | null; clockOut?: string | null; remarks?: string | null }>;
}): Promise<{ created: number; updated: number; skippedEmployeeIds: number[] }> {
  const res = await api.post<{ success: true; data: { created: number; updated: number; skippedEmployeeIds: number[] } }>('/workforce/attendance/bulk', payload);
  return unwrap(res);
}

export interface DailyAttendanceSummary {
  date:              string;
  totalEmployees:    number;
  present:           number;
  absent:            number;
  halfDay:           number;
  late:              number;
  onLeave:           number;
  weekOff:           number;
  /** Attended (present + late + half day) over working headcount; week-offs excluded. */
  attendanceRate:    string;
  byDepartment:      Array<{ departmentId: number; departmentName: string; present: number; attended: number; weekOff: number; total: number }>;
}

export async function getAttendanceSummary(params?: { date?: string; departmentId?: number }): Promise<DailyAttendanceSummary> {
  const res = await api.get<{ success: true; data: DailyAttendanceSummary }>('/workforce/attendance/summary', { params });
  return unwrap(res);
}

/** `date` is an ISO day, e.g. "2026-10-26". */
export interface WorkforceAttendanceTrendEntry {
  date: string; present: number; absent: number; late: number; halfDay: number; onLeave: number; weekOff: number;
}

export async function getAttendanceTrend(params?: { days?: number; departmentId?: number; endDate?: string }): Promise<WorkforceAttendanceTrendEntry[]> {
  const res = await api.get<{ success: true; data: WorkforceAttendanceTrendEntry[] }>('/workforce/attendance/trend', { params });
  return unwrap(res);
}

// ── Employee daily output (per-employee performance) ──────────────────────────
// Separate from work-order output: never part of company production totals.

export interface EmployeeOutputDto {
  id:              number;
  employeeId:      number;
  employee:        EmployeeRef;
  date:            string;
  workingHours:    number | null;
  expectedParts:   number | null;
  producedParts:   number | null;
  operationsCount: number | null;
  /** produced / expected × 100; null when it cannot be calculated */
  efficiency:      number | null;
  remarks:         string | null;
  recordedById:    number | null;
  createdAt:       string;
  updatedAt:       string;
}

export interface EmployeeOutputFields {
  workingHours?:    number | null;
  expectedParts?:   number | null;
  producedParts?:   number | null;
  operationsCount?: number | null;
  remarks?:         string | null;
}

export interface EmployeeOutputQuery {
  page?: number; pageSize?: number; search?: string;
  employeeId?: number; departmentId?: number;
  date?: string; fromDate?: string; toDate?: string;
  sortOrder?: 'asc' | 'desc';
}

export async function getEmployeeOutputs(params?: EmployeeOutputQuery) {
  const res = await api.get<{ success: true; data: EmployeeOutputDto[]; meta: PaginatedMeta }>('/workforce/performance', { params });
  return unwrapPaged(res);
}

export async function createEmployeeOutput(payload: EmployeeOutputFields & { employeeId: number; date: string }): Promise<EmployeeOutputDto> {
  const res = await api.post<{ success: true; data: EmployeeOutputDto }>('/workforce/performance', payload);
  return unwrap(res);
}

export async function updateEmployeeOutput(id: number, payload: EmployeeOutputFields): Promise<EmployeeOutputDto> {
  const res = await api.patch<{ success: true; data: EmployeeOutputDto }>(`/workforce/performance/${id}`, payload);
  return unwrap(res);
}

export interface EmployeeOutputSummary {
  fromDate: string; toDate: string;
  employeesRecorded: number; records: number;
  totalExpectedParts: number; totalProducedParts: number; totalOperations: number;
  efficiency: number | null;
}

export async function getEmployeeOutputSummary(params?: { date?: string; fromDate?: string; toDate?: string; departmentId?: number }): Promise<EmployeeOutputSummary> {
  const res = await api.get<{ success: true; data: EmployeeOutputSummary }>('/workforce/performance/summary', { params });
  return unwrap(res);
}
