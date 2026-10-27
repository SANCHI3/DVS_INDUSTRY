import type { Request, Response } from 'express';
import { EmployeeService } from '../services/employee.service';
import type { AuthenticatedRequest } from '../types';
import { ROLES } from '../constants';
import { sendSuccess, sendCreated, sendNoContent } from '../utils/response';
import { BadRequestError, ForbiddenError } from '../errors';
import { saveProfileImage, deleteProfileImage } from '../utils/upload';
import type {
  CreateEmployeeInput,
  UpdateEmployeeInput,
  EmployeeQueryInput,
  AssignDepartmentInput,
  AssignManagerInput,
  AssignShiftInput,
} from '../validators/employee.validator';
import type { EmployeeDto, EmployeeFilters, UpdateEmployeeData } from '../interfaces';

const employeeService = new EmployeeService();

// Salary and wage rate are visible only to the roles that manage them
const PAY_ROLES: readonly string[] = [ROLES.ADMIN, ROLES.HR];

export function canViewPay(req: Request): boolean {
  const role = (req as AuthenticatedRequest).user?.role;
  return role !== undefined && PAY_ROLES.includes(role);
}

function withoutPay(employee: EmployeeDto): EmployeeDto {
  return { ...employee, salary: null, dailyWageRate: null };
}

/** Pay may only be written by the roles that may read it. */
function assertMayWritePay(
  req: Request,
  body: { salary?: unknown; dailyWageRate?: unknown },
): void {
  if ((body.salary !== undefined || body.dailyWageRate !== undefined) && !canViewPay(req)) {
    throw new ForbiddenError('Your role may not set salary or wage rates');
  }
}

/** Safely extract an integer route param already validated by Zod. */
function parseId(raw: string | string[] | undefined): number {
  return parseInt(String(raw ?? '0'), 10);
}

// ── Create ─────────────────────────────────────────────────────────────────

export async function createEmployee(req: Request, res: Response): Promise<void> {
  const body = req.body as CreateEmployeeInput;
  assertMayWritePay(req, body);

  const employee = await employeeService.create({
    employeeCode: body.employeeCode,
    firstName: body.firstName,
    lastName: body.lastName,
    email: body.email ?? null,
    phone: body.phone ?? null,
    gender: body.gender ?? null,
    dateOfBirth: body.dateOfBirth ?? null,
    joiningDate: body.joiningDate,
    designation: body.designation,
    employmentType: body.employmentType,
    salary: body.salary ?? null,
    dailyWageRate: body.dailyWageRate ?? null,
    status: body.status,
    departmentId: body.departmentId ?? null,
    shiftId: body.shiftId ?? null,
    managerId: body.managerId ?? null,
    userId: body.userId ?? null,
    address: body.address ?? null,
    city: body.city ?? null,
    state: body.state ?? null,
    country: body.country ?? null,
    pincode: body.pincode ?? null,
    emergencyName: body.emergencyName ?? null,
    emergencyPhone: body.emergencyPhone ?? null,
    profileImage: body.profileImage ?? null,
  });

  sendCreated(res, employee, 'Employee created successfully');
}

// ── Get All ────────────────────────────────────────────────────────────────

export async function getAllEmployees(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as EmployeeQueryInput;

  const filters: EmployeeFilters = {
    page: query.page,
    pageSize: query.pageSize,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
    status: query.status,
    includeDeleted: query.includeDeleted,
  };

  if (query.search !== undefined) filters.search = query.search;
  if (query.departmentId !== undefined) filters.departmentId = query.departmentId;
  if (query.designation !== undefined) filters.designation = query.designation;
  if (query.employmentType !== undefined) filters.employmentType = query.employmentType;
  if (query.shiftId !== undefined) filters.shiftId = query.shiftId;
  if (query.managerId !== undefined) filters.managerId = query.managerId;

  const { data: rows, total } = await employeeService.getAll(filters);
  const data = canViewPay(req) ? rows : rows.map(withoutPay);

  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;

  sendSuccess(res, data, 200, undefined, {
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  });
}

// ── Get by ID ──────────────────────────────────────────────────────────────

export async function getEmployeeById(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params['id']);
  const employee = await employeeService.getById(id);
  sendSuccess(res, canViewPay(req) ? employee : withoutPay(employee));
}

// ── Update ─────────────────────────────────────────────────────────────────

export async function updateEmployee(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params['id']);
  const body = req.body as UpdateEmployeeInput;
  assertMayWritePay(req, body);

  const data: UpdateEmployeeData = {};
  if (body.employeeCode !== undefined) data.employeeCode = body.employeeCode;
  if (body.firstName !== undefined) data.firstName = body.firstName;
  if (body.lastName !== undefined) data.lastName = body.lastName;
  if (body.email !== undefined) data.email = body.email;
  if (body.phone !== undefined) data.phone = body.phone;
  if (body.gender !== undefined) data.gender = body.gender;
  if (body.dateOfBirth !== undefined) data.dateOfBirth = body.dateOfBirth;
  if (body.joiningDate !== undefined) data.joiningDate = body.joiningDate;
  if (body.designation !== undefined) data.designation = body.designation;
  if (body.employmentType !== undefined) data.employmentType = body.employmentType;
  if (body.salary !== undefined) data.salary = body.salary;
  if (body.dailyWageRate !== undefined) data.dailyWageRate = body.dailyWageRate;
  if (body.status !== undefined) data.status = body.status;
  if (body.address !== undefined) data.address = body.address;
  if (body.city !== undefined) data.city = body.city;
  if (body.state !== undefined) data.state = body.state;
  if (body.country !== undefined) data.country = body.country;
  if (body.pincode !== undefined) data.pincode = body.pincode;
  if (body.emergencyName !== undefined) data.emergencyName = body.emergencyName;
  if (body.emergencyPhone !== undefined) data.emergencyPhone = body.emergencyPhone;
  if (body.profileImage !== undefined) data.profileImage = body.profileImage;

  const employee = await employeeService.update(id, data);
  sendSuccess(res, employee, 200, 'Employee updated successfully');
}

// ── Soft Delete ────────────────────────────────────────────────────────────

export async function deleteEmployee(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params['id']);
  await employeeService.softDelete(id);
  sendNoContent(res);
}

// ── Restore ────────────────────────────────────────────────────────────────

export async function restoreEmployee(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params['id']);
  const employee = await employeeService.restore(id);
  sendSuccess(res, employee, 200, 'Employee restored successfully');
}

// ── Activate ───────────────────────────────────────────────────────────────

export async function activateEmployee(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params['id']);
  const employee = await employeeService.activate(id);
  sendSuccess(res, employee, 200, 'Employee activated successfully');
}

// ── Deactivate ─────────────────────────────────────────────────────────────

export async function deactivateEmployee(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params['id']);
  const employee = await employeeService.deactivate(id);
  sendSuccess(res, employee, 200, 'Employee deactivated successfully');
}

// ── Assign Department ──────────────────────────────────────────────────────

export async function assignDepartment(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params['id']);
  const { departmentId } = req.body as AssignDepartmentInput;
  const employee = await employeeService.assignDepartment(id, departmentId);
  sendSuccess(res, employee, 200, 'Department assigned successfully');
}

// ── Assign Manager ─────────────────────────────────────────────────────────

export async function assignManager(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params['id']);
  const { managerId } = req.body as AssignManagerInput;
  const employee = await employeeService.assignManager(id, managerId);
  sendSuccess(res, employee, 200, 'Manager assigned successfully');
}

// ── Assign Shift ───────────────────────────────────────────────────────────

export async function assignShift(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params['id']);
  const { shiftId } = req.body as AssignShiftInput;
  const employee = await employeeService.assignShift(id, shiftId);
  sendSuccess(res, employee, 200, 'Shift assigned successfully');
}

// ── Statistics ─────────────────────────────────────────────────────────────

export async function getStatistics(_req: Request, res: Response): Promise<void> {
  const stats = await employeeService.statistics();
  sendSuccess(res, stats);
}

// ── Upload Profile Image ───────────────────────────────────────────────────

export async function uploadProfileImage(req: Request, res: Response): Promise<void> {
  const id = parseInt(String(req.params['id'] ?? '0'), 10);

  if (!req.file) {
    throw new BadRequestError('No image file provided. Use field name "image".');
  }

  const existing = await employeeService.getById(id);
  const imageUrl = await saveProfileImage(req.file);
  const employee = await employeeService.updateProfileImage(id, imageUrl);

  // Only once the new image is in place, so a failure never leaves none
  if (existing.profileImage) {
    await deleteProfileImage(existing.profileImage);
  }
  sendSuccess(res, employee, 200, 'Profile image updated successfully');
}
