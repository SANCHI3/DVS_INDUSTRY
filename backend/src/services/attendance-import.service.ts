import type { AttendanceStatus } from '../interfaces';

export type WorkbookAttendanceCode = 'P' | 'A' | 'WO' | 'OT';

export interface WorkbookAttendanceEntry {
  employeeCode: string;
  date: string;
  code: WorkbookAttendanceCode;
  sourceRow: number;
}

export interface AttendanceImportRepository {
  findEmployeesByCodes(codes: string[]): Promise<Array<{ id: number; employeeCode: string }>>;
  findExisting(
    employeeIds: number[],
    dates: Date[],
  ): Promise<Array<{ employeeId: number; date: Date }>>;
  insertMany(
    rows: Array<{ employeeId: number; date: Date; status: AttendanceStatus; remarks: string }>,
  ): Promise<number>;
}

const codeToStatus: Partial<Record<WorkbookAttendanceCode, AttendanceStatus>> = {
  P: 'PRESENT',
  A: 'ABSENT',
  WO: 'WEEK_OFF',
};

/** Import verified workbook marks additively. Existing and ambiguous keys are never updated. */
export async function importAttendanceInsertOnly(
  entries: WorkbookAttendanceEntry[],
  repository: AttendanceImportRepository,
) {
  const sourceRows = new Set<string>();
  for (const entry of entries) {
    if (entry.sourceRow === 13) throw new Error('Contradictory workbook row 13 must be excluded');
    if (!entry.employeeCode.trim()) throw new Error('Employee code is required');
    const parsedDate = new Date(`${entry.date}T00:00:00.000Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) ||
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== entry.date
    ) {
      throw new Error(`Invalid attendance date: ${entry.date}`);
    }
    if (!['P', 'A', 'WO', 'OT'].includes(entry.code))
      throw new Error(`Unsupported workbook code: ${entry.code}`);
    const sourceKey = `${entry.sourceRow}:${entry.date}`;
    if (sourceRows.has(sourceKey))
      throw new Error(`Duplicate source employee/date in row ${entry.sourceRow}`);
    sourceRows.add(sourceKey);
  }

  const importable = entries.filter((entry) => codeToStatus[entry.code] !== undefined);
  const codes = [...new Set(importable.map((entry) => entry.employeeCode.trim()))];
  const employees = await repository.findEmployeesByCodes(codes);
  const byCode = new Map<string, number[]>();
  for (const employee of employees)
    byCode.set(employee.employeeCode, [...(byCode.get(employee.employeeCode) ?? []), employee.id]);

  let unknownEmployee = 0;
  let ambiguousEmployee = 0;
  const unsupportedOvertime = entries.filter((entry) => entry.code === 'OT').length;
  const mapped: Array<{
    employeeId: number;
    date: Date;
    status: AttendanceStatus;
    remarks: string;
  }> = [];
  for (const entry of importable) {
    const matches = byCode.get(entry.employeeCode.trim()) ?? [];
    if (matches.length === 0) {
      unknownEmployee++;
      continue;
    }
    if (matches.length !== 1) {
      ambiguousEmployee++;
      continue;
    }
    mapped.push({
      employeeId: matches[0]!,
      date: new Date(`${entry.date}T00:00:00.000Z`),
      status: codeToStatus[entry.code]!,
      remarks: `Imported from August 2026 attendance workbook (source row ${entry.sourceRow})`,
    });
  }

  const dates = [...new Map(mapped.map((row) => [row.date.toISOString(), row.date])).values()];
  const existing = await repository.findExisting(
    [...new Set(mapped.map((row) => row.employeeId))],
    dates,
  );
  const existingKeys = new Set(
    existing.map((row) => `${row.employeeId}:${row.date.toISOString().slice(0, 10)}`),
  );
  const sourceKeys = new Set<string>();
  let duplicateSource = 0;
  let existingRecords = 0;
  const newRows = mapped.filter((row) => {
    const key = `${row.employeeId}:${row.date.toISOString().slice(0, 10)}`;
    if (sourceKeys.has(key)) {
      duplicateSource++;
      return false;
    }
    sourceKeys.add(key);
    if (existingKeys.has(key)) {
      existingRecords++;
      return false;
    }
    return true;
  });
  const inserted = newRows.length > 0 ? await repository.insertMany(newRows) : 0;
  return {
    inserted,
    existingRecords,
    duplicateSource,
    unknownEmployee,
    ambiguousEmployee,
    unsupportedOvertime,
  };
}
