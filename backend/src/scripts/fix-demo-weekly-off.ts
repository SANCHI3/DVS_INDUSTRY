/**
 * Demo data seeded before the weekly off was set to SATURDAY marked every
 * Sunday as Week Off and had demo workers working on Saturdays. This lists
 * those demo rows and, only when asked, removes them and re-runs the demo
 * seed so the last 7 days follow the plant calendar (Saturday off, Sunday
 * worked). Only demo rows are touched: employees DEMO-EMP-… whose remarks
 * start with "[DEMO]". Real attendance is never read for changing, and
 * demo work-order output is only listed, never moved.
 *
 *   List only (the default, writes nothing):
 *     npx tsx src/scripts/fix-demo-weekly-off.ts --allow-remote
 *   Remove and re-seed:
 *     npx tsx src/scripts/fix-demo-weekly-off.ts --allow-remote --apply --confirm-host <host>
 *
 * A database on this computer needs no --allow-remote / --confirm-host.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PLANT_WEEKLY_OFF_DAY, PLANT_WEEKLY_OFF_LABEL } from '../config/plant';
import {
  DEMO_MARK,
  DEMO_PERIOD_DAYS,
  resolveSeedTarget,
  seedProductionDemo,
  storedDay,
} from './productionDemoSeed';

const SUNDAY = 0;
const DAY_MS = 86_400_000;

export interface DemoAttendanceRow {
  id: number;
  employeeId: number;
  employeeCode: string;
  date: Date; // midnight UTC of the calendar day
  status: string;
}

export interface WeeklyOffFix {
  /** Sunday marked Week Off: Sunday is a working day */
  sundayWeekOffs: DemoAttendanceRow[];
  /** Worked on the weekly off within the seed's 7 days: re-seeded as Week Off */
  weeklyOffWorked: DemoAttendanceRow[];
}

/** Which demo attendance rows disagree with the plant calendar. */
export function findWeeklyOffFixes(
  rows: DemoAttendanceRow[],
  now: Date,
  weeklyOff: number = PLANT_WEEKLY_OFF_DAY,
): WeeklyOffFix {
  const windowStart = storedDay(new Date(now.getTime() - (DEMO_PERIOD_DAYS - 1) * DAY_MS));
  return {
    sundayWeekOffs: rows.filter(
      (r) => weeklyOff !== SUNDAY && r.status === 'WEEK_OFF' && r.date.getUTCDay() === SUNDAY,
    ),
    weeklyOffWorked: rows.filter(
      (r) =>
        r.status !== 'WEEK_OFF' &&
        r.date.getUTCDay() === weeklyOff &&
        r.date.getTime() >= windowStart.getTime(),
    ),
  };
}

const print = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const flag = (name: string): boolean => process.argv.includes(name);

const describe = (r: DemoAttendanceRow): string =>
  `  ${r.employeeCode}  ${r.date.toISOString().slice(0, 10)}  ${r.status}`;

async function main(): Promise<void> {
  const target = resolveSeedTarget(
    process.env['DATABASE_URL'],
    argValue('--db'),
    process.env['NODE_ENV'],
    { allowRemote: flag('--allow-remote'), confirmHost: argValue('--confirm-host') },
  );
  const apply = flag('--apply') && target.confirmed;
  print(
    `Target database: ${target.host}:${target.port}/${target.database}${target.remote ? ' (REMOTE)' : ''}`,
  );
  print(`Plant weekly off: ${PLANT_WEEKLY_OFF_LABEL}. Sunday is a working day.`);
  if (!apply) print('DRY RUN: nothing will be written.');

  const db = new PrismaClient({ datasourceUrl: target.url });
  try {
    const now = new Date();
    const raw = await db.attendance.findMany({
      where: {
        remarks: { startsWith: DEMO_MARK },
        employee: { employeeCode: { startsWith: 'DEMO-EMP-' } },
      },
      select: {
        id: true,
        employeeId: true,
        date: true,
        status: true,
        employee: { select: { employeeCode: true } },
      },
      orderBy: [{ date: 'asc' }, { employeeId: 'asc' }],
    });
    const rows = raw.map((r) => ({ ...r, employeeCode: r.employee.employeeCode }));
    const fix = findWeeklyOffFixes(rows, now);
    const outputsOnOff = await db.workOrderOutput.findMany({
      where: { workOrder: { workOrderNumber: { startsWith: 'DEMO-WO-' } } },
      select: { recordedAt: true, workOrder: { select: { workOrderNumber: true } } },
    });
    const offDayOutputs = outputsOnOff.filter(
      (o) => storedDay(o.recordedAt).getUTCDay() === PLANT_WEEKLY_OFF_DAY,
    );

    print(`\nDemo attendance rows checked: ${rows.length}`);
    print(`Sundays marked Week Off (will be removed): ${fix.sundayWeekOffs.length}`);
    fix.sundayWeekOffs.forEach((r) => print(describe(r)));
    print(
      `${PLANT_WEEKLY_OFF_LABEL}s worked in the last ${DEMO_PERIOD_DAYS} days (re-seeded as Week Off): ${fix.weeklyOffWorked.length}`,
    );
    fix.weeklyOffWorked.forEach((r) => print(describe(r)));
    print(
      `Demo work-order output recorded on a ${PLANT_WEEKLY_OFF_LABEL} (listed only, not changed): ${offDayOutputs.length}`,
    );

    const remove = [...fix.sundayWeekOffs, ...fix.weeklyOffWorked];
    if (remove.length === 0) {
      print('\nNothing to fix.');
      return;
    }
    if (!apply) {
      print(
        `\nTo remove these ${remove.length} demo rows and re-seed the last ${DEMO_PERIOD_DAYS} days, run again with --apply` +
          (target.remote ? ` --confirm-host ${target.host}` : ''),
      );
      return;
    }

    await db.$transaction([
      // The same worker's demo performance for those days goes with the attendance
      db.employeeDailyOutput.deleteMany({
        where: {
          remarks: { startsWith: DEMO_MARK },
          OR: remove.map((r) => ({ employeeId: r.employeeId, date: r.date })),
        },
      }),
      db.attendance.deleteMany({
        where: { id: { in: remove.map((r) => r.id) }, remarks: { startsWith: DEMO_MARK } },
      }),
    ]);
    print(`\nRemoved ${remove.length} demo attendance rows. Re-seeding the demo week…`);
    const report = await seedProductionDemo(db, now, { workOrders: false });
    print(JSON.stringify(report, null, 2));
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : 'Fix failed.');
    process.exitCode = 1;
  });
}
