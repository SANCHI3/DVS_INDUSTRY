/**
 * Adds demo data to the Production module.
 *
 *   Local:   npm run seed:production-demo -- --db dvs_factory_preview
 *   Remote:  npx tsx src/scripts/seed-production-demo.ts --allow-remote [--with-work-orders]
 *            reads the remote database and prints what a run would do, writing
 *            nothing; run it again with --confirm-host <that host> to write.
 *
 * Uses DATABASE_URL from backend/.env (or the shell). --db swaps only the
 * database name. Any host other than this computer needs --allow-remote and
 * the host typed back. A remote database gets workforce and attendance only,
 * unless --with-work-orders also adds the demo work orders, their output and
 * (when the month has none) a target. --upgrade-old-demo updates demo workers
 * an earlier version of this seed created; --dry-run writes nothing anywhere.
 * Safe to run again: existing records are reused, never changed. See
 * productionDemoSeed.ts.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { resolveSeedTarget, seedProductionDemo } from './productionDemoSeed';

// stdout, not the app logger: this is a one-off command-line script
const print = (line: string): void => {
  process.stdout.write(`${line}
`);
};

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const flag = (name: string): boolean => process.argv.includes(name);

async function main(): Promise<void> {
  const target = resolveSeedTarget(
    process.env['DATABASE_URL'],
    argValue('--db'),
    process.env['NODE_ENV'],
    { allowRemote: flag('--allow-remote'), confirmHost: argValue('--confirm-host') },
  );
  const dryRun = flag('--dry-run') || !target.confirmed;
  const workOrders = !target.remote || flag('--with-work-orders');
  print(
    `Target database: ${target.host}:${target.port}/${target.database}${target.remote ? ' (REMOTE)' : ''}`,
  );
  print(
    `Demo ${workOrders ? 'workforce, attendance and work orders' : 'workforce and attendance only'}; ` +
      `dates and times use time zone ${Intl.DateTimeFormat().resolvedOptions().timeZone}.`,
  );
  if (dryRun) print('DRY RUN: nothing will be written. Counts show what a real run would do.');

  const db = new PrismaClient({ datasourceUrl: target.url });
  try {
    // The demo needs the Production migrations (week off, daily performance, monthly targets)
    const [check] = await db.$queryRaw<
      Array<{ output: boolean; target: boolean; weekOff: boolean }>
    >`
      SELECT to_regclass('public."EmployeeDailyOutput"') IS NOT NULL AS output,
             to_regclass('public."ProductionMonthlyTarget"') IS NOT NULL AS target,
             EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                      WHERE t.typname = 'AttendanceStatus' AND e.enumlabel = 'WEEK_OFF') AS "weekOff"`;
    if (!check?.output || !check.target || !check.weekOff) {
      throw new Error(
        `${target.database} is missing the Production migrations. Apply them to this database first ` +
          '(npx prisma migrate deploy with DATABASE_URL pointing at it).',
      );
    }
    const report = await seedProductionDemo(db, new Date(), {
      workOrders,
      upgradeOldDemo: flag('--upgrade-old-demo'),
      dryRun,
    });
    print(JSON.stringify(report, null, 2));
    const e = report.employees;
    if (e.notDemo.length > 0)
      print(`Left alone (not created by this seed): ${e.notDemo.join(', ')}`);
    if (e.removed.length > 0)
      print(`Removed demo workers were not restored: ${e.removed.join(', ')}`);
    if (e.outdated.length > 0 || e.extra.length > 0) {
      print(
        `Demo workers from an earlier version of this seed: ${[...e.outdated, ...e.extra].join(', ')}. ` +
          'They got no new demo activity. Add --upgrade-old-demo to rename them to the current ' +
          'plan and remove the ones no longer in it.',
      );
    }
    if (workOrders && report.workOrders.otherThisMonth > 0) {
      print(
        `Note: ${report.workOrders.otherThisMonth} non-demo work order(s) were created this month; ` +
          "Company Performance totals will add the demo orders' figures to theirs.",
      );
    }
    if (target.remote && !target.confirmed) {
      print(`To write this, run again with --confirm-host ${target.host}`);
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : 'Demo seed failed.');
  process.exitCode = 1;
});
