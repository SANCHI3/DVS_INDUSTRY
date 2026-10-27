import { WorkforceRepository } from '../repositories/workforce.repository';
import { prisma } from '../lib/prismaClient';
import type {
  ShiftDto,
  ShiftListResult,
  ShiftFilters,
  CreateShiftData,
  UpdateShiftData,
  AttendanceDto,
  AttendanceListResult,
  AttendanceFilters,
  CreateAttendanceData,
  UpdateAttendanceData,
  DailyAttendanceSummary,
  AttendanceTrendEntry,
  BulkAttendanceEntry,
  EmployeeDailyOutputDto,
  EmployeeDailyOutputListResult,
  EmployeeDailyOutputFilters,
  CreateEmployeeDailyOutputData,
  UpdateEmployeeDailyOutputData,
  EmployeeOutputSummary,
} from '../interfaces';
import { ConflictError, NotFoundError, BadRequestError } from '../errors';
import { logger } from '../logger';

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * WorkforceService — business rules:
 *
 * Shifts:
 *  1. Name must be unique
 *  2. Cannot delete a shift that has employees assigned
 *
 * Attendance:
 *  3. Employee must exist and not be deleted
 *  4. One record per employee per day — a second create is refused (409),
 *     never merged; existing records change only through PATCH
 *  5. Clock-out must be after clock-in
 *  6. Cannot clock out if no clock-in exists
 *  7. Cannot create future-dated attendance (optional strict mode — soft warn)
 *
 * Employee daily output:
 *  8. One record per employee per day — a second create is refused (409)
 *  9. Not dated in the future
 * 10. Never added to work-order (company) production totals
 */
export class WorkforceService {
  private readonly repo: WorkforceRepository;

  constructor() {
    this.repo = new WorkforceRepository();
  }

  // ══ SHIFTS ════════════════════════════════════════════════════════════════

  async createShift(data: CreateShiftData): Promise<ShiftDto> {
    const conflict = await this.repo.findShiftByName(data.name);
    if (conflict !== null) {
      throw new ConflictError(`A shift named "${data.name}" already exists`);
    }
    const shift = await this.repo.createShift(data);
    logger.info('Shift created', { id: shift.id, name: shift.name });
    return shift;
  }

  async updateShift(id: number, data: UpdateShiftData): Promise<ShiftDto> {
    await this.getShiftOrThrow(id);

    if (data.name !== undefined) {
      const conflict = await this.repo.findShiftByName(data.name);
      if (conflict !== null && conflict.id !== id) {
        throw new ConflictError(`A shift named "${data.name}" already exists`);
      }
    }

    const shift = await this.repo.updateShift(id, data);
    logger.info('Shift updated', { id });
    return shift;
  }

  async deleteShift(id: number): Promise<void> {
    const shift = await this.getShiftOrThrow(id);

    // Rule 2 — cannot delete if employees are assigned
    if (shift._count && shift._count.employees > 0) {
      throw new BadRequestError(
        `Cannot delete shift "${shift.name}" — ${shift._count.employees} employee(s) are assigned. ` +
          'Re-assign them to another shift first.',
      );
    }

    await this.repo.deleteShift(id);
    logger.info('Shift deleted', { id });
  }

  async getShiftById(id: number): Promise<ShiftDto> {
    return this.getShiftOrThrow(id);
  }

  async getAllShifts(filters: ShiftFilters): Promise<ShiftListResult> {
    return this.repo.findAllShifts(filters);
  }

  // ══ ATTENDANCE ════════════════════════════════════════════════════════════

  async createAttendance(data: CreateAttendanceData): Promise<AttendanceDto> {
    await this.assertEmployeeExists(data.employeeId);
    this.validateClockTimes(data.clockIn, data.clockOut);

    // Rule 4 — never overwrite an existing day
    const existing = await this.repo.findAttendanceByEmployeeAndDate(data.employeeId, data.date);
    if (existing !== null) {
      throw new ConflictError(
        `Attendance for ${existing.employee.employeeCode} on ${isoDay(data.date)} already exists ` +
          `(${existing.status}). Edit the existing record instead.`,
      );
    }
    const attendance = await this.repo.createAttendance(data);
    logger.info('Attendance recorded', {
      employeeId: data.employeeId,
      date: data.date,
      status: data.status,
    });
    return attendance;
  }

  async updateAttendance(id: number, data: UpdateAttendanceData): Promise<AttendanceDto> {
    const existing = await this.repo.findAttendanceById(id);
    if (existing === null) {
      throw new NotFoundError(`Attendance record with id ${id} not found`);
    }

    // Validate clock times if both are being updated
    const newClockIn = data.clockIn !== undefined ? data.clockIn : existing.clockIn;
    const newClockOut = data.clockOut !== undefined ? data.clockOut : existing.clockOut;
    this.validateClockTimes(newClockIn, newClockOut);

    const updated = await this.repo.updateAttendance(id, data);
    logger.info('Attendance updated', { id });
    return updated;
  }

  async getAttendanceById(id: number): Promise<AttendanceDto> {
    const record = await this.repo.findAttendanceById(id);
    if (record === null) {
      throw new NotFoundError(`Attendance record with id ${id} not found`);
    }
    return record;
  }

  async getAllAttendance(filters: AttendanceFilters): Promise<AttendanceListResult> {
    return this.repo.findAllAttendance(filters);
  }

  async deleteAttendance(id: number): Promise<void> {
    const existing = await this.repo.findAttendanceById(id);
    if (existing === null) {
      throw new NotFoundError(`Attendance record with id ${id} not found`);
    }
    await this.repo.deleteAttendance(id);
    logger.info('Attendance deleted', { id });
  }

  // ── Clock in ──────────────────────────────────────────────────────────────

  async clockIn(
    employeeId: number,
    clockIn: Date,
    remarks?: string | null,
  ): Promise<AttendanceDto> {
    await this.assertEmployeeExists(employeeId);

    // Check if already clocked in today
    const today = new Date(clockIn);
    today.setUTCHours(0, 0, 0, 0);
    const existing = await this.repo.findAttendanceByEmployeeAndDate(employeeId, today);
    if (existing !== null && existing.clockIn !== null) {
      throw new BadRequestError(
        `Employee already clocked in today at ${existing.clockIn.toLocaleTimeString('en-IN')}`,
      );
    }

    const attendance = await this.repo.clockIn(employeeId, clockIn, remarks);
    logger.info('Employee clocked in', { employeeId, clockIn });
    return attendance;
  }

  // ── Clock out ─────────────────────────────────────────────────────────────

  async clockOut(
    attendanceId: number,
    clockOut: Date,
    remarks?: string | null,
  ): Promise<AttendanceDto> {
    const existing = await this.repo.findAttendanceById(attendanceId);
    if (existing === null) {
      throw new NotFoundError(`Attendance record with id ${attendanceId} not found`);
    }

    // Rule 6 — must have clocked in
    if (existing.clockIn === null) {
      throw new BadRequestError(
        'Cannot clock out — no clock-in time recorded for this attendance entry',
      );
    }

    // Rule 5 — clock-out must be after clock-in
    if (clockOut <= existing.clockIn) {
      throw new BadRequestError('Clock-out time must be after clock-in time');
    }

    const attendance = await this.repo.clockOut(attendanceId, clockOut, remarks);
    logger.info('Employee clocked out', {
      attendanceId,
      workingHours: attendance.workingHours,
    });
    return attendance;
  }

  // ── Bulk attendance ───────────────────────────────────────────────────────

  async bulkMark(
    date: Date,
    entries: BulkAttendanceEntry[],
  ): Promise<{ created: number; updated: number; skippedEmployeeIds: number[] }> {
    // Validate all employee IDs exist
    const ids = [...new Set(entries.map((e) => e.employeeId))];
    if (ids.length !== entries.length) {
      throw new BadRequestError('Each employee may appear only once per bulk request');
    }
    const existing = await prisma.employee.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true },
    });
    const foundIds = new Set(existing.map((e) => e.id));
    const missing = ids.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new NotFoundError(`Employees not found: ${missing.join(', ')}`);
    }

    // Rule 4 — existing records are skipped, not overwritten
    const result = await this.repo.bulkCreate(
      date,
      entries.map((e) => ({
        employeeId: e.employeeId,
        status: e.status,
        clockIn: e.clockIn ?? null,
        clockOut: e.clockOut ?? null,
        remarks: e.remarks ?? null,
      })),
    );
    logger.info('Bulk attendance recorded', {
      date,
      created: result.created,
      skipped: result.skippedEmployeeIds.length,
    });
    return result;
  }

  // ── Summary & trend ───────────────────────────────────────────────────────

  async getDailySummary(date?: Date, departmentId?: number): Promise<DailyAttendanceSummary> {
    return this.repo.getDailySummary(date ?? new Date(), departmentId);
  }

  async getAttendanceTrend(
    days = 7,
    departmentId?: number,
    endDate?: Date,
  ): Promise<AttendanceTrendEntry[]> {
    return this.repo.getAttendanceTrend(days, departmentId, endDate);
  }

  // ══ EMPLOYEE DAILY OUTPUT ═════════════════════════════════════════════════

  async createEmployeeOutput(data: CreateEmployeeDailyOutputData): Promise<EmployeeDailyOutputDto> {
    await this.assertEmployeeExists(data.employeeId);
    this.assertNotFuture(data.date);

    // Rule 8
    const existing = await this.repo.findEmployeeOutputByEmployeeAndDate(
      data.employeeId,
      data.date,
    );
    if (existing !== null) {
      throw new ConflictError(
        `Performance for ${existing.employee.employeeCode} on ${isoDay(data.date)} is already ` +
          'recorded. Edit the existing record instead.',
      );
    }

    const output = await this.repo.createEmployeeOutput(data);
    logger.info('Employee output recorded', { employeeId: data.employeeId, date: data.date });
    return output;
  }

  async updateEmployeeOutput(
    id: number,
    data: UpdateEmployeeDailyOutputData,
  ): Promise<EmployeeDailyOutputDto> {
    await this.getEmployeeOutputById(id);
    const updated = await this.repo.updateEmployeeOutput(id, data);
    logger.info('Employee output updated', { id });
    return updated;
  }

  async getEmployeeOutputById(id: number): Promise<EmployeeDailyOutputDto> {
    const record = await this.repo.findEmployeeOutputById(id);
    if (record === null) {
      throw new NotFoundError(`Performance record with id ${id} not found`);
    }
    return record;
  }

  async getAllEmployeeOutputs(
    filters: EmployeeDailyOutputFilters,
  ): Promise<EmployeeDailyOutputListResult> {
    return this.repo.findAllEmployeeOutputs(filters);
  }

  async deleteEmployeeOutput(id: number): Promise<void> {
    await this.getEmployeeOutputById(id);
    await this.repo.deleteEmployeeOutput(id);
    logger.info('Employee output deleted', { id });
  }

  async getEmployeeOutputSummary(
    range: { date?: Date | undefined; fromDate?: Date | undefined; toDate?: Date | undefined },
    departmentId?: number,
  ): Promise<EmployeeOutputSummary> {
    const today = new Date();
    const from = range.date ?? range.fromDate ?? range.toDate ?? today;
    const to = range.date ?? range.toDate ?? range.fromDate ?? today;
    if (from > to) throw new BadRequestError('fromDate must be on or before toDate');
    if (to.getTime() - from.getTime() > 366 * 86_400_000) {
      throw new BadRequestError('The date range may not exceed one year');
    }
    return this.repo.getEmployeeOutputSummary(from, to, departmentId);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /** Rule 9 — allows "today" in any timezone ahead of UTC (e.g. IST). */
  private assertNotFuture(date: Date): void {
    const latest = new Date();
    latest.setUTCHours(0, 0, 0, 0);
    latest.setUTCDate(latest.getUTCDate() + 1);
    const day = new Date(date);
    day.setUTCHours(0, 0, 0, 0);
    if (day > latest) throw new BadRequestError('Performance cannot be recorded for a future date');
  }

  private async getShiftOrThrow(id: number): Promise<ShiftDto> {
    const shift = await this.repo.findShiftById(id);
    if (shift === null) throw new NotFoundError(`Shift with id ${id} not found`);
    return shift;
  }

  private async assertEmployeeExists(employeeId: number): Promise<void> {
    const emp = await prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      select: { id: true },
    });
    if (emp === null) {
      throw new NotFoundError(`Employee with id ${employeeId} not found`);
    }
  }

  private validateClockTimes(clockIn?: Date | null, clockOut?: Date | null): void {
    if (clockIn && clockOut && clockOut <= clockIn) {
      throw new BadRequestError('Clock-out time must be after clock-in time');
    }
  }
}
