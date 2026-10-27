import * as XLSX from 'xlsx';
import type { AttendanceStatus } from '../interfaces';
import { parseAttendanceWorkbook } from './attendance-workbook';

/**
 * Reads an attendance workbook uploaded from the Attendance page. Nothing here
 * touches the database: the result is only the rows as written, which the
 * upload service then checks against employees.
 *
 * Three layouts are read:
 *  1. A table, one row per employee (heading case, spaces and punctuation ignored):
 *       Employee ID        required — Employee ID, Employee Code, E. Code, Emp ID, Emp Code, Emp No
 *       Attendance Status  required — Attendance Status, Status, Attendance, Mark
 *       Employee Name      optional — Employee Name, Name, Full Name, Worker Name
 *       Date               optional — Date, Attendance Date (blank = the selected date)
 *       In Time / Out Time optional — punch times (HH:MM)
 *       OT                 optional — overtime duration (H:MM or hours)
 *  2. The attendance machine's daily report: the same table under a title
 *     block that declares "Attendance Date". That date must be the selected one.
 *  3. The machine's Monthly Status report (a 1–31 day grid with P/A/WO totals),
 *     read by the existing monthly parser; only the selected day is taken.
 */

export const MAX_SHEET_ROWS = 2000;

export class AttendanceSheetError extends Error {
  /** Set when the file is for another date: the date it is for */
  constructor(
    message: string,
    public readonly sheetDate?: string,
  ) {
    super(message);
  }
}

export const ACCEPTED_COLUMNS = {
  employeeCode: [
    'employeeid',
    'employeecode',
    'ecode',
    'empid',
    'empcode',
    'empno',
    'employeeno',
    'workerid',
    'staffid',
  ],
  status: ['attendancestatus', 'status', 'attendance', 'mark'],
  employeeName: ['employeename', 'name', 'fullname', 'workername', 'empname'],
  date: ['date', 'attendancedate'],
  inTime: ['intime', 'clockin', 'checkin', 'punchin', 'in'],
  outTime: ['outtime', 'clockout', 'checkout', 'punchout', 'out'],
  overtime: ['ot', 'overtime', 'othours', 'overtimehours'],
} as const;

type Column = keyof typeof ACCEPTED_COLUMNS;

const COLUMN_LABEL: Record<Column, string> = {
  employeeCode: 'Employee ID',
  status: 'Attendance Status',
  employeeName: 'Employee Name',
  date: 'Date',
  inTime: 'In Time',
  outTime: 'Out Time',
  overtime: 'OT',
};

export interface SheetRow {
  /** Worksheet row number as Excel shows it */
  row: number;
  employeeCode: string;
  employeeName: string;
  status: string;
  /** "YYYY-MM-DD"; '' when the cell is blank; null when it is not a real date */
  date: string | null;
  /** The date cell as written, for error messages */
  rawDate: string;
  inTime: string;
  outTime: string;
  overtime: string;
  /** Set when the reader itself had to hold the row back */
  heldBack?: string;
}

export interface ParsedSheet {
  kind: 'table' | 'monthly';
  sheetName: string;
  columns: Partial<Record<Column, string>>;
  rows: SheetRow[];
  blankRows: number;
  /** The date a daily report declares in its title block */
  sheetDate: string | null;
}

/** A cell as text; sheet_to_json gives strings, numbers and booleans */
const cellString = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';

const normaliseHeading = (v: unknown): string =>
  cellString(v)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const text = (v: unknown): string => cellString(v).replace(/\s+/g, ' ').trim();

/** The file's first bytes: .xlsx is a zip, .xls is an OLE compound file. */
export function detectSpreadsheetType(data: Buffer): 'xlsx' | 'xls' | null {
  if (
    data.length >= 4 &&
    data[0] === 0x50 &&
    data[1] === 0x4b &&
    data[2] === 0x03 &&
    data[3] === 0x04
  ) {
    return 'xlsx';
  }
  if (data.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
    return 'xls';
  }
  return null;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function isoIfReal(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d)
    return null;
  return date.toISOString().slice(0, 10);
}

// SheetJS ships SSF untyped
const ssf = XLSX.SSF as {
  parse_date_code(v: number): { y: number; m: number; d: number } | null;
};

/**
 * A date cell as "YYYY-MM-DD". Excel serial numbers are converted without a
 * time zone. Text must be unambiguous: 2026-10-27, 27/10/2026, 27-10-2026 or
 * 27 Oct 2026 (day first, as written in India). Anything else is null.
 */
export function parseSheetDate(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const p = ssf.parse_date_code(value);
    return p ? isoIfReal(p.y, p.m, p.d) : null;
  }
  const s = text(value);
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return isoIfReal(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return isoIfReal(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s,-]+(\d{4})$/.exec(s);
  if (m) {
    const month = MONTHS[m[2]!.slice(0, 3).toLowerCase()];
    return month ? isoIfReal(Number(m[3]), month, Number(m[1])) : null;
  }
  return null;
}

/**
 * Minutes from a time or duration cell: "09:11", "3:33", or an Excel time
 * (a fraction of a day). '' → null; anything unreadable → NaN.
 */
export function parseClock(value: string, maxHours = 23): number | null {
  const s = value.trim();
  if (s === '') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    return h <= maxHours && min < 60 ? h * 60 + min : NaN;
  }
  const n = Number(s);
  if (Number.isFinite(n) && n >= 0 && n < 1) return Math.round(n * 1440); // Excel time
  return NaN;
}

/** Overtime as minutes: "3:33", "00:00" or decimal hours ("1.5"). */
export function parseOvertime(value: string): number | null {
  const s = value.trim();
  if (s === '') return null;
  const clock = parseClock(s, 24);
  if (clock !== null && !Number.isNaN(clock) && s.includes(':')) return clock;
  const hours = Number(s);
  return Number.isFinite(hours) && hours >= 0 && hours <= 24 ? Math.round(hours * 60) : NaN;
}

export type StatusMapping = { ok: true; status: AttendanceStatus } | { ok: false; reason: string };

const STATUS_CODES: Record<string, AttendanceStatus> = {
  P: 'PRESENT',
  PRESENT: 'PRESENT',
  A: 'ABSENT',
  AB: 'ABSENT',
  ABSENT: 'ABSENT',
  WO: 'WEEK_OFF',
  'W/O': 'WEEK_OFF',
  'WEEK OFF': 'WEEK_OFF',
  WEEKOFF: 'WEEK_OFF',
  WEEK_OFF: 'WEEK_OFF',
  'WEEKLY OFF': 'WEEK_OFF',
  HD: 'HALF_DAY',
  'HALF DAY': 'HALF_DAY',
  HALF_DAY: 'HALF_DAY',
  LATE: 'LATE',
  LEAVE: 'LEAVE',
};

/** Workbook mark → attendance status. "WO" is Week Off, never Work Order. */
export function mapAttendanceStatus(raw: string): StatusMapping {
  const code = text(raw).toUpperCase();
  if (code === '') return { ok: false, reason: 'Attendance status is blank.' };
  if (/NO\s*(IN|OUT)\s*-?\s*PUNCH|MISS(ED|ING)?\s*PUNCH/.test(code)) {
    return {
      ok: false,
      reason:
        `The machine recorded only one punch ("${text(raw)}"), so the day is uncertain. ` +
        'Confirm it with the supervisor and enter it with Record Attendance.',
    };
  }
  if (/\bOT\b|OVERTIME/.test(code)) {
    return {
      ok: false,
      reason:
        'An OT mark has no hours, and attendance records have no overtime field, so it cannot be imported. ' +
        'Record this day with Record Attendance and keep the overtime in your payroll sheet.',
    };
  }
  const status = STATUS_CODES[code];
  if (status === undefined) {
    return {
      ok: false,
      reason: `"${text(raw)}" is not a recognised status. Use P, A, WO, HD, Late or Leave.`,
    };
  }
  return { ok: true, status };
}

type Grid = unknown[][];

function readWorkbook(buffer: Buffer): XLSX.WorkBook {
  if (buffer.length === 0) throw new AttendanceSheetError('The file is empty.');
  if (detectSpreadsheetType(buffer) === null) {
    throw new AttendanceSheetError('The file is not an Excel workbook (.xlsx or .xls).');
  }
  let workbook: XLSX.WorkBook;
  try {
    // sheetRows bounds the work done on a hostile or huge file
    workbook = XLSX.read(buffer, {
      type: 'buffer',
      cellDates: false,
      sheetRows: MAX_SHEET_ROWS + 25,
    });
  } catch {
    throw new AttendanceSheetError(
      'The workbook could not be read. It may be damaged or password-protected.',
    );
  }
  if (workbook.SheetNames.length === 0)
    throw new AttendanceSheetError('The workbook has no worksheets.');
  return workbook;
}

/** The machine's Monthly Status report: an "Emp. Code" column and 1–31 day columns */
function isMonthlyReport(grid: Grid): boolean {
  return grid
    .slice(0, 15)
    .some(
      (r) =>
        r.some((c) => text(c) === 'Emp. Code') &&
        r.some((c) => /^1\s+[A-Za-z]{1,2}$/.test(text(c))),
    );
}

/** A date declared in the title block, e.g. "Attendance Date … 23-Sep-2026" */
function titleDate(rows: Grid): string | null {
  for (const r of rows) {
    const at = r.findIndex((c) => ['attendancedate', 'reportdate'].includes(normaliseHeading(c)));
    if (at < 0) continue;
    const value = r.slice(at + 1).find((c) => text(c) !== '');
    return value === undefined ? null : parseSheetDate(value);
  }
  return null;
}

function parseMonthly(buffer: Buffer, sheetName: string, grid: Grid, date: string): ParsedSheet {
  let parsed: ReturnType<typeof parseAttendanceWorkbook>;
  try {
    parsed = parseAttendanceWorkbook(buffer);
  } catch (err) {
    throw new AttendanceSheetError(
      `This looks like a Monthly Status report, but it could not be read: ${
        err instanceof Error ? err.message : 'unknown problem'
      }`,
    );
  }
  const { year, month } = parsed.period;
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  if (date.slice(0, 7) !== monthKey) {
    const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-GB', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
    throw new AttendanceSheetError(
      `This Monthly Status report covers ${label}. Select a date in ${label}; each upload imports one day.`,
      `${monthKey}-01`,
    );
  }

  const headerIndex = grid.findIndex((r) => r.some((c) => text(c) === 'Emp. Code'));
  const header = grid[headerIndex]!;
  const codeIndex = header.findIndex((c) => text(c) === 'Emp. Code');
  const nameIndex = header.findIndex((c) => text(c) === 'Name');
  const marks = new Map(
    parsed.entries.filter((e) => e.date === date).map((e) => [e.sourceRow, e.code as string]),
  );
  const excluded = new Set(parsed.excludedRows);
  const day = Number(date.slice(8));

  const rows: SheetRow[] = [];
  for (let i = headerIndex + 1; i < grid.length; i++) {
    const r = grid[i]!;
    const employeeCode = text(r[codeIndex]);
    if (!employeeCode) continue;
    const row = i + 1;
    rows.push({
      row,
      employeeCode,
      employeeName: nameIndex >= 0 ? text(r[nameIndex]) : '',
      status: marks.get(row) ?? '',
      date: '',
      rawDate: '',
      inTime: '',
      outTime: '',
      overtime: '',
      ...(excluded.has(row)
        ? {
            heldBack:
              "This employee's day marks do not add up to the report's own P/A/WO totals, so the whole row " +
              'is held back. Check the month in the attendance machine.',
          }
        : !marks.has(row)
          ? { heldBack: `The report has no mark for day ${day}.` }
          : {}),
    });
  }
  if (rows.length === 0)
    throw new AttendanceSheetError('The Monthly Status report lists no employees.');
  return {
    kind: 'monthly',
    sheetName,
    columns: { employeeCode: 'Emp. Code', employeeName: 'Name', status: `Day ${day}` },
    rows,
    blankRows: 0,
    sheetDate: null,
  };
}

function parseTable(sheetName: string, grid: Grid, headerIndex: number): ParsedSheet {
  const header = grid[headerIndex]!;
  const index: Partial<Record<Column, number>> = {};
  const columns: Partial<Record<Column, string>> = {};
  for (const key of Object.keys(ACCEPTED_COLUMNS) as Column[]) {
    const hits = header.flatMap((c, i) =>
      (ACCEPTED_COLUMNS[key] as readonly string[]).includes(normaliseHeading(c)) ? [i] : [],
    );
    if (hits.length > 1) {
      throw new AttendanceSheetError(
        `Worksheet "${sheetName}" has ${hits.length} columns that could be "${COLUMN_LABEL[key]}" ` +
          `(${hits.map((i) => `"${text(header[i])}"`).join(', ')}). Keep only one.`,
      );
    }
    if (hits.length === 1) {
      index[key] = hits[0]!;
      columns[key] = text(header[hits[0]!]);
    }
  }
  if (index.status === undefined) {
    throw new AttendanceSheetError(
      `Worksheet "${sheetName}" has no attendance status column. Add a column headed "Attendance Status".`,
    );
  }

  const rows: SheetRow[] = [];
  let blankRows = 0;
  for (let i = headerIndex + 1; i < grid.length; i++) {
    const r = grid[i]!;
    const cell = (k: Column): unknown => (index[k] === undefined ? '' : r[index[k]!]);
    const employeeCode = text(cell('employeeCode'));
    const employeeName = text(cell('employeeName'));
    const status = text(cell('status'));
    const rawDate = text(cell('date'));
    if (!employeeCode && !status && !rawDate) {
      // A name alone under the table is a footer, not an attendance row
      if (employeeName === '') blankRows++;
      else
        rows.push({
          row: i + 1,
          employeeCode,
          employeeName,
          status,
          rawDate,
          date: '',
          inTime: '',
          outTime: '',
          overtime: '',
        });
      continue;
    }
    if (rows.length >= MAX_SHEET_ROWS) {
      throw new AttendanceSheetError(
        `The sheet has more than ${MAX_SHEET_ROWS} rows. Split it into smaller files.`,
      );
    }
    rows.push({
      row: i + 1,
      employeeCode,
      employeeName,
      status,
      rawDate,
      date: rawDate === '' ? '' : parseSheetDate(cell('date')),
      inTime: text(cell('inTime')),
      outTime: text(cell('outTime')),
      overtime: text(cell('overtime')),
    });
  }
  if (rows.length === 0)
    throw new AttendanceSheetError(`Worksheet "${sheetName}" has headings but no attendance rows.`);
  return {
    kind: 'table',
    sheetName,
    columns,
    rows,
    blankRows,
    sheetDate: titleDate(grid.slice(0, headerIndex)),
  };
}

/**
 * Parses the first worksheet in a known layout. `date` is the selected
 * attendance date (needed to pick the day from a monthly report).
 * Throws AttendanceSheetError.
 */
export function parseAttendanceSheet(buffer: Buffer, date?: string): ParsedSheet {
  const workbook = readWorkbook(buffer);
  for (const sheetName of workbook.SheetNames) {
    const grid = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName]!, {
      header: 1,
      defval: '',
      raw: true,
      blankrows: true,
    });
    if (isMonthlyReport(grid)) {
      if (date === undefined)
        throw new AttendanceSheetError('Select the attendance date to import from this report.');
      // The monthly parser numbers rows from the same grid without blank rows
      const compact = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName]!, {
        header: 1,
        defval: '',
      });
      return parseMonthly(buffer, sheetName, compact, date);
    }
    // The heading row may sit under a title block
    const headerIndex = grid
      .slice(0, 15)
      .findIndex((r) =>
        r.some((c) =>
          (ACCEPTED_COLUMNS.employeeCode as readonly string[]).includes(normaliseHeading(c)),
        ),
      );
    if (headerIndex >= 0) return parseTable(sheetName, grid, headerIndex);
  }
  throw new AttendanceSheetError(
    'No worksheet has an "Employee ID" column. The first row of the table must hold the headings ' +
      'Employee ID, Employee Name (optional), Date (optional) and Attendance Status.',
  );
}
