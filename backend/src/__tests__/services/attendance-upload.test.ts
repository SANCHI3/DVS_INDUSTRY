import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

vi.mock('../../lib/prismaClient', () => ({ prisma: {} }));
vi.mock('../../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  AttendanceSheetError,
  detectSpreadsheetType,
  mapAttendanceStatus,
  parseAttendanceSheet,
  parseSheetDate,
} from '../../services/attendance-sheet';
import {
  assertImportDate,
  checkAttendanceUpload,
  importAttendanceUpload,
  type AttendanceUploadRepository,
  type UploadEmployee,
} from '../../services/attendance-upload.service';

const DATE = '2026-10-27';

function workbook(
  rows: unknown[][],
  bookType: XLSX.BookType = 'xlsx',
  sheetName = 'Attendance',
): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return XLSX.write(wb, { type: 'buffer', bookType }) as Buffer;
}

const HEAD = ['Employee ID', 'Employee Name', 'Date', 'Attendance Status'];

const emp = (
  id: number,
  employeeCode: string,
  firstName: string,
  lastName: string,
  extra: Partial<UploadEmployee> = {},
): UploadEmployee => ({
  id,
  employeeCode,
  firstName,
  lastName,
  status: 'ACTIVE',
  deletedAt: null,
  ...extra,
});

const STAFF = [
  emp(1, 'DEMO-EMP-001', 'Rajesh', 'Kulkarni'),
  emp(2, 'DEMO-EMP-002', 'Sunita', 'Deshmukh'),
  emp(3, 'DEMO-EMP-003', 'Amol', 'Jadhav'),
  emp(4, 'DEMO-EMP-004', 'Prakash', 'Shinde'),
  emp(9, 'OLD-001', 'Gone', 'Worker', { deletedAt: new Date(), status: 'TERMINATED' }),
];

function repo(
  existing: Array<{ employeeId: number; status: 'PRESENT' | 'ABSENT' }> = [],
): AttendanceUploadRepository {
  return {
    findEmployeesByCodes: vi.fn(async (codes: string[]) =>
      STAFF.filter((e) => codes.includes(e.employeeCode.toLowerCase())),
    ),
    findExisting: vi.fn(async (ids: number[]) =>
      existing.filter((e) => ids.includes(e.employeeId)),
    ),
    insert: vi.fn(async (rows) => rows.map((r) => r.employeeId)),
  };
}

const check = (rows: unknown[][], r = repo()) =>
  checkAttendanceUpload(parseAttendanceSheet(workbook(rows)), DATE, 'oct27.xlsx', r);

// ── Workbook parsing ──────────────────────────────────────────────────────────

describe('parseAttendanceSheet', () => {
  it('reads .xlsx and .xls with the documented columns', () => {
    for (const type of ['xlsx', 'biff8'] as const) {
      const buf = workbook([HEAD, ['DEMO-EMP-001', 'Rajesh Kulkarni', '', 'P']], type);
      expect(detectSpreadsheetType(buf)).toBe(type === 'xlsx' ? 'xlsx' : 'xls');
      const sheet = parseAttendanceSheet(buf);
      expect(sheet.rows).toEqual([
        {
          row: 2,
          employeeCode: 'DEMO-EMP-001',
          employeeName: 'Rajesh Kulkarni',
          status: 'P',
          rawDate: '',
          date: '',
          inTime: '',
          outTime: '',
          overtime: '',
        },
      ]);
    }
  });

  it.each([
    [['Emp Code', 'Status']],
    [['EMPLOYEE CODE', 'Mark']],
    [['Emp. No.', 'Attendance']],
    [['employee_id', 'attendance status']],
  ])('accepts heading variation %j', (head) => {
    const sheet = parseAttendanceSheet(workbook([head, ['E1', 'P']]));
    expect(sheet.rows[0]).toMatchObject({
      employeeCode: 'E1',
      status: 'P',
      employeeName: '',
      date: '',
    });
  });

  it('finds the heading row below a title block and skips blank rows', () => {
    const sheet = parseAttendanceSheet(
      workbook([
        ['DVS Industries — Daily attendance'],
        [],
        HEAD,
        ['E1', '', '', 'P'],
        [],
        ['E2', '', '', 'A'],
      ]),
    );
    expect(sheet.rows.map((r) => r.row)).toEqual([4, 6]);
    expect(sheet.blankRows).toBe(1);
  });

  it('rejects a sheet without the Employee ID or status column, naming what is missing', () => {
    expect(() =>
      parseAttendanceSheet(
        workbook([
          ['Name', 'Status'],
          ['Ravi', 'P'],
        ]),
      ),
    ).toThrow(/Employee ID/);
    expect(() =>
      parseAttendanceSheet(
        workbook([
          ['Employee ID', 'Name'],
          ['E1', 'Ravi'],
        ]),
      ),
    ).toThrow(/Attendance Status/);
  });

  it('rejects two columns that could both be the status', () => {
    expect(() =>
      parseAttendanceSheet(
        workbook([
          ['Employee ID', 'Status', 'Attendance'],
          ['E1', 'P', 'A'],
        ]),
      ),
    ).toThrow(/2 columns that could be "Attendance Status"/);
  });

  it('handles empty, non-Excel, damaged and heading-only files gracefully', () => {
    expect(() => parseAttendanceSheet(Buffer.alloc(0))).toThrow('The file is empty.');
    expect(() => parseAttendanceSheet(Buffer.from('Employee ID,Status\nE1,P\n'))).toThrow(
      /not an Excel workbook/,
    );
    const damaged = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from('not really a zip'),
    ]);
    expect(() => parseAttendanceSheet(damaged)).toThrow(AttendanceSheetError);
    expect(() => parseAttendanceSheet(workbook([HEAD]))).toThrow(/no attendance rows/);
  });
});

describe('parseSheetDate', () => {
  it('reads Excel serial dates without a time zone shift', () => {
    expect(parseSheetDate(46322)).toBe('2026-10-27');
  });
  it.each([
    ['2026-10-27', '2026-10-27'],
    ['27/10/2026', '2026-10-27'],
    ['27-10-2026', '2026-10-27'],
    ['27 Oct 2026', '2026-10-27'],
    ['27-Oct-2026', '2026-10-27'],
  ])('reads %s', (input, iso) => expect(parseSheetDate(input)).toBe(iso));
  it.each(['31/02/2026', '10/27/2026', 'yesterday', '2026-13-01'])('rejects %s', (input) => {
    expect(parseSheetDate(input)).toBeNull();
  });
});

describe('mapAttendanceStatus', () => {
  it.each([
    ['P', 'PRESENT'],
    ['p', 'PRESENT'],
    ['A', 'ABSENT'],
    ['WO', 'WEEK_OFF'],
    ['W/O', 'WEEK_OFF'],
    ['Week Off', 'WEEK_OFF'],
    ['HD', 'HALF_DAY'],
    ['Leave', 'LEAVE'],
  ])('maps %s → %s', (raw, status) => {
    expect(mapAttendanceStatus(raw)).toEqual({ ok: true, status });
  });

  it('never treats WO as a work order', () => {
    expect(mapAttendanceStatus('WO')).toEqual({ ok: true, status: 'WEEK_OFF' });
  });

  it.each(['OT', 'P+OT', 'P OT', 'Overtime'])(
    'rejects the mark %s with an overtime reason instead of dropping it',
    (raw) => {
      const r = mapAttendanceStatus(raw);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.reason).toMatch(
        /An OT mark has no hours, and attendance records have no overtime field/,
      );
    },
  );

  it('holds back a missing punch instead of trusting the machine status', () => {
    const r = mapAttendanceStatus('Absent (No OutPunch)');
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/only one punch/) });
  });

  it('rejects blank and unknown marks', () => {
    expect(mapAttendanceStatus('')).toEqual({ ok: false, reason: 'Attendance status is blank.' });
    expect(mapAttendanceStatus('X')).toMatchObject({ ok: false });
    expect(mapAttendanceStatus('L')).toMatchObject({ ok: false }); // Late or Leave — ambiguous
  });
});

// ── Row checks (preview) ──────────────────────────────────────────────────────

describe('checkAttendanceUpload', () => {
  it('matches employees by ID (ignoring case) and shows the saved name', async () => {
    const report = await check([
      HEAD,
      ['demo-emp-001', '', '', 'P'],
      ['DEMO-EMP-002', 'sunita  deshmukh', '27/10/2026', 'WO'],
    ]);
    expect(report.rows).toEqual([
      expect.objectContaining({
        employeeId: 1,
        employeeName: 'Rajesh Kulkarni',
        date: DATE,
        status: 'PRESENT',
        result: 'VALID',
      }),
      expect.objectContaining({
        employeeId: 2,
        employeeName: 'Sunita Deshmukh',
        status: 'WEEK_OFF',
        result: 'VALID',
      }),
    ]);
    expect(report.summary).toMatchObject({ totalRows: 2, valid: 2, rejected: 0 });
  });

  it('rejects rows with a missing, unknown or removed employee ID — never matching by name', async () => {
    const r = repo();
    const report = await check(
      [
        HEAD,
        ['', 'Rajesh Kulkarni', '', 'P'],
        ['NOPE-9', 'Rajesh Kulkarni', '', 'P'],
        ['OLD-001', '', '', 'P'],
      ],
      r,
    );
    expect(report.rows.map((x) => x.result)).toEqual(['REJECTED', 'REJECTED', 'REJECTED']);
    expect(report.rows[0]!.reason).toMatch(/Employee ID is missing/);
    expect(report.rows[0]!.employeeId).toBeNull();
    expect(report.rows[1]!.reason).toMatch(
      /No employee has the ID NOPE-9.*never creates employees/,
    );
    expect(report.rows[2]!.reason).toMatch(/removed worker/);
    expect(r.findEmployeesByCodes).toHaveBeenCalledWith(['nope-9', 'old-001']);
  });

  it('rejects a name that does not belong to the employee ID', async () => {
    const report = await check([HEAD, ['DEMO-EMP-001', 'Sunita Deshmukh', '', 'P']]);
    expect(report.rows[0]).toMatchObject({ result: 'REJECTED', employeeName: 'Rajesh Kulkarni' });
    expect(report.rows[0]!.reason).toMatch(/does not match DEMO-EMP-001, who is Rajesh Kulkarni/);
  });

  it('applies the selected date to blank cells and rejects other or invalid dates', async () => {
    const report = await check([
      HEAD,
      ['DEMO-EMP-001', '', '', 'P'],
      ['DEMO-EMP-002', '', '26/10/2026', 'P'],
      ['DEMO-EMP-003', '', '32/10/2026', 'P'],
    ]);
    expect(report.rows.map((r) => r.result)).toEqual(['VALID', 'REJECTED', 'REJECTED']);
    expect(report.rows[1]!.reason).toBe(
      'Row date 26 Oct 2026 does not match the selected attendance date 27 Oct 2026.',
    );
    expect(report.rows[2]!.reason).toMatch(/"32\/10\/2026" is not a valid date/);
  });

  it('rejects OT rows with the reason and keeps P, A, WO', async () => {
    const report = await check([
      HEAD,
      ['DEMO-EMP-001', '', '', 'P'],
      ['DEMO-EMP-002', '', '', 'A'],
      ['DEMO-EMP-003', '', '', 'WO'],
      ['DEMO-EMP-004', '', '', 'OT'],
    ]);
    expect(report.rows.map((r) => r.status)).toEqual(['PRESENT', 'ABSENT', 'WEEK_OFF', null]);
    expect(report.rows[3]).toMatchObject({ result: 'REJECTED', employeeName: 'Prakash Shinde' });
    expect(report.rows[3]!.reason).toMatch(/OT mark/);
  });

  it('imports an identical repeated row once and reports the repeat as a duplicate', async () => {
    const report = await check([
      HEAD,
      ['DEMO-EMP-001', '', '', 'P'],
      ['demo-emp-001', '', '', 'p'],
    ]);
    expect(report.rows.map((r) => r.result)).toEqual(['VALID', 'DUPLICATE']);
    expect(report.rows[1]!.reason).toBe('Repeats row 2 for DEMO-EMP-001. Imported once.');
  });

  it('rejects every row of an employee whose rows disagree, instead of choosing one', async () => {
    const report = await check([
      HEAD,
      ['DEMO-EMP-001', '', '', 'P'],
      ['DEMO-EMP-002', '', '', 'P'],
      ['DEMO-EMP-001', '', '', 'A'],
    ]);
    expect(report.rows.map((r) => r.result)).toEqual(['REJECTED', 'VALID', 'REJECTED']);
    expect(report.rows[0]!.reason).toBe(
      'Rows 2, 4 give DEMO-EMP-001 different statuses (P vs A). Keep only the correct row.',
    );
  });

  it('skips an employee who already has attendance that day and says what is saved', async () => {
    const report = await check(
      [HEAD, ['DEMO-EMP-001', '', '', 'A'], ['DEMO-EMP-002', '', '', 'P']],
      repo([{ employeeId: 1, status: 'PRESENT' }]),
    );
    expect(report.rows[0]).toMatchObject({
      result: 'EXISTING',
      reason: 'Already recorded as Present on 27 Oct 2026. Left unchanged.',
    });
    expect(report.summary).toMatchObject({ valid: 1, existing: 1 });
  });

  it('writes nothing during a preview', async () => {
    const r = repo();
    await check([HEAD, ['DEMO-EMP-001', '', '', 'P']], r);
    expect(r.insert).not.toHaveBeenCalled();
  });

  it('refuses a future or invalid import date', () => {
    const now = new Date('2026-10-27T10:00:00.000Z');
    expect(() => assertImportDate('2026-10-30', now)).toThrow(/future date/);
    expect(() => assertImportDate('2026-02-30', now)).toThrow(/valid attendance date/);
    expect(assertImportDate('2026-10-28', now).toISOString()).toBe('2026-10-28T00:00:00.000Z'); // IST is ahead of UTC
  });
});

// ── Import ────────────────────────────────────────────────────────────────────

describe('importAttendanceUpload', () => {
  const rows = [
    HEAD,
    ['DEMO-EMP-001', '', '', 'P'],
    ['DEMO-EMP-002', '', '', 'WO'],
    ['DEMO-EMP-003', '', '', 'A'],
    ['DEMO-EMP-004', '', '', 'OT'],
    ['DEMO-EMP-001', '', '', 'P'],
  ];

  it('inserts only valid rows, insert-only, with the source row in the remarks', async () => {
    const r = repo([{ employeeId: 3, status: 'PRESENT' }]);
    const report = await importAttendanceUpload(
      parseAttendanceSheet(workbook(rows)),
      DATE,
      'oct 27.xlsx',
      r,
    );
    expect(r.insert).toHaveBeenCalledTimes(1);
    expect(vi.mocked(r.insert).mock.calls[0]![0]).toEqual([
      {
        employeeId: 1,
        date: new Date('2026-10-27T00:00:00.000Z'),
        status: 'PRESENT',
        clockIn: null,
        clockOut: null,
        workingHours: null,
        remarks: 'Imported from Excel: oct 27.xlsx, row 2',
      },
      {
        employeeId: 2,
        date: new Date('2026-10-27T00:00:00.000Z'),
        status: 'WEEK_OFF',
        clockIn: null,
        clockOut: null,
        workingHours: null,
        remarks: 'Imported from Excel: oct 27.xlsx, row 3',
      },
    ]);
    expect(report.imported).toBe(2);
    expect(report.summary).toEqual({
      totalRows: 5,
      valid: 2,
      existing: 1,
      duplicate: 1,
      rejected: 1,
      blankRows: 0,
    });
  });

  it('reports a record written by someone else during the import as skipped, not imported', async () => {
    const r = repo();
    vi.mocked(r.insert).mockResolvedValue([2]); // employee 1 was recorded meanwhile
    const report = await importAttendanceUpload(
      parseAttendanceSheet(workbook(rows.slice(0, 3))),
      DATE,
      'a.xlsx',
      r,
    );
    expect(report.imported).toBe(1);
    expect(report.rows[0]).toMatchObject({
      result: 'EXISTING',
      reason: expect.stringMatching(/while the file was being imported/),
    });
  });

  it('does not call insert when nothing is valid', async () => {
    const r = repo();
    const report = await importAttendanceUpload(
      parseAttendanceSheet(workbook([HEAD, ['NOPE', '', '', 'P']])),
      DATE,
      'a.xlsx',
      r,
    );
    expect(report.imported).toBe(0);
    expect(r.insert).not.toHaveBeenCalled();
  });
});

// ── The attendance machine's own exports ──────────────────────────────────────

/** The layout of the machine's Daily Attendance report (title block, E. Code, punches, OT) */
function dailyReport(date: string, rows: unknown[][]): Buffer {
  return workbook(
    [
      ['', 'Attendance Date', '', '', date],
      ['', 'Department', '', '', 'Default'],
      [
        '',
        'SNo',
        'E. Code',
        'Name',
        '',
        'Shift',
        '',
        ' InTime',
        ' OutTime',
        '',
        'Work Dur.',
        'OT',
        'Tot.  Dur.',
        'Status',
        '',
        'Remarks',
      ],
      ...rows,
    ],
    'biff8',
    'DailyAttendance_BasicReport',
  );
}
const daily = (
  code: string,
  name: string,
  shift: string,
  inT: string,
  outT: string,
  ot: string,
  status: string,
) => ['', '1', code, name, '', shift, '', inT, outT, '', '8:00', ot, '', status, '', ''];

describe('daily attendance report from the machine', () => {
  const file = () =>
    dailyReport('27-Oct-2026', [
      daily('DEMO-EMP-001', 'RAJESH KULKARNI', 'GS', '09:11', '20:44', '3:33', 'Present '),
      daily('DEMO-EMP-002', 'SUNITA DESHMUKH', 'NS', '', '', '00:00', 'Absent'),
      daily('DEMO-EMP-003', 'AMOL JADHAV', 'GS', '08:31', '', '00:00', 'Absent (No OutPunch)'),
      daily('DEMO-EMP-004', 'PRAKASH SHINDE', 'NS', '21:58', '06:05', '0:07', 'Present '),
      daily('', '', '', '', '', '', ''),
    ]);

  it('reads the title date, E. Code, punch times and OT', () => {
    const sheet = parseAttendanceSheet(file());
    expect(sheet).toMatchObject({ kind: 'table', sheetDate: '2026-10-27' });
    expect(sheet.columns).toMatchObject({
      employeeCode: 'E. Code',
      inTime: 'InTime',
      outTime: 'OutTime',
      overtime: 'OT',
    });
    expect(sheet.rows[0]).toMatchObject({
      employeeCode: 'DEMO-EMP-001',
      inTime: '09:11',
      outTime: '20:44',
      overtime: '3:33',
      status: 'Present',
    });
    expect(sheet.rows).toHaveLength(4);
  });

  it('keeps overtime (remarks and hours), times across midnight, and holds back a missing punch', async () => {
    const r = repo();
    const report = await importAttendanceUpload(
      parseAttendanceSheet(file()),
      DATE,
      'daily.xls',
      r,
      330,
    );
    expect(report.rows.map((x) => x.result)).toEqual(['VALID', 'VALID', 'REJECTED', 'VALID']);
    expect(report.rows[0]).toMatchObject({
      clockIn: '09:11',
      clockOut: '20:44',
      overtime: '3:33',
      note: expect.stringMatching(/saved in the remarks/),
    });
    expect(report.rows[2]!.reason).toMatch(/only one punch/);
    const saved = vi.mocked(r.insert).mock.calls[0]![0];
    expect(saved[0]).toEqual({
      employeeId: 1,
      date: new Date('2026-10-27T00:00:00.000Z'),
      status: 'PRESENT',
      clockIn: new Date('2026-10-27T03:41:00.000Z'), // 09:11 IST
      clockOut: new Date('2026-10-27T15:14:00.000Z'), // 20:44 IST
      workingHours: 11.55,
      remarks: 'Imported from Excel: daily.xls, row 4 · Overtime 3:33',
    });
    expect(saved[1]).toMatchObject({
      status: 'ABSENT',
      clockIn: null,
      clockOut: null,
      workingHours: null,
    });
    // Night shift: 21:58 → 06:05 the next morning
    expect(saved[2]).toMatchObject({
      clockOut: new Date('2026-10-28T00:35:00.000Z'),
      workingHours: 8.12,
    });
  });

  it('refuses the file for any date other than the one it declares', async () => {
    await expect(
      checkAttendanceUpload(parseAttendanceSheet(file()), '2026-10-26', 'daily.xls', repo()),
    ).rejects.toMatchObject({
      code: 'SHEET_DATE_MISMATCH',
      message: expect.stringMatching(/attendance for 27 Oct 2026 \(2026-10-27\)/),
    });
  });

  it('rejects overtime or punches on an absent day, and overtime longer than the punches', async () => {
    const report = await checkAttendanceUpload(
      parseAttendanceSheet(
        dailyReport('27-Oct-2026', [
          daily('DEMO-EMP-001', '', 'GS', '09:00', '17:00', '9:00', 'Present'),
          daily('DEMO-EMP-002', '', 'GS', '', '', '1:00', 'Absent'),
          daily('DEMO-EMP-003', '', 'GS', '25:00', '17:00', '', 'Present'),
        ]),
      ),
      DATE,
      'daily.xls',
      repo(),
    );
    expect(report.rows[0]!.reason).toMatch(/longer than the 8:00 between the punches/);
    expect(report.rows[1]!.reason).toMatch(
      /Marked Absent but the sheet has punch times or overtime/,
    );
    expect(report.rows[2]!.reason).toMatch(/In time "25:00" is not a valid time/);
  });
});

/** The layout of the machine's Monthly Status report (the existing monthly parser reads it) */
function monthlyReport(
  rows: Array<{ code: string; name: string; marks: string[]; totals?: [number, number, number] }>,
): Buffer {
  const days = Array.from(
    { length: 31 },
    (_, i) => `${i + 1} ${['Sa', 'Su', 'M', 'T', 'W', 'Th', 'F'][i % 7]}`,
  );
  return workbook(
    [
      ['', 'Monthly Status Report'],
      ['', 'Oct 01 2026  To  Oct 31 2026'],
      ['Sl', 'Emp. Code', 'Name', ...days, 'P', 'A', 'WO'],
      ...rows.map((r, i) => {
        const count = (c: string) => r.marks.filter((m) => m === c).length;
        return [
          String(i + 1),
          r.code,
          r.name,
          ...r.marks,
          ...(r.totals ?? [count('P'), count('A'), count('WO')]),
        ];
      }),
    ],
    'biff8',
    'MonthlyStatus_BasicReport',
  );
}
const month = (fill: string, day27: string) =>
  Array.from({ length: 31 }, (_, i) => (i === 26 ? day27 : fill));

describe('monthly status report from the machine', () => {
  const file = () =>
    monthlyReport([
      { code: 'DEMO-EMP-001', name: 'RAJESH KULKARNI', marks: month('P', 'WO') },
      { code: 'DEMO-EMP-002', name: 'SUNITA DESHMUKH', marks: month('A', 'P') },
      { code: 'DEMO-EMP-003', name: 'AMOL JADHAV', marks: month('P', 'P'), totals: [1, 0, 0] },
      { code: 'DEMO-EMP-004', name: 'PRAKASH SHINDE', marks: month('', '') },
    ]);

  it('takes the selected day from the grid', async () => {
    const report = await checkAttendanceUpload(
      parseAttendanceSheet(file(), DATE),
      DATE,
      'monthly.xls',
      repo(),
    );
    expect(report.kind).toBe('monthly');
    expect(report.rows.map((r) => [r.employeeCode, r.status, r.result])).toEqual([
      ['DEMO-EMP-001', 'WEEK_OFF', 'VALID'],
      ['DEMO-EMP-002', 'PRESENT', 'VALID'],
      ['DEMO-EMP-003', null, 'REJECTED'],
      ['DEMO-EMP-004', null, 'REJECTED'],
    ]);
    expect(report.rows[2]!.reason).toMatch(/do not add up to the report's own P\/A\/WO totals/);
    expect(report.rows[3]!.reason).toBe('The report has no mark for day 27.');
  });

  it('refuses a date outside the report month and names the month', () => {
    expect(() => parseAttendanceSheet(file(), '2026-09-30')).toThrow(/covers October 2026/);
    try {
      parseAttendanceSheet(file(), '2026-09-30');
    } catch (err) {
      expect((err as AttendanceSheetError).sheetDate).toBe('2026-10-01');
    }
  });
});
