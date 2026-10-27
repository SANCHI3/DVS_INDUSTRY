import type { AttendanceStatus } from '../interfaces';
import { prisma } from '../lib/prismaClient';
import { logger } from '../logger';
import { BadRequestError } from '../errors';
import {
  AttendanceSheetError,
  mapAttendanceStatus,
  parseAttendanceSheet,
  parseClock,
  parseOvertime,
  type ParsedSheet,
} from './attendance-sheet';

/**
 * Excel attendance upload for one day.
 *
 * Rules:
 *  1. Rows are matched to employees by Employee ID only (case-insensitive).
 *     A name, when present, must agree with that employee; it is never used to
 *     find one. Employees are never created from the sheet.
 *  2. A row date must equal the selected date; a blank date means the selected date.
 *  3. Insert-only: an employee who already has attendance that day is skipped
 *     and reported, never overwritten.
 *  4. The same employee twice in the sheet: identical rows import once; rows
 *     that disagree are all rejected — the sheet must say which is right.
 *  5. Preview and import run the same checks on the server. The import checks
 *     the file again; nothing the browser says is trusted.
 *  6. A daily report that declares its own date is refused for any other date.
 *  7. Punch times are kept as check-in/out and hours worked. Attendance has no
 *     overtime field, so overtime is kept in the remarks (and in the hours),
 *     never dropped; a non-working day with punches or overtime is rejected.
 */

/** The file is for another date; the message names it as (YYYY-MM-DD) for the UI */
export class SheetDateMismatchError extends BadRequestError {
  constructor(message: string) {
    super(message, 'SHEET_DATE_MISMATCH');
  }
}

const WORKING: AttendanceStatus[] = ['PRESENT', 'LATE', 'HALF_DAY'];

export type UploadRowResult = 'VALID' | 'EXISTING' | 'DUPLICATE' | 'REJECTED';

export interface UploadRow {
  row: number;
  employeeCode: string;
  /** The employee's saved name when matched, otherwise the name in the sheet */
  employeeName: string;
  employeeId: number | null;
  date: string | null;
  rawStatus: string;
  status: AttendanceStatus | null;
  result: UploadRowResult;
  reason: string | null;
  /** Punch times as HH:MM, overtime as H:MM, from the sheet */
  clockIn: string | null;
  clockOut: string | null;
  overtime: string | null;
  /** What happens to data that has no field of its own */
  note: string | null;
}

export interface UploadSummary {
  totalRows: number;
  valid: number;
  existing: number;
  duplicate: number;
  rejected: number;
  blankRows: number;
}

export interface UploadReport {
  kind: ParsedSheet['kind'];
  date: string;
  fileName: string;
  sheetName: string;
  columns: ParsedSheet['columns'];
  rows: UploadRow[];
  summary: UploadSummary;
}

export interface ImportReport extends UploadReport {
  imported: number;
}

export interface UploadEmployee {
  id: number;
  employeeCode: string;
  firstName: string;
  lastName: string;
  status: string;
  deletedAt: Date | null;
}

export interface AttendanceUploadRepository {
  /** Employees whose code equals any of `codes`, ignoring case, removed ones included */
  findEmployeesByCodes(codes: string[]): Promise<UploadEmployee[]>;
  findExisting(
    employeeIds: number[],
    date: Date,
  ): Promise<Array<{ employeeId: number; status: AttendanceStatus }>>;
  /** Inserts, skipping any that now exist; returns the employee ids actually inserted */
  insert(
    rows: Array<{
      employeeId: number;
      date: Date;
      status: AttendanceStatus;
      clockIn: Date | null;
      clockOut: Date | null;
      workingHours: number | null;
      remarks: string;
    }>,
  ): Promise<number[]>;
}

export const prismaAttendanceUploadRepository: AttendanceUploadRepository = {
  findEmployeesByCodes: (codes) =>
    codes.length === 0
      ? Promise.resolve([])
      : prisma.employee.findMany({
          where: {
            OR: codes.map((c) => ({ employeeCode: { equals: c, mode: 'insensitive' as const } })),
          },
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
            status: true,
            deletedAt: true,
          },
        }),
  findExisting: (employeeIds, date) =>
    employeeIds.length === 0
      ? Promise.resolve([])
      : prisma.attendance.findMany({
          where: { date, employeeId: { in: employeeIds } },
          select: { employeeId: true, status: true },
        }),
  insert: async (rows) => {
    if (rows.length === 0) return [];
    // skipDuplicates covers a record written between the check and the insert
    const created = await prisma.attendance.createManyAndReturn({
      data: rows,
      skipDuplicates: true,
      select: { employeeId: true },
    });
    return created.map((r) => r.employeeId);
  },
};

const fullName = (e: Pick<UploadEmployee, 'firstName' | 'lastName'>): string =>
  [e.firstName, e.lastName].filter((p) => p.trim() !== '').join(' ');

const comparableName = (s: string): string =>
  s.toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();

function formatDay(iso: string): string {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  HALF_DAY: 'Half day',
  LATE: 'Late',
  LEAVE: 'Leave',
  WEEK_OFF: 'Week off',
};

/** Validates the selected import date: a real day, not in the future. */
export function assertImportDate(date: string, now: Date = new Date()): Date {
  const d = new Date(`${date}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(d.getTime()) ||
    d.toISOString().slice(0, 10) !== date
  ) {
    throw new BadRequestError('Select a valid attendance date.');
  }
  // One day of slack: the server runs on UTC while the factory is on IST
  if (d.getTime() > now.getTime() + 86_400_000) {
    throw new BadRequestError(
      `Attendance cannot be imported for a future date (${formatDay(date)}).`,
    );
  }
  return d;
}

export function parseUpload(buffer: Buffer, date?: string): ParsedSheet {
  try {
    return parseAttendanceSheet(buffer, date);
  } catch (err) {
    if (err instanceof AttendanceSheetError) {
      if (err.sheetDate !== undefined) {
        throw new SheetDateMismatchError(`${err.message} (${err.sheetDate})`);
      }
      throw new BadRequestError(err.message);
    }
    throw err;
  }
}

const hhmm = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const duration = (minutes: number): string =>
  `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;

/** Local factory time on `date` -> instant, using the uploader's UTC offset */
function instant(date: string, minutes: number, utcOffsetMinutes: number, plusDays = 0): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + plusDays) + (minutes - utcOffsetMinutes) * 60_000);
}

/** Checks every row (rules 1–4) without writing anything. */
export async function checkAttendanceUpload(
  sheet: ParsedSheet,
  date: string,
  fileName: string,
  repo: AttendanceUploadRepository,
): Promise<UploadReport> {
  const day = assertImportDate(date);
  if (sheet.sheetDate !== null && sheet.sheetDate !== date) {
    throw new SheetDateMismatchError(
      `This sheet is the attendance for ${formatDay(sheet.sheetDate)} (${sheet.sheetDate}), but the ` +
        `selected date is ${formatDay(date)}. Select ${formatDay(sheet.sheetDate)} to import it.`,
    );
  }

  const rows: UploadRow[] = sheet.rows.map((r) => ({
    row: r.row,
    employeeCode: r.employeeCode,
    employeeName: r.employeeName,
    employeeId: null,
    date: r.date === '' ? date : r.date,
    rawStatus: r.status,
    status: null,
    result: 'VALID',
    reason: null,
    clockIn: null,
    clockOut: null,
    overtime: null,
    note: null,
  }));
  const reject = (row: UploadRow, reason: string): void => {
    row.result = 'REJECTED';
    row.reason = reason;
  };

  // Row-level checks
  sheet.rows.forEach((src, i) => {
    const row = rows[i]!;
    if (src.heldBack !== undefined) {
      reject(row, src.heldBack);
      return;
    }
    if (src.employeeCode === '') {
      reject(row, 'Employee ID is missing. Rows are matched by Employee ID only, never by name.');
      return;
    }
    if (src.date === null) {
      reject(
        row,
        `"${src.rawDate}" is not a valid date. Use 27/10/2026, 2026-10-27, or leave it blank.`,
      );
      return;
    }
    if (src.date !== '' && src.date !== date) {
      reject(
        row,
        `Row date ${formatDay(src.date)} does not match the selected attendance date ${formatDay(date)}.`,
      );
      return;
    }
    const mapped = mapAttendanceStatus(src.status);
    if (!mapped.ok) {
      reject(row, mapped.reason);
      return;
    }
    row.status = mapped.status;

    // Rule 7 — punch times and overtime
    const inMin = parseClock(src.inTime);
    const outMin = parseClock(src.outTime);
    const otMin = parseOvertime(src.overtime);
    if (Number.isNaN(inMin)) {
      reject(row, `In time "${src.inTime}" is not a valid time (HH:MM).`);
      return;
    }
    if (Number.isNaN(outMin)) {
      reject(row, `Out time "${src.outTime}" is not a valid time (HH:MM).`);
      return;
    }
    if (Number.isNaN(otMin)) {
      reject(row, `Overtime "${src.overtime}" is not a valid duration (H:MM).`);
      return;
    }
    const hasOvertime = otMin !== null && otMin > 0;
    if (!WORKING.includes(mapped.status) && (inMin !== null || outMin !== null || hasOvertime)) {
      reject(
        row,
        `Marked ${STATUS_LABEL[mapped.status]} but the sheet has punch times or overtime. ` +
          'Check the day before importing.',
      );
      return;
    }
    if (outMin !== null && inMin === null) {
      reject(row, 'The sheet has an out time but no in time.');
      return;
    }
    if (hasOvertime && inMin !== null && outMin !== null) {
      const worked = outMin > inMin ? outMin - inMin : outMin + 1440 - inMin;
      if (otMin > worked) {
        reject(
          row,
          `Overtime ${duration(otMin)} is longer than the ${duration(worked)} between the punches.`,
        );
        return;
      }
    }
    row.clockIn = inMin === null ? null : hhmm(inMin);
    row.clockOut = outMin === null ? null : hhmm(outMin);
    if (hasOvertime) {
      row.overtime = duration(otMin);
      row.note =
        `Overtime ${row.overtime} is saved in the remarks and included in the hours worked ` +
        '(attendance has no overtime field).';
    }
  });

  // Rule 1 — match by Employee ID
  const codes = [
    ...new Set(rows.filter((r) => r.employeeCode !== '').map((r) => r.employeeCode.toLowerCase())),
  ];
  const employees = await repo.findEmployeesByCodes(codes);
  const byCode = new Map<string, UploadEmployee[]>();
  for (const e of employees) {
    const key = e.employeeCode.toLowerCase();
    byCode.set(key, [...(byCode.get(key) ?? []), e]);
  }
  for (const row of rows) {
    if (row.employeeCode === '') continue;
    const matches = byCode.get(row.employeeCode.toLowerCase()) ?? [];
    const active = matches.filter((e) => e.deletedAt === null && e.status !== 'TERMINATED');
    const sheetName = row.employeeName;
    if (active.length === 1) {
      const e = active[0]!;
      row.employeeId = e.id;
      row.employeeName = fullName(e);
      if (
        row.result === 'VALID' &&
        sheetName !== '' &&
        comparableName(sheetName) !== comparableName(fullName(e))
      ) {
        reject(
          row,
          `The name "${sheetName}" does not match ${e.employeeCode}, who is ${fullName(e)}. Check the Employee ID.`,
        );
      }
      continue;
    }
    if (row.result !== 'VALID') continue;
    if (active.length > 1) {
      reject(
        row,
        `More than one employee has the ID ${row.employeeCode}. Fix the duplicate IDs before importing.`,
      );
    } else if (matches.length > 0) {
      reject(
        row,
        `${matches[0]!.employeeCode} belongs to a removed worker. Attendance is not recorded for removed workers.`,
      );
    } else {
      reject(
        row,
        `No employee has the ID ${row.employeeCode}. Add the worker on Workforce Management first; the import never creates employees.`,
      );
    }
  }

  // Rule 4 — the same employee more than once in the sheet
  const byEmployee = new Map<number, UploadRow[]>();
  for (const row of rows) {
    if (row.result !== 'VALID' || row.employeeId === null) continue;
    byEmployee.set(row.employeeId, [...(byEmployee.get(row.employeeId) ?? []), row]);
  }
  for (const group of byEmployee.values()) {
    if (group.length < 2) continue;
    const first = group[0]!;
    const rowList = group.map((r) => r.row).join(', ');
    if (group.every((r) => r.status === first.status)) {
      for (const r of group.slice(1)) {
        r.result = 'DUPLICATE';
        r.reason = `Repeats row ${first.row} for ${first.employeeCode}. Imported once.`;
      }
    } else {
      const marks = [...new Set(group.map((r) => r.rawStatus))].join(' vs ');
      for (const r of group) {
        reject(
          r,
          `Rows ${rowList} give ${first.employeeCode} different statuses (${marks}). Keep only the correct row.`,
        );
      }
    }
  }

  // Rule 3 — never overwrite
  const pending = rows.filter((r) => r.result === 'VALID');
  const existing = await repo.findExisting([...new Set(pending.map((r) => r.employeeId!))], day);
  const existingStatus = new Map(existing.map((e) => [e.employeeId, e.status]));
  for (const row of pending) {
    const status = existingStatus.get(row.employeeId!);
    if (status !== undefined) {
      row.result = 'EXISTING';
      row.reason = `Already recorded as ${STATUS_LABEL[status]} on ${formatDay(date)}. Left unchanged.`;
    }
  }

  return {
    kind: sheet.kind,
    date,
    fileName,
    sheetName: sheet.sheetName,
    columns: sheet.columns,
    rows,
    summary: summarise(rows, sheet.blankRows),
  };
}

function summarise(rows: UploadRow[], blankRows: number): UploadSummary {
  const count = (r: UploadRowResult): number => rows.filter((x) => x.result === r).length;
  return {
    totalRows: rows.length,
    valid: count('VALID'),
    existing: count('EXISTING'),
    duplicate: count('DUPLICATE'),
    rejected: count('REJECTED'),
    blankRows,
  };
}

/** Re-checks the file, then inserts only the rows that are still valid. */
export async function importAttendanceUpload(
  sheet: ParsedSheet,
  date: string,
  fileName: string,
  repo: AttendanceUploadRepository,
  utcOffsetMinutes = 330,
): Promise<ImportReport> {
  const report = await checkAttendanceUpload(sheet, date, fileName, repo);
  const day = new Date(`${date}T00:00:00.000Z`);
  const source = fileName.replace(/[^\w .()-]/g, '_').slice(0, 80);
  const toInsert = report.rows.filter((r) => r.result === 'VALID');
  const inserted = new Set(
    toInsert.length === 0
      ? []
      : await repo.insert(
          toInsert.map((r) => {
            const inMin = r.clockIn === null ? null : parseClock(r.clockIn);
            const outMin = r.clockOut === null ? null : parseClock(r.clockOut);
            const clockIn = inMin === null ? null : instant(date, inMin, utcOffsetMinutes);
            // A night shift ends the next day
            const clockOut =
              outMin === null || inMin === null
                ? null
                : instant(date, outMin, utcOffsetMinutes, outMin <= inMin ? 1 : 0);
            const workingHours =
              clockIn && clockOut
                ? Math.round(((clockOut.getTime() - clockIn.getTime()) / 3_600_000) * 100) / 100
                : null;
            const overtime = r.overtime ? ` · Overtime ${r.overtime}` : '';
            return {
              employeeId: r.employeeId!,
              date: day,
              status: r.status!,
              clockIn,
              clockOut,
              workingHours,
              remarks: `Imported from Excel: ${source}, row ${r.row}${overtime}`,
            };
          }),
        ),
  );
  for (const row of toInsert) {
    if (!inserted.has(row.employeeId!)) {
      row.result = 'EXISTING';
      row.reason = 'Recorded by someone else while the file was being imported. Left unchanged.';
    }
  }
  const summary = summarise(report.rows, report.summary.blankRows);
  logger.info('Attendance imported from Excel', {
    date,
    fileName: source,
    imported: summary.valid,
    ...summary,
  });
  return { ...report, summary, imported: summary.valid };
}
