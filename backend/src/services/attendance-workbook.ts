import * as XLSX from 'xlsx';
import type { WorkbookAttendanceEntry } from './attendance-import.service';

export interface AttendanceWorkbookParseResult {
  period: { year: number; month: number };
  entries: WorkbookAttendanceEntry[];
  excludedRows: number[];
  ignoredBlankCells: number;
}

const monthNumbers: Record<string, number> = {
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

function cellText(value: unknown): string {
  // sheet_to_json gives strings, numbers and booleans; anything else is blank
  const text =
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : '';
  return text.trim();
}

/** Reads the monthly report's day grid and drops entire rows whose P/A/WO totals conflict. */
export function parseAttendanceWorkbook(buffer: Buffer): AttendanceWorkbookParseResult {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('Workbook contains no worksheet.');
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName]!, {
    header: 1,
    defval: '',
  });
  const headerRowIndex = rows.findIndex(
    (row) =>
      row.some((cell) => /^(?:1\s)/i.test(cellText(cell))) &&
      row.some((cell) => cellText(cell) === 'Emp. Code'),
  );
  if (headerRowIndex < 0) throw new Error('Could not locate employee and attendance day headings.');
  const header = rows[headerRowIndex]!;
  const codeIndex = header.findIndex((cell) => cellText(cell) === 'Emp. Code');
  const dayColumns = header.flatMap((cell, index) => {
    const match = cellText(cell).match(/^(\d{1,2})\s/);
    return match ? [{ day: Number(match[1]), index }] : [];
  });
  const summaryColumns = new Map<string, number>();
  header.forEach((cell, index) => {
    const label = cellText(cell);
    if (['P', 'A', 'WO'].includes(label)) summaryColumns.set(label, index);
  });
  if (
    codeIndex < 0 ||
    dayColumns.length !== 31 ||
    ['P', 'A', 'WO'].some((key) => !summaryColumns.has(key))
  ) {
    throw new Error('Workbook is missing employee code, daily columns, or P/A/WO summary totals.');
  }

  const periodText = rows
    .slice(0, headerRowIndex)
    .flat()
    .map(cellText)
    .find((value) => /\b\w{3}\s+\d{1,2}\s+\d{4}\s+To\s+\w{3}\s+\d{1,2}\s+\d{4}\b/i.test(value));
  const periodMatch = periodText?.match(
    /\b([A-Za-z]{3})\s+\d{1,2}\s+(\d{4})\s+To\s+([A-Za-z]{3})\s+\d{1,2}\s+(\d{4})\b/i,
  );
  if (
    !periodMatch ||
    periodMatch[1]!.toLowerCase() !== periodMatch[3]!.toLowerCase() ||
    periodMatch[2] !== periodMatch[4]
  ) {
    throw new Error('Workbook does not declare one unambiguous monthly reporting period.');
  }
  const month = monthNumbers[periodMatch[1]!.slice(0, 3).toLowerCase()];
  const year = Number(periodMatch[2]);
  if (
    !month ||
    dayColumns.some(({ day }) => day > new Date(Date.UTC(year, month, 0)).getUTCDate())
  ) {
    throw new Error('Workbook day headings do not fit the reporting month.');
  }

  const entries: WorkbookAttendanceEntry[] = [];
  const excludedRows: number[] = [];
  let ignoredBlankCells = 0;
  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex]!;
    const employeeCode = cellText(row[codeIndex]);
    if (!employeeCode) continue;
    const dayMarks: Array<{ day: number; code: string }> = [];
    const totals: Record<'P' | 'A' | 'WO', number> = { P: 0, A: 0, WO: 0 };
    for (const column of dayColumns) {
      const code = cellText(row[column.index]).toUpperCase();
      if (!code) {
        ignoredBlankCells++;
        continue;
      }
      if (!['P', 'A', 'WO', 'OT'].includes(code))
        throw new Error(`Unexpected attendance code on worksheet row ${rowIndex + 1}.`);
      dayMarks.push({ day: column.day, code });
      if (code === 'P' || code === 'A' || code === 'WO') totals[code]++;
    }
    const conflicts = (['P', 'A', 'WO'] as const).some((key) => {
      const summaryIndex = summaryColumns.get(key)!;
      const summaryValue = cellText(row[summaryIndex]);
      return (
        summaryValue === '' ||
        !Number.isFinite(Number(summaryValue)) ||
        Number(summaryValue) !== totals[key]
      );
    });
    if (conflicts) {
      excludedRows.push(rowIndex + 1);
      continue;
    }

    for (const { day, code } of dayMarks) {
      entries.push({
        employeeCode,
        date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        code: code as WorkbookAttendanceEntry['code'],
        sourceRow: rowIndex + 1,
      });
    }
  }
  return { period: { year, month }, entries, excludedRows, ignoredBlankCells };
}
