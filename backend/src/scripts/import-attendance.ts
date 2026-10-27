import { readFile } from 'node:fs/promises';
import { env } from '../config/env';
import { prisma } from '../lib/prismaClient';
import { importAttendanceInsertOnly } from '../services/attendance-import.service';
import { parseAttendanceWorkbook } from '../services/attendance-workbook';

async function main() {
  const url = new URL(env.DATABASE_URL);
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new Error('This importer is local-only and refuses non-local database hosts.');
  }
  const inputPath = process.argv[2];
  if (!inputPath) throw new Error('Usage: npm run import:attendance -- <attendance-workbook.xls>');
  const parsed = parseAttendanceWorkbook(await readFile(inputPath));
  if (parsed.period.year !== 2026 || parsed.period.month !== 8) {
    throw new Error('This importer accepts only the verified August 2026 attendance workbook.');
  }

  const result = await importAttendanceInsertOnly(parsed.entries, {
    findEmployeesByCodes: (codes) =>
      prisma.employee.findMany({
        where: { employeeCode: { in: codes }, deletedAt: null },
        select: { id: true, employeeCode: true },
      }),
    findExisting: (employeeIds, dates) => {
      if (employeeIds.length === 0 || dates.length === 0) return Promise.resolve([]);
      return prisma.attendance.findMany({
        where: { employeeId: { in: employeeIds }, date: { in: dates } },
        select: { employeeId: true, date: true },
      });
    },
    insertMany: async (rows) => {
      if (rows.length === 0) return 0;
      const result = await prisma.attendance.createMany({ data: rows, skipDuplicates: true });
      return result.count;
    },
  });
  console.log(
    JSON.stringify(
      {
        period: parsed.period,
        excludedSourceRows: parsed.excludedRows,
        ignoredBlankCells: parsed.ignoredBlankCells,
        ...result,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Attendance import failed.');
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
