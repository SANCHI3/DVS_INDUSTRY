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

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'HALF_DAY' | 'LATE' | 'LEAVE';

export interface AttendanceDto {
  id:           number;
  employeeId:   number;
  employee:     { id: number; employeeCode: string; firstName: string; lastName: string; designation: string; department: { id: number; name: string } | null };
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
}): Promise<{ created: number; updated: number }> {
  const res = await api.post<{ success: true; data: { created: number; updated: number } }>('/workforce/attendance/bulk', payload);
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
  attendanceRate:    string;
  byDepartment:      Array<{ departmentId: number; departmentName: string; present: number; total: number }>;
}

export async function getAttendanceSummary(params?: { date?: string; departmentId?: number }): Promise<DailyAttendanceSummary> {
  const res = await api.get<{ success: true; data: DailyAttendanceSummary }>('/workforce/attendance/summary', { params });
  return unwrap(res);
}

export interface WorkforceAttendanceTrendEntry { date: string; present: number; absent: number; late: number }

export async function getAttendanceTrend(params?: { days?: number; departmentId?: number }): Promise<WorkforceAttendanceTrendEntry[]> {
  const res = await api.get<{ success: true; data: WorkforceAttendanceTrendEntry[] }>('/workforce/attendance/trend', { params });
  return unwrap(res);
}
