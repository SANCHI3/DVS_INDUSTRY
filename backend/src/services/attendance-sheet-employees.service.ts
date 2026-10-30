import { prisma } from '../lib/prismaClient';
import { logger } from '../logger';
import { BadRequestError, ConflictError, ValidationError } from '../errors';
import type { ParsedSheet } from './attendance-sheet';
import {
  checkAttendanceUpload,
  type AttendanceUploadRepository,
  type UploadReport,
} from './attendance-upload.service';

/**
 * Registers employees that an attendance sheet lists but Workforce Management
 * does not have yet — only on an administrator's explicit request, after they
 * have reviewed the sheet's rows and completed what the sheet does not say.
 *
 * Rules:
 *  1. The file is checked again on the server; only IDs the check reports as
 *     unregistered, and without a problem, can be registered.
 *  2. The Employee ID is stored exactly as the sheet writes it.
 *  3. First and last name together must read exactly as the sheet's name, so
 *     the saved name is the sheet's name, only split in two.
 *  4. Designation and joining date are not in the sheet: they come from the
 *     administrator and are never filled in here. A joining date after the
 *     attendance date is refused.
 *  5. All or nothing: if any employee is refused, none is created.
 *  6. No attendance is written. The caller previews the sheet again and
 *     imports attendance as a separate, confirmed step.
 */

export const MAX_SHEET_EMPLOYEES = 500;

export interface SheetEmployeeInput {
  employeeCode: string;
  firstName: string;
  lastName: string;
  designation: string;
  joiningDate: Date;
  employmentType: 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'INTERN';
  shiftId?: number | null | undefined;
  departmentId?: number | null | undefined;
}

export interface SheetEmployeeRepository {
  existingShiftIds(ids: number[]): Promise<number[]>;
  existingDepartmentIds(ids: number[]): Promise<number[]>;
  /** Creates every employee or none. Throws ConflictError if an ID was taken meanwhile. */
  createAll(rows: SheetEmployeeInput[]): Promise<Array<{ id: number; employeeCode: string }>>;
}

export const prismaSheetEmployeeRepository: SheetEmployeeRepository = {
  existingShiftIds: async (ids) =>
    ids.length === 0
      ? []
      : (await prisma.shift.findMany({ where: { id: { in: ids } }, select: { id: true } })).map(
          (s) => s.id,
        ),
  existingDepartmentIds: async (ids) =>
    ids.length === 0
      ? []
      : (
          await prisma.department.findMany({
            where: { id: { in: ids }, deletedAt: null },
            select: { id: true },
          })
        ).map((d) => d.id),
  createAll: (rows) =>
    prisma.$transaction(async (tx) => {
      // Checked again inside the transaction; the unique index backs it up
      const taken = await tx.employee.findMany({
        where: {
          OR: rows.map((r) => ({
            employeeCode: { equals: r.employeeCode, mode: 'insensitive' as const },
          })),
        },
        select: { employeeCode: true },
      });
      if (taken.length > 0) {
        throw new ConflictError(
          `Employee ID ${taken.map((t) => t.employeeCode).join(', ')} was registered by someone else ` +
            'meanwhile. Nothing was saved; check the sheet again.',
        );
      }
      const created: Array<{ id: number; employeeCode: string }> = [];
      for (const r of rows) {
        created.push(
          await tx.employee.create({
            data: {
              employeeCode: r.employeeCode,
              firstName: r.firstName,
              lastName: r.lastName,
              designation: r.designation,
              joiningDate: r.joiningDate,
              employmentType: r.employmentType,
              shiftId: r.shiftId ?? null,
              departmentId: r.departmentId ?? null,
            },
            select: { id: true, employeeCode: true },
          }),
        );
      }
      return created;
    }),
};

const joinName = (first: string, last: string): string =>
  [first.trim(), last.trim()].filter((p) => p !== '').join(' ');

export interface RegisterReport {
  created: Array<{ id: number; employeeCode: string; name: string }>;
  /** The sheet checked again after registering */
  report: UploadReport;
}

export async function registerSheetEmployees(
  sheet: ParsedSheet,
  date: string,
  fileName: string,
  employees: SheetEmployeeInput[],
  uploadRepo: AttendanceUploadRepository,
  repo: SheetEmployeeRepository,
): Promise<RegisterReport> {
  if (employees.length === 0)
    throw new BadRequestError('Choose at least one employee to register.');
  if (employees.length > MAX_SHEET_EMPLOYEES) {
    throw new BadRequestError(`Register at most ${MAX_SHEET_EMPLOYEES} employees at a time.`);
  }

  // Rule 1 — the server's own reading of the file
  const before = await checkAttendanceUpload(sheet, date, fileName, uploadRepo);
  const inSheet = new Map(before.unregistered.map((u) => [u.employeeCode, u]));
  const day = new Date(`${date}T00:00:00.000Z`);

  const shiftIds = [...new Set(employees.flatMap((e) => (e.shiftId ? [e.shiftId] : [])))];
  const departmentIds = [
    ...new Set(employees.flatMap((e) => (e.departmentId ? [e.departmentId] : []))),
  ];
  const shifts = new Set(await repo.existingShiftIds(shiftIds));
  const departments = new Set(await repo.existingDepartmentIds(departmentIds));

  const problems: Array<{ field: string; message: string }> = [];
  const seen = new Set<string>();
  employees.forEach((e, i) => {
    const field = `employees.${i}`;
    const fail = (message: string): void => {
      problems.push({ field, message: `${e.employeeCode}: ${message}` });
    };
    const key = e.employeeCode.toLowerCase();
    if (seen.has(key)) return fail('listed twice.');
    seen.add(key);
    const u = inSheet.get(e.employeeCode);
    if (u === undefined) {
      return fail(
        before.rows.some((r) => r.employeeCode === e.employeeCode)
          ? 'is already registered in Workforce Management.'
          : 'does not appear in this sheet.',
      );
    }
    if (u.problem !== null) return fail(u.problem);
    // Rule 3
    if (joinName(e.firstName, e.lastName) !== u.name) {
      fail(`first and last name must together read exactly "${u.name}", as in the sheet.`);
    }
    // Rule 4
    if (e.joiningDate.getTime() > day.getTime()) {
      fail(
        `joining date ${e.joiningDate.toISOString().slice(0, 10)} is after the attendance date ${date}.`,
      );
    }
    if (e.shiftId && !shifts.has(e.shiftId)) fail('the selected shift no longer exists.');
    if (e.departmentId && !departments.has(e.departmentId)) {
      fail('the selected department no longer exists.');
    }
  });
  // Rule 5
  if (problems.length > 0) {
    throw new ValidationError(
      `No employees were registered: ${problems.length} problem${problems.length === 1 ? '' : 's'} to fix.`,
      problems,
    );
  }

  const created = await repo.createAll(
    employees.map((e) => ({ ...e, firstName: e.firstName.trim(), lastName: e.lastName.trim() })),
  );
  logger.info('Employees registered from an attendance sheet', {
    date,
    fileName,
    count: created.length,
    employeeCodes: created.map((c) => c.employeeCode),
  });
  // Rule 6 — preview again; nothing is imported here
  const report = await checkAttendanceUpload(sheet, date, fileName, uploadRepo);
  return {
    created: created.map((c) => ({ ...c, name: inSheet.get(c.employeeCode)!.name })),
    report,
  };
}
