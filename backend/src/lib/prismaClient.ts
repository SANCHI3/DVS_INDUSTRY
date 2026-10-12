import { PrismaClient } from '@prisma/client';
import { env } from '../config/env';

/**
 * Singleton PrismaClient.
 *
 * In development, Node's module cache keeps a single instance across hot
 * reloads. In production there is only ever one process, so this is simply
 * the module-level singleton pattern.
 *
 * The global trick prevents "too many connections" warnings from tsx watch
 * which re-evaluates modules on every reload.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
