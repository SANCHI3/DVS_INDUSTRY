import { describe, expect, it, vi } from 'vitest';
import {
  importAttendanceInsertOnly,
  type AttendanceImportRepository,
  type WorkbookAttendanceEntry,
} from '../../services/attendance-import.service';
import { createAttendanceSchema, bulkAttendanceSchema } from '../../validators/workforce.validator';
import * as XLSX from 'xlsx';
import { parseAttendanceWorkbook } from '../../services/attendance-workbook';

function entry(
  employeeCode: string,
  code: WorkbookAttendanceEntry['code'],
  sourceRow = 9,
): WorkbookAttendanceEntry {
  return { employeeCode, date: '2026-08-01', code, sourceRow };
}

function repo(overrides: Partial<AttendanceImportRepository> = {}): AttendanceImportRepository {
  return {
    findEmployeesByCodes: vi.fn(async (codes) =>
      codes.map((employeeCode, id) => ({ id: id + 1, employeeCode })),
    ),
    findExisting: vi.fn(async () => []),
    insertMany: vi.fn(async (rows) => rows.length),
    ...overrides,
  };
}

describe('attendance status validation', () => {
  it.each(['PRESENT', 'ABSENT', 'WEEK_OFF'] as const)('accepts %s', (status) => {
    expect(
      createAttendanceSchema.safeParse({ employeeId: 1, date: '2026-08-01', status }).success,
    ).toBe(true);
    expect(
      bulkAttendanceSchema.safeParse({ date: '2026-08-01', entries: [{ employeeId: 1, status }] })
        .success,
    ).toBe(true);
  });

  it.each(['WEEKLY_OFF', 'OVERTIME', 'WO', 'OT', 'UNKNOWN'])(
    'rejects unsupported status %s',
    (status) => {
      expect(
        createAttendanceSchema.safeParse({ employeeId: 1, date: '2026-08-01', status }).success,
      ).toBe(false);
      expect(
        bulkAttendanceSchema.safeParse({ date: '2026-08-01', entries: [{ employeeId: 1, status }] })
          .success,
      ).toBe(false);
    },
  );
});

describe('insert-only attendance importer', () => {
  it('maps P, A, and WO to existing attendance statuses', async () => {
    const repository = repo();
    const result = await importAttendanceInsertOnly(
      [entry('E1', 'P', 9), entry('E2', 'A', 10), entry('E3', 'WO', 11)],
      repository,
    );
    expect(result.inserted).toBe(3);
    expect(vi.mocked(repository.insertMany).mock.calls[0][0].map((r) => r.status)).toEqual([
      'PRESENT',
      'ABSENT',
      'WEEK_OFF',
    ]);
  });

  it('rejects invalid dates, unsupported codes, and the contradictory source row', async () => {
    const repository = repo();
    await expect(
      importAttendanceInsertOnly([{ ...entry('E1', 'P'), date: '2026-02-31' }], repository),
    ).rejects.toThrow('Invalid attendance date');
    await expect(
      importAttendanceInsertOnly(
        [entry('E1', 'NO' as WorkbookAttendanceEntry['code'])],
        repository,
      ),
    ).rejects.toThrow('Unsupported workbook code');
    await expect(
      importAttendanceInsertOnly([entry('E1', 'OT')], repository),
    ).resolves.toMatchObject({ inserted: 0, unsupportedOvertime: 1 });
    await expect(importAttendanceInsertOnly([entry('E1', 'P', 13)], repository)).rejects.toThrow(
      'Contradictory workbook row 13',
    );
    expect(repository.insertMany).not.toHaveBeenCalled();
  });

  it('skips duplicate source keys and existing employee/date records without updating them', async () => {
    const existingDate = new Date('2026-08-01T00:00:00.000Z');
    const repository = repo({
      findEmployeesByCodes: vi.fn(async () => [
        { id: 1, employeeCode: 'E1' },
        { id: 2, employeeCode: 'E2' },
      ]),
      findExisting: vi.fn(async () => [{ employeeId: 1, date: existingDate }]),
    });
    const result = await importAttendanceInsertOnly(
      [entry('E1', 'P', 9), entry('E2', 'A', 10), entry('E2', 'WO', 11)],
      repository,
    );
    expect(result).toMatchObject({ inserted: 1, existingRecords: 1, duplicateSource: 1 });
    expect(repository.insertMany).toHaveBeenCalledTimes(1);
    expect(vi.mocked(repository.insertMany).mock.calls[0][0].map((r) => r.employeeId)).toEqual([2]);
  });

  it('does not insert entries whose employee code cannot be mapped uniquely', async () => {
    const repository = repo({
      findEmployeesByCodes: vi.fn(async () => [
        { id: 1, employeeCode: 'E1' },
        { id: 2, employeeCode: 'E1' },
      ]),
    });
    const result = await importAttendanceInsertOnly([entry('E1', 'P')], repository);
    expect(result.ambiguousEmployee).toBe(1);
    expect(result.inserted).toBe(0);
    expect(repository.insertMany).not.toHaveBeenCalled();
  });

  it('extracts P/A/WO/OT with real calendar dates and excludes summary conflicts', () => {
    const headers = [
      'Emp. Code',
      ...Array.from({ length: 31 }, (_, i) => `${i + 1} D`),
      'P',
      'A',
      'WO',
    ];
    const good = [
      'E1',
      ...Array.from({ length: 31 }, (_, i) =>
        i === 0 ? 'P' : i === 1 ? 'WO' : i === 2 ? 'OT' : '',
      ),
      1,
      0,
      1,
    ];
    const conflict = ['E2', ...Array.from({ length: 31 }, (_, i) => (i === 0 ? 'A' : '')), 0, 0, 0];
    const sheet = XLSX.utils.aoa_to_sheet([
      ['', 'Aug 01 2026 To Aug 31 2026'],
      headers,
      good,
      conflict,
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Monthly Status');
    const parsed = parseAttendanceWorkbook(
      Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })),
    );
    expect(parsed.period).toEqual({ year: 2026, month: 8 });
    expect(parsed.excludedRows).toEqual([4]);
    expect(parsed.entries.map(({ date, code }) => [date, code])).toEqual([
      ['2026-08-01', 'P'],
      ['2026-08-02', 'WO'],
      ['2026-08-03', 'OT'],
    ]);
  });
});
