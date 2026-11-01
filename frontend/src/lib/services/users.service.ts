import api, { unwrap } from '../api';

export interface UserDto {
  id:        number;
  fullName:  string;
  email:     string;
  phone:     string | null;
  roleId:    number;
  role:      { id: number; name: string; description: string | null };
  isActive:  boolean;
  lastLogin: string | null;
  createdAt: string;
  employee:  { id: number; employeeCode: string } | null;
}

export interface RoleDto { id: number; name: string; description: string | null }

export async function getRoles(): Promise<RoleDto[]> {
  const res = await api.get<{ success: true; data: RoleDto[] }>('/auth/roles');
  return unwrap(res);
}

export async function getUsers(): Promise<UserDto[]> {
  const res = await api.get<{ success: true; data: UserDto[] }>('/auth/users');
  return unwrap(res);
}

export async function getEligibleEmployees(): Promise<UserDto[]> {
  const res = await api.get<{ success: true; data: UserDto[] }>('/auth/users/employees');
  return unwrap(res);
}

export async function registerUser(input: {
  fullName: string;
  email: string;
  password: string;
  roleId: number;
  /** Supplier/client logins: their company (the server matches by email when absent). */
  supplierId?: number;
  clientId?: number;
}): Promise<UserDto> {
  const res = await api.post<{ success: true; data: UserDto }>('/auth/register', input);
  return unwrap(res);
}

export async function updateUser(id: number, input: { fullName?: string; email?: string; roleId?: number; isActive?: boolean }): Promise<UserDto> {
  const res = await api.patch<{ success: true; data: UserDto }>(`/auth/users/${id}`, input);
  return unwrap(res);
}

export async function deactivateUser(id: number): Promise<UserDto> {
  const res = await api.patch<{ success: true; data: UserDto }>(`/auth/users/${id}/deactivate`);
  return unwrap(res);
}
