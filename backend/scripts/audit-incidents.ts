/**
 * READ-ONLY audit of incidents created by the perception service.
 *
 * Answers "are these false incidents new, or old records?" without changing
 * anything: it only runs SELECT queries (prisma.securityIncident.findMany) and
 * never updates or deletes rows. Review and close records from the dashboard.
 *
 * Usage (from backend/):
 *   npx tsx scripts/audit-incidents.ts                       # last 30 days
 *   npx tsx scripts/audit-incidents.ts --since 2026-10-01
 *   npx tsx scripts/audit-incidents.ts --cutoff 2026-10-15T14:00:00+05:30
 *
 * --cutoff is when the false-positive fixes were deployed (perception service
 * restarted). Records before it were produced by the old validation logic.
 * The script also flags confidence values that match the old, fabricated
 * formulas (see perception-service/docs/FALSE_POSITIVE_FIXES.md).
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseDate(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid date: ${value}`);
  return parsed;
}

/** Signatures of the confidence formulas used before validation version 2. */
function legacySignature(type: string, title: string, confidence: number | null): string | null {
  if (confidence === null) return null;
  const event = title.toLowerCase();
  // crowd: 0.62 + overflow * 0.07
  if ((type === 'CROWD' || event === 'crowd') && confidence >= 0.62 && confidence <= 0.95) {
    const steps = (confidence - 0.62) / 0.07;
    if (Math.abs(steps - Math.round(steps)) < 0.03) return 'crowd confidence matches old formula 0.62 + n*0.07';
  }
  // anomaly: 1 - exp(-ratio) against the training-scene threshold (>= 0.63 always)
  if (event === 'anomaly' && confidence >= 0.63) {
    return 'anomaly confidence from uncalibrated 1 - exp(-ratio)';
  }
  return null;
}

async function main(): Promise<void> {
  const now = new Date();
  const since = parseDate(argument('since'), new Date(now.getTime() - 30 * 24 * 3600 * 1000));
  const cutoffText = argument('cutoff');
  const cutoff = cutoffText ? parseDate(cutoffText, now) : null;

  const prisma = new PrismaClient();
  try {
    const rows = await prisma.securityIncident.findMany({
      where: {
        occurredAt: { gte: since },
        deletedAt: null,
        reportedByName: { contains: 'Perception', mode: 'insensitive' },
      },
      select: {
        incidentNumber: true,
        title: true,
        type: true,
        severity: true,
        status: true,
        confidenceScore: true,
        location: true,
        occurredAt: true,
        createdAt: true,
      },
      orderBy: { occurredAt: 'asc' },
    });

    console.log(`Perception-service incidents since ${since.toISOString()}: ${rows.length}`);
    if (cutoff) console.log(`Fix deployed (cutoff): ${cutoff.toISOString()}`);
    console.log('This script is read-only; nothing is modified or deleted.\n');

    const groups = new Map<string, { count: number; minConf: number; maxConf: number; legacy: number }>();
    const flagged: string[] = [];
    for (const row of rows) {
      const day = row.occurredAt.toISOString().slice(0, 10);
      const period = cutoff ? (row.occurredAt < cutoff ? 'before-fix' : 'after-fix') : '-';
      const key = `${day}\t${period}\t${row.title}\t${row.type}\t${row.location ?? '-'}`;
      const confidence = row.confidenceScore ?? 0;
      const group = groups.get(key) ?? { count: 0, minConf: 1, maxConf: 0, legacy: 0 };
      group.count += 1;
      group.minConf = Math.min(group.minConf, confidence);
      group.maxConf = Math.max(group.maxConf, confidence);
      const signature = legacySignature(row.type, row.title, row.confidenceScore);
      if (signature) {
        group.legacy += 1;
        flagged.push(
          `${row.incidentNumber}\t${row.occurredAt.toISOString()}\t${row.title}\t` +
            `${row.confidenceScore}\t${row.status}\t${signature}`,
        );
      }
      groups.set(key, group);
    }

    console.log('day\tperiod\tevent\ttype\tlocation\tcount\tconfidence range\told-formula matches');
    for (const [key, group] of groups) {
      console.log(
        `${key}\t${group.count}\t${group.minConf.toFixed(2)}-${group.maxConf.toFixed(2)}\t${group.legacy}`,
      );
    }
    if (flagged.length) {
      console.log(`\nRecords whose confidence matches a pre-fix formula (${flagged.length}):`);
      console.log('incident\toccurredAt\tevent\tconfidence\tstatus\tsignature');
      flagged.forEach((line) => console.log(line));
    }
    if (cutoff) {
      const after = rows.filter((row) => row.occurredAt >= cutoff).length;
      console.log(`\nBefore fix: ${rows.length - after}   After fix: ${after}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
