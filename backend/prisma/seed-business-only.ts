/**
 * Loads only the business records from seed-business-data.ts (supplier and
 * client invoices, received stock, part master) — no roles or users.
 *
 *   Local:   npm run db:seed:business
 *   Remote:  DATABASE_URL=<neon url> npm run db:seed:business
 *            (prints the target and writes nothing), then again with
 *            -- --confirm-host <that host>
 *
 * Safe to run again: records are upserted and stock is booked once.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { seedBusinessData } from './seed-business-data';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is not set.');
  const { hostname, port, pathname } = new URL(url);
  const remote = !LOCAL_HOSTS.has(hostname);
  console.log(`Target database: ${hostname}:${port || 5432}${pathname}${remote ? ' (REMOTE)' : ''}`);

  if (remote && argValue('--confirm-host') !== hostname) {
    console.log(`Nothing written. To write to this database run again with --confirm-host ${hostname}`);
    return;
  }

  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    const [check] = await prisma.$queryRaw<Array<{ parts: boolean }>>`
      SELECT to_regclass('public."PartSpec"') IS NOT NULL AS parts`;
    if (!check?.parts) {
      throw new Error('The PartSpec table is missing. Run npx prisma migrate deploy against this database first.');
    }
    await seedBusinessData(prisma);
    console.log('\n✅  Business data loaded');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : 'Business seed failed.');
  process.exitCode = 1;
});
