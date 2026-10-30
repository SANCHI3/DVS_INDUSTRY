import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

vi.mock('../../lib/prismaClient', () => ({ prisma: {} }));
vi.mock('../../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { parseAttendanceSheet } from '../../services/attendance-sheet';
import {
  checkAttendanceUpload,
  type AttendanceUploadRepository,
  type UploadEmployee,
} from '../../services/attendance-upload.service';
import {
  registerSheetEmployees,
  type SheetEmployeeInput,
  type SheetEmployeeRepository,
} from '../../services/attendance-sheet-employees.service';

const DATE = '2026-10-27';

/** The machine's Daily Attendance report, with numeric E. Codes */
function dailyReport(rows: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['', 'Attendance Date', '', '', '27-Oct-2026'],
      [],
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
    ]),
    'DailyAttendance_BasicReport',
  );
  return XLSX.write(wb, { type: 'buffer', bookType: 'biff8' }) as Buffer;
}

const daily = (
  code: string | number,
  name: string,
  shift: string,
  inT: string,
  outT: string,
  ot: string,
  status: string,
) => ['', 1, code, name, '', shift, '', inT, outT, '', '8:00', ot, '', status, '', ''];

const FILE = () =>
  dailyReport([
    daily('1', 'ASHA PATIL', 'GS', '09:11', '20:44', '3:33', 'Present '),
    daily('2', 'RAVI', 'NS', '', '', '00:00', 'Absent'),
    daily(3, 'MEERA S KALE', 'GS', '08:31', '', '00:00', 'Absent (No OutPunch)'),
    daily('7', 'Known Worker', 'GS', '08:00', '16:00', '00:00', 'Present '),
  ]);

/** An employee table that changes as employees are registered */
function world(initial: UploadEmployee[] = []) {
  const staff = [...initial];
  const upload: AttendanceUploadRepository = {
    findEmployeesByCodes: vi.fn(async (codes: string[]) =>
      staff.filter((e) => codes.includes(e.employeeCode.toLowerCase())),
    ),
    findExisting: vi.fn(async () => []),
    insert: vi.fn(async (rows) => rows.map((r) => r.employeeId)),
  };
  const employees: SheetEmployeeRepository = {
    existingShiftIds: vi.fn(async (ids: number[]) => ids.filter((id) => id === 1 || id === 2)),
    existingDepartmentIds: vi.fn(async () => []),
    createAll: vi.fn(async (rows: SheetEmployeeInput[]) =>
      rows.map((r) => {
        const e: UploadEmployee = {
          id: 100 + staff.length,
          employeeCode: r.employeeCode,
          firstName: r.firstName,
          lastName: r.lastName,
          status: 'ACTIVE',
          deletedAt: null,
        };
        staff.push(e);
        return { id: e.id, employeeCode: e.employeeCode };
      }),
    ),
  };
  return { upload, employees };
}

const known: UploadEmployee = {
  id: 7,
  employeeCode: '7',
  firstName: 'Known',
  lastName: 'Worker',
  status: 'ACTIVE',
  deletedAt: null,
};

const input = (over: Partial<SheetEmployeeInput> = {}): SheetEmployeeInput => ({
  employeeCode: '1',
  firstName: 'ASHA',
  lastName: 'PATIL',
  designation: 'Operator',
  joiningDate: new Date('2026-08-01T00:00:00.000Z'),
  employmentType: 'FULL_TIME',
  shiftId: 1,
  ...over,
});

describe('unregistered Employee IDs in the preview', () => {
  it('reads numeric IDs as written and lists the unregistered ones with sheet name and shift', async () => {
    const { upload } = world([known]);
    const sheet = parseAttendanceSheet(FILE());
    expect(sheet.rows.map((r) => r.employeeCode)).toEqual(['1', '2', '3', '7']);
    const report = await checkAttendanceUpload(sheet, DATE, 'daily.xls', upload);

    expect(report.rows.map((r) => r.result)).toEqual(['REJECTED', 'REJECTED', 'REJECTED', 'VALID']);
    expect(report.rows[0]).toMatchObject({
      sourceName: 'ASHA PATIL',
      sourceShift: 'GS',
      reason: expect.stringMatching(/No employee has the ID 1\. Register the worker first/),
    });
    // A missing punch keeps its own reason; the ID is still listed for registering
    expect(report.rows[2]!.reason).toMatch(/only one punch/);
    expect(report.unregistered).toEqual([
      { employeeCode: '1', name: 'ASHA PATIL', shift: 'GS', rows: [5], problem: null },
      { employeeCode: '2', name: 'RAVI', shift: 'NS', rows: [6], problem: null },
      { employeeCode: '3', name: 'MEERA S KALE', shift: 'GS', rows: [7], problem: null },
    ]);
  });

  it('cannot register an ID the sheet contradicts or the employee form would not accept', async () => {
    const { upload } = world();
    const sheet = parseAttendanceSheet(
      dailyReport([
        daily('5', 'ONE NAME', 'GS', '', '', '00:00', 'Absent'),
        daily('5', 'OTHER NAME', 'GS', '', '', '00:00', 'Absent'),
        daily('ab 9', 'SPACE ID', 'GS', '', '', '00:00', 'Absent'),
        daily('8', '', 'GS', '', '', '00:00', 'Absent'),
      ]),
    );
    const report = await checkAttendanceUpload(sheet, DATE, 'daily.xls', upload);
    expect(report.unregistered.map((u) => [u.employeeCode, u.problem])).toEqual([
      ['5', expect.stringMatching(/different names \("ONE NAME", "OTHER NAME"\)/)],
      ['ab 9', expect.stringMatching(/cannot be registered as written/)],
      ['8', 'The sheet has no name for this ID.'],
    ]);
  });
});

describe('registerSheetEmployees', () => {
  const register = (w: ReturnType<typeof world>, employees: SheetEmployeeInput[]) =>
    registerSheetEmployees(
      parseAttendanceSheet(FILE()),
      DATE,
      'daily.xls',
      employees,
      w.upload,
      w.employees,
    );

  it('registers the reviewed employees with the sheet ID and name, then previews again', async () => {
    const w = world([known]);
    const result = await register(w, [
      input(),
      input({ employeeCode: '2', firstName: 'RAVI', lastName: '', shiftId: 2 }),
    ]);
    expect(w.employees.createAll).toHaveBeenCalledWith([
      expect.objectContaining({ employeeCode: '1', firstName: 'ASHA', lastName: 'PATIL' }),
      expect.objectContaining({ employeeCode: '2', firstName: 'RAVI', lastName: '', shiftId: 2 }),
    ]);
    expect(result.created.map((c) => [c.employeeCode, c.name])).toEqual([
      ['1', 'ASHA PATIL'],
      ['2', 'RAVI'],
    ]);
    // Attendance is not written; the new preview shows the rows as ready
    expect(w.upload.insert).not.toHaveBeenCalled();
    expect(result.report.rows.map((r) => r.result)).toEqual([
      'VALID',
      'VALID',
      'REJECTED',
      'VALID',
    ]);
    expect(result.report.unregistered.map((u) => u.employeeCode)).toEqual(['3']);
  });

  it('refuses everything when any employee has a problem', async () => {
    const w = world([known]);
    const err = await register(w, [
      input(),
      input({ employeeCode: '2', firstName: 'RAVI KUMAR', lastName: '' }),
      input({
        employeeCode: '3',
        firstName: 'MEERA',
        lastName: 'S KALE',
        joiningDate: new Date('2026-11-01'),
      }),
      input({ employeeCode: '7', firstName: 'Known', lastName: 'Worker' }),
      input({ employeeCode: '99', firstName: 'NOT', lastName: 'THERE' }),
      input({ employeeCode: '1' }),
      input({ employeeCode: '2', firstName: 'RAVI', lastName: '', shiftId: 42 }),
    ]).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'VALIDATION_ERROR' });
    const details = (err as { details: Array<{ field: string; message: string }> }).details;
    expect(details.map((d) => d.message)).toEqual([
      expect.stringMatching(/^2: first and last name must together read exactly "RAVI"/),
      expect.stringMatching(/^3: joining date 2026-11-01 is after the attendance date 2026-10-27/),
      '7: is already registered in Workforce Management.',
      '99: does not appear in this sheet.',
      '1: listed twice.',
      expect.stringMatching(/^2: listed twice/),
    ]);
    expect(w.employees.createAll).not.toHaveBeenCalled();
  });

  it('refuses a shift that does not exist', async () => {
    const w = world();
    await expect(register(w, [input({ shiftId: 42 })])).rejects.toMatchObject({
      details: [{ field: 'employees.0', message: '1: the selected shift no longer exists.' }],
    });
    expect(w.employees.createAll).not.toHaveBeenCalled();
  });
});
