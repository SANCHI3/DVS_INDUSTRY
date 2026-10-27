import api, { unwrap, unwrapPaged, type PaginatedMeta } from '../api';

export type EmployeeStatus = 'ACTIVE' | 'INACTIVE' | 'ON_LEAVE' | 'TERMINATED';

export interface EmployeeDto {
  id:             number;
  employeeCode:   string;
  firstName:      string;
  lastName:       string;
  email:          string | null;
  phone:          string | null;
  gender:         string | null;
  designation:    string;
  employmentType: string;
  /** Null for roles that may not see pay (only ADMIN and HR do). */
  salary:         string | null;
  dailyWageRate:  string | null;
  status:         EmployeeStatus;
  departmentId:   number | null;
  department:     { id: number; name: string; code: string } | null;
  shiftId:        number | null;
  shift:          { id: number; name: string } | null;
  managerId:      number | null;
  profileImage:   string | null;
  joiningDate:    string;
  createdAt:      string;
  updatedAt:      string;
  deletedAt:      string | null;
}

export interface EmployeeQuery {
  page?: number; pageSize?: number;
  search?: string; departmentId?: number; status?: string;
  employmentType?: string; shiftId?: number;
  sortBy?: string; sortOrder?: 'asc' | 'desc';
}

export async function getEmployees(params?: EmployeeQuery) {
  const res = await api.get<{ success: true; data: EmployeeDto[]; meta: PaginatedMeta }>('/employees', { params });
  return unwrapPaged(res);
}

export async function getEmployeeById(id: number): Promise<EmployeeDto> {
  const res = await api.get<{ success: true; data: EmployeeDto }>(`/employees/${id}`);
  return unwrap(res);
}

export async function createEmployee(payload: Record<string, unknown>): Promise<EmployeeDto> {
  const res = await api.post<{ success: true; data: EmployeeDto }>('/employees', payload);
  return unwrap(res);
}

export async function updateEmployee(id: number, payload: Record<string, unknown>): Promise<EmployeeDto> {
  const res = await api.patch<{ success: true; data: EmployeeDto }>(`/employees/${id}`, payload);
  return unwrap(res);
}

export async function deleteEmployee(id: number): Promise<void> {
  await api.delete(`/employees/${id}`);
}

export async function assignDepartment(id: number, departmentId: number | null): Promise<EmployeeDto> {
  const res = await api.patch<{ success: true; data: EmployeeDto }>(`/employees/${id}/department`, { departmentId });
  return unwrap(res);
}

export async function assignShift(id: number, shiftId: number | null): Promise<EmployeeDto> {
  const res = await api.patch<{ success: true; data: EmployeeDto }>(`/employees/${id}/shift`, { shiftId });
  return unwrap(res);
}

export interface EmployeeStatistics {
  total: number;
  active: number;
  inactive: number;
  onLeave: number;
  terminated: number;
  byDepartment: Array<{ department: string; count: number }>;
  byDesignation: Array<{ designation: string; count: number }>;
  byEmploymentType: Array<{ type: string; count: number }>;
}

export async function getEmployeeStats(): Promise<EmployeeStatistics> {
  const res = await api.get<{ success: true; data: EmployeeStatistics }>('/employees/statistics');
  return unwrap(res);
}
