// ── Domain interfaces for the Employee feature ──────────────────────────────
// Pure domain objects — zero Prisma imports.

// ── Enums (mirror Prisma enums — no Prisma import needed) ────────────────────

export type Gender = 'MALE' | 'FEMALE' | 'OTHER';
export type EmploymentType = 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'INTERN';
export type EmployeeStatus = 'ACTIVE' | 'INACTIVE' | 'ON_LEAVE' | 'TERMINATED';

// ── DTOs ──────────────────────────────────────────────────────────────────────

export interface EmployeeShiftRef {
  id: number;
  name: string;
  startTime: string;
  endTime: string;
  isNightShift: boolean;
  description: string | null;
}

export interface EmployeeManagerDto {
  id: number;
  employeeCode: string;
  firstName: string;
  lastName: string;
  designation: string;
}

export interface DepartmentRefDto {
  id: number;
  name: string;
  code: string;
}

export interface EmployeeDto {
  id: number;
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  gender: Gender | null;
  dateOfBirth: Date | null;
  joiningDate: Date;
  designation: string;
  employmentType: EmploymentType;
  salary: string | null; // Decimal serialised as string
  dailyWageRate: string | null; // Decimal serialised as string
  status: EmployeeStatus;
  profileImage: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  pincode: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  department: DepartmentRefDto | null;
  shift: EmployeeShiftRef | null;
  manager: EmployeeManagerDto | null;
  userId: number | null;
}

// ── List result ───────────────────────────────────────────────────────────────

export interface EmployeeListResult {
  data: EmployeeDto[];
  total: number;
}

// ── Statistics ────────────────────────────────────────────────────────────────

export interface EmployeeStatistics {
  total: number;
  active: number;
  inactive: number;
  onLeave: number;
  terminated: number;
  byDepartment: Array<{ departmentId: number; name: string; count: number }>;
  byEmploymentType: Array<{ type: EmploymentType; count: number }>;
  byGender: Array<{ gender: Gender | null; count: number }>;
  newThisMonth: number;
}

// ── Filters ───────────────────────────────────────────────────────────────────

export interface EmployeeFilters {
  search?: string | undefined;
  departmentId?: number | undefined;
  designation?: string | undefined;
  status?: EmployeeStatus | 'all' | undefined;
  employmentType?: EmploymentType | undefined;
  shiftId?: number | undefined;
  managerId?: number | undefined;
  includeDeleted?: boolean | undefined;
  sortBy?: 'firstName' | 'lastName' | 'employeeCode' | 'joiningDate' | 'createdAt' | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

// ── Repository contract ───────────────────────────────────────────────────────

export interface IEmployeeRepository {
  create(data: CreateEmployeeData): Promise<EmployeeDto>;
  update(id: number, data: UpdateEmployeeData): Promise<EmployeeDto>;
  findById(id: number): Promise<EmployeeDto | null>;
  findByEmployeeCode(code: string): Promise<EmployeeDto | null>;
  findByEmail(email: string): Promise<EmployeeDto | null>;
  findAll(filters: EmployeeFilters): Promise<EmployeeListResult>;
  softDelete(id: number): Promise<EmployeeDto>;
  restore(id: number): Promise<EmployeeDto>;
  activate(id: number): Promise<EmployeeDto>;
  deactivate(id: number): Promise<EmployeeDto>;
  assignDepartment(id: number, departmentId: number | null): Promise<EmployeeDto>;
  assignManager(id: number, managerId: number | null): Promise<EmployeeDto>;
  assignShift(id: number, shiftId: number | null): Promise<EmployeeDto>;
  statistics(): Promise<EmployeeStatistics>;
}

// ── Input types ───────────────────────────────────────────────────────────────

export interface CreateEmployeeData {
  employeeCode: string;
  firstName: string;
  lastName: string;
  email?: string | null | undefined;
  phone?: string | null | undefined;
  gender?: Gender | null | undefined;
  dateOfBirth?: Date | null | undefined;
  joiningDate: Date;
  designation: string;
  employmentType?: EmploymentType | undefined;
  salary?: string | null | undefined; // decimal as string
  dailyWageRate?: string | null | undefined;
  status?: EmployeeStatus | undefined;
  departmentId?: number | null | undefined;
  shiftId?: number | null | undefined;
  managerId?: number | null | undefined;
  userId?: number | null | undefined;
  address?: string | null | undefined;
  city?: string | null | undefined;
  state?: string | null | undefined;
  country?: string | null | undefined;
  pincode?: string | null | undefined;
  emergencyName?: string | null | undefined;
  emergencyPhone?: string | null | undefined;
  profileImage?: string | null | undefined;
}

export interface UpdateEmployeeData {
  employeeCode?: string | undefined;
  firstName?: string | undefined;
  lastName?: string | undefined;
  email?: string | null | undefined;
  phone?: string | null | undefined;
  gender?: Gender | null | undefined;
  dateOfBirth?: Date | null | undefined;
  joiningDate?: Date | undefined;
  designation?: string | undefined;
  employmentType?: EmploymentType | undefined;
  salary?: string | null | undefined;
  dailyWageRate?: string | null | undefined;
  status?: EmployeeStatus | undefined;
  address?: string | null | undefined;
  city?: string | null | undefined;
  state?: string | null | undefined;
  country?: string | null | undefined;
  pincode?: string | null | undefined;
  emergencyName?: string | null | undefined;
  emergencyPhone?: string | null | undefined;
  profileImage?: string | null | undefined;
}
