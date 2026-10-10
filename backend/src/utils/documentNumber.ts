import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prismaClient';

/**
 * Tables/columns that carry human-readable sequential numbers. Identifiers are
 * interpolated into SQL, so they must only ever come from this fixed list.
 */
const NUMBERED_COLUMNS = {
  clientOrder: { table: 'ClientOrder', column: 'orderNumber' },
  purchaseOrder: { table: 'PurchaseOrder', column: 'poNumber' },
  workOrder: { table: 'WorkOrder', column: 'workOrderNumber' },
  securityIncident: { table: 'SecurityIncident', column: 'incidentNumber' },
  securityAlert: { table: 'SecurityAlert', column: 'alertNumber' },
} as const;

export type NumberedEntity = keyof typeof NUMBERED_COLUMNS;

/**
 * Returns the next number for `prefix` (e.g. "INC-") as max(existing) + 1.
 *
 * Computed numerically in SQL, so it ignores numbers in other formats (such as
 * perception-service IDs), keeps counting past 9999, and never loads the
 * whole table.
 */
export async function nextDocumentNumber(
  entity: NumberedEntity,
  prefix: string,
  options: { pad?: number; start?: number } = {},
): Promise<string> {
  const { table, column } = NUMBERED_COLUMNS[entity];
  const pad = options.pad ?? 0;
  const start = options.start ?? 1;

  const rows = await prisma.$queryRawUnsafe<{ max: number | null }[]>(
    `SELECT MAX(CAST(SUBSTRING("${column}" FROM $1::int) AS BIGINT))::int AS max
       FROM "${table}"
      WHERE "${column}" ~ $2`,
    prefix.length + 1,
    `^${prefix.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}[0-9]+$`,
  );

  const max = rows[0]?.max ?? null;
  const next = max === null ? start : Math.max(max + 1, start);
  return `${prefix}${String(next).padStart(pad, '0')}`;
}

/**
 * Runs `create` and retries when it loses a race on a unique number
 * (two requests computed the same "next" value). Each attempt must
 * generate a fresh number inside `create`.
 */
export async function withUniqueNumberRetry<T>(create: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await create();
    } catch (err) {
      const isUniqueViolation =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
      if (!isUniqueViolation || i >= attempts) throw err;
    }
  }
}
