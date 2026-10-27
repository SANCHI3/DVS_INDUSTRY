/**
 * Adds demo data to the Production module.
 *
 *   Local:   npm run seed:production-demo -- --db dvs_factory_preview
 *   Remote:  TZ=Asia/Kolkata node dist/scripts/seed-production-demo.js --allow-remote
 *            (prints the target and writes nothing), then again with
 *            --confirm-host <that host>
 *
 * Uses DATABASE_URL from backend/.env (or the shell). --db swaps only the
 * database name. Any host other than this computer needs --allow-remote and
 * the host typed back; a remote database gets workforce and attendance only,
 * never demo work orders, output or targets. Safe to run again: existing
 * records are reused, never changed. See productionDemoSeed.ts.
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

async function main(): Promise<void> {
  const target = resolveSeedTarget(
    process.env['DATABASE_URL'],
    argValue('--db'),
    process.env['NODE_ENV'],
    {
      allowRemote: process.argv.includes('--allow-remote'),
      confirmHost: argValue('--confirm-host'),
    },
  );
  print(
    `Target database: ${target.host}:${target.port}/${target.database}${target.remote ? ' (REMOTE)' : ''}`,
  );
  if (target.remote) {
    print(
      `Demo workforce and attendance only; dates and times use time zone ${Intl.DateTimeFormat().resolvedOptions().timeZone}.`,
    );
  }

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
    const report = await seedProductionDemo(db, new Date(), { workOrders: !target.remote });
    print(JSON.stringify(report, null, 2));
    if (report.employees.notDemo.length > 0) {
      print(`Left alone (not created by this seed): ${report.employees.notDemo.join(', ')}`);
    }
    if (report.employees.removed.length > 0) {
      print(`Removed demo workers were not restored: ${report.employees.removed.join(', ')}`);
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : 'Demo seed failed.');
  process.exitCode = 1;
});
