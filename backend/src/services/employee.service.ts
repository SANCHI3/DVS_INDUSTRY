import { EmployeeRepository } from '../repositories/employee.repository';
import { prisma } from '../lib/prismaClient';
import type {
  EmployeeDto,
  EmployeeListResult,
  EmployeeFilters,
  EmployeeStatistics,
  CreateEmployeeData,
  UpdateEmployeeData,
} from '../interfaces';
import { ConflictError, NotFoundError, BadRequestError } from '../errors';
import { logger } from '../logger';

/**
 * EmployeeService — all business rules live here.
 *
 * Rules enforced:
 *  1. employeeCode must be unique across ALL records (incl. deleted), ignoring case
 *  2. email must be unique if provided (incl. deleted)
 *  3. departmentId must reference an existing, non-deleted department
 *  4. managerId must reference an existing employee (not themselves)
 *  5. shiftId must reference an existing shift
 *  6. userId must reference an existing User if provided
 *  7. Soft-delete only — no hard deletes
 *  8. Cannot update/activate/deactivate a deleted employee
 *  9. Cannot restore if employee code conflicts with an active employee
 * 10. Manager assignment: manager cannot be the same employee
 */
export class EmployeeService {
  private readonly repo: EmployeeRepository;

  constructor() {
    this.repo = new EmployeeRepository();
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async create(data: CreateEmployeeData): Promise<EmployeeDto> {
    // Rule 1 — unique employeeCode, ignoring case
    const codeExists = await this.repo.findByEmployeeCodeInsensitive(data.employeeCode);
    if (codeExists !== null) {
      throw new ConflictError(
        `Employee ID "${data.employeeCode}" is already used by ${codeExists.employeeCode}` +
          `${codeExists.deletedAt !== null ? ' (a removed employee)' : ''}`,
      );
    }

    // Rule 2 — unique email
    if (data.email !== null && data.email !== undefined) {
      const emailExists = await this.repo.findByEmail(data.email);
      if (emailExists !== null) {
        throw new ConflictError(`Employee with email "${data.email}" already exists`);
      }
    }

    // Rule 3 — department must exist
    if (data.departmentId !== null && data.departmentId !== undefined) {
      await this.assertDepartmentExists(data.departmentId);
    }

    // Rule 4 — manager must exist
    if (data.managerId !== null && data.managerId !== undefined) {
      await this.assertManagerExists(data.managerId);
    }

    // Rule 5 — shift must exist
    if (data.shiftId !== null && data.shiftId !== undefined) {
      await this.assertShiftExists(data.shiftId);
    }

    // Rule 6 — userId must reference existing User
    if (data.userId !== null && data.userId !== undefined) {
      await this.assertUserExists(data.userId);
    }

    const employee = await this.repo.create(data);
    logger.info('Employee created', {
      id: employee.id,
      code: employee.employeeCode,
    });
    return employee;
  }

  // ── Update ────────────────────────────────────────────────────────────────

  async update(id: number, data: UpdateEmployeeData): Promise<EmployeeDto> {
    const existing = await this.getByIdOrThrow(id);

    if (existing.deletedAt !== null) {
      throw new BadRequestError('Cannot update a deleted employee. Restore them first.');
    }

    // Rule 1 — a changed code must still be unique (incl. deleted)
    if (data.employeeCode !== undefined && data.employeeCode !== existing.employeeCode) {
      const codeConflict = await this.repo.findByEmployeeCodeInsensitive(data.employeeCode);
      if (codeConflict !== null && codeConflict.id !== id) {
        throw new ConflictError(
          `Employee ID "${data.employeeCode}" is already used by ${codeConflict.employeeCode}`,
        );
      }
    }

    // Unique email check (skip if unchanged)
    if (data.email !== undefined && data.email !== null && data.email !== existing.email) {
      const emailConflict = await this.repo.findByEmail(data.email);
      if (emailConflict !== null && emailConflict.id !== id) {
        throw new ConflictError(`Employee with email "${data.email}" already exists`);
      }
    }

    const employee = await this.repo.update(id, data);
    logger.info('Employee updated', { id });
    return employee;
  }

  // ── Get by ID ─────────────────────────────────────────────────────────────

  async getById(id: number): Promise<EmployeeDto> {
    return this.getByIdOrThrow(id);
  }

  // ── Get All ───────────────────────────────────────────────────────────────

  async getAll(filters: EmployeeFilters): Promise<EmployeeListResult> {
    return this.repo.findAll(filters);
  }

  // ── Soft Delete ───────────────────────────────────────────────────────────

  async softDelete(id: number): Promise<EmployeeDto> {
    const existing = await this.getByIdOrThrow(id);

    if (existing.deletedAt !== null) {
      throw new BadRequestError('Employee is already deleted');
    }

    const deleted = await this.repo.softDelete(id);
    logger.info('Employee soft-deleted', { id });
    return deleted;
  }

  // ── Restore ───────────────────────────────────────────────────────────────

  async restore(id: number): Promise<EmployeeDto> {
    const existing = await this.getByIdOrThrow(id);

    if (existing.deletedAt === null) {
      throw new BadRequestError('Employee is not deleted — nothing to restore');
    }

    // Rule 9 — check code conflict with active employees
    const codeConflict = await this.repo.findByEmployeeCode(existing.employeeCode);
    if (codeConflict !== null && codeConflict.id !== id && codeConflict.deletedAt === null) {
      throw new ConflictError(
        `Cannot restore: another active employee already uses code "${existing.employeeCode}"`,
      );
    }

    // Email conflict check
    if (existing.email !== null) {
      const emailConflict = await this.repo.findByEmail(existing.email);
      if (emailConflict !== null && emailConflict.id !== id && emailConflict.deletedAt === null) {
        throw new ConflictError(
          `Cannot restore: another active employee already uses email "${existing.email}"`,
        );
      }
    }

    const restored = await this.repo.restore(id);
    logger.info('Employee restored', { id });
    return restored;
  }

  // ── Activate ──────────────────────────────────────────────────────────────

  async activate(id: number): Promise<EmployeeDto> {
    const existing = await this.getByIdOrThrow(id);

    if (existing.deletedAt !== null) {
      throw new BadRequestError('Cannot activate a deleted employee. Restore them first.');
    }

    if (existing.status === 'ACTIVE') {
      throw new BadRequestError('Employee is already active');
    }

    const activated = await this.repo.activate(id);
    logger.info('Employee activated', { id });
    return activated;
  }

  // ── Deactivate ────────────────────────────────────────────────────────────

  async deactivate(id: number): Promise<EmployeeDto> {
    const existing = await this.getByIdOrThrow(id);

    if (existing.deletedAt !== null) {
      throw new BadRequestError('Cannot deactivate a deleted employee.');
    }

    if (existing.status === 'INACTIVE') {
      throw new BadRequestError('Employee is already inactive');
    }

    const deactivated = await this.repo.deactivate(id);
    logger.info('Employee deactivated', { id });
    return deactivated;
  }

  // ── Assign Department ─────────────────────────────────────────────────────

  async assignDepartment(id: number, departmentId: number | null): Promise<EmployeeDto> {
    await this.getByIdOrThrow(id);

    if (departmentId !== null) {
      await this.assertDepartmentExists(departmentId);
    }

    const employee = await this.repo.assignDepartment(id, departmentId);
    logger.info('Employee department assigned', { id, departmentId });
    return employee;
  }

  // ── Assign Manager ────────────────────────────────────────────────────────

  async assignManager(id: number, managerId: number | null): Promise<EmployeeDto> {
    await this.getByIdOrThrow(id);

    if (managerId !== null) {
      // Rule 10 — cannot self-manage
      if (managerId === id) {
        throw new BadRequestError('An employee cannot be their own manager');
      }
      await this.assertManagerExists(managerId);
    }

    const employee = await this.repo.assignManager(id, managerId);
    logger.info('Employee manager assigned', { id, managerId });
    return employee;
  }

  // ── Assign Shift ──────────────────────────────────────────────────────────

  async assignShift(id: number, shiftId: number | null): Promise<EmployeeDto> {
    await this.getByIdOrThrow(id);

    if (shiftId !== null) {
      await this.assertShiftExists(shiftId);
    }

    const employee = await this.repo.assignShift(id, shiftId);
    logger.info('Employee shift assigned', { id, shiftId });
    return employee;
  }

  // ── Update Profile Image ─────────────────────────────────────────────────

  async updateProfileImage(id: number, imageUrl: string): Promise<EmployeeDto> {
    const existing = await this.getByIdOrThrow(id);
    if (existing.deletedAt !== null) {
      throw new BadRequestError('Cannot update a deleted employee.');
    }
    const employee = await this.repo.update(id, { profileImage: imageUrl });
    logger.info('Employee profile image updated', { id });
    return employee;
  }

  // ── Statistics ────────────────────────────────────────────────────────────

  async statistics(): Promise<EmployeeStatistics> {
    return this.repo.statistics();
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async getByIdOrThrow(id: number): Promise<EmployeeDto> {
    // findById includes deleted records (no deletedAt filter in repo)
    const employee = await this.repo.findById(id);
    if (employee === null) {
      throw new NotFoundError(`Employee with id ${id} not found`);
    }
    return employee;
  }

  private async assertDepartmentExists(departmentId: number): Promise<void> {
    const dept = await prisma.department.findFirst({
      where: { id: departmentId, deletedAt: null },
      select: { id: true },
    });
    if (dept === null) {
      throw new NotFoundError(`Department with id ${departmentId} not found or has been deleted`);
    }
  }

  private async assertManagerExists(managerId: number): Promise<void> {
    const manager = await prisma.employee.findFirst({
      where: { id: managerId, deletedAt: null },
      select: { id: true },
    });
    if (manager === null) {
      throw new NotFoundError(`Manager (employee) with id ${managerId} not found`);
    }
  }

  private async assertShiftExists(shiftId: number): Promise<void> {
    const shift = await prisma.shift.findUnique({
      where: { id: shiftId },
      select: { id: true },
    });
    if (shift === null) {
      throw new NotFoundError(`Shift with id ${shiftId} not found`);
    }
  }

  private async assertUserExists(userId: number): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (user === null) {
      throw new NotFoundError(`User with id ${userId} not found. Create the user account first.`);
    }
  }
}
