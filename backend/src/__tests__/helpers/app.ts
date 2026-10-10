/**
 * Test helpers — shared across all test suites.
 *
 * Strategy: unit tests mock the Prisma client so no real DB is needed.
 * Integration tests use supertest against the real Express app.
 */

import { vi } from 'vitest';
import type { Express } from 'express';

// ── Prisma mock factory ───────────────────────────────────────────────────────
// Each test file imports this and calls mockPrisma() to get a typed mock.

export type DeepPartialMock<T> = {
  [K in keyof T]?: T[K] extends (...args: infer A) => infer R
    ? ReturnType<typeof vi.fn<A, R>>
    : DeepPartialMock<T[K]>;
};

/**
 * Build a minimal Prisma client mock.
 * Call `vi.mock('../../../lib/prismaClient', () => ({ prisma: mockPrisma() }))`
 * at the TOP of any test file that needs it.
 */
export function buildPrismaMock() {
  const model = () => ({
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    groupBy: vi.fn(),
    aggregate: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  });

  return {
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ max: null }]),
    $transaction: vi.fn((arg: unknown) => {
      // If passed an array, resolve each fn; if a callback, call it
      if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
      if (typeof arg === 'function') return arg({});
      return Promise.resolve([]);
    }),
    $disconnect: vi.fn(),
    role: model(),
    user: model(),
    refreshToken: model(),
    department: model(),
    employee: model(),
    shift: model(),
    attendance: model(),
    material: model(),
    stockTransaction: model(),
    scrapRecord: model(),
    supplier: model(),
    client: model(),
    clientOrder: model(),
    purchaseOrder: model(),
    workOrder: model(),
    workOrderOutput: model(),
    securityIncident: model(),
    incidentUpdate: model(),
    securityAlert: model(),
    auditLog: model(),
  };
}

// ── JWT helpers for integration tests ────────────────────────────────────────
import jwt from 'jsonwebtoken';

const TEST_SECRET = process.env['JWT_ACCESS_SECRET'] ?? 'test-secret';

export function signTestToken(payload: { sub: number; email: string; role: string }): string {
  return jwt.sign(payload, TEST_SECRET, { expiresIn: '1h' });
}

export function adminToken(): string {
  return signTestToken({ sub: 1, email: 'admin@test.com', role: 'ADMIN' });
}

export function managerToken(): string {
  return signTestToken({ sub: 2, email: 'manager@test.com', role: 'MANAGER' });
}

/**
 * authenticate() looks the user up after verifying the token. Integration
 * tests stub verifyAccessToken per test, so make the user lookup return an
 * active account matching whatever the token stub most recently returned.
 */
export function mirrorTokenUser(
  findUnique: ReturnType<typeof vi.fn>,
  verifyAccessToken: ReturnType<typeof vi.fn>,
): void {
  findUnique.mockImplementation(() => {
    const last = verifyAccessToken.mock.results.at(-1);
    if (last === undefined || last.type !== 'return') return Promise.resolve(null);
    const payload = last.value as { sub: number; email: string; role: string };
    return Promise.resolve({
      id: payload.sub,
      email: payload.email,
      fullName: payload.email,
      isActive: true,
      role: { name: payload.role },
    });
  });
}

// ── App loader (lazy — avoids connecting Prisma at import time) ───────────────
let _app: Express | null = null;

export async function getApp(): Promise<Express> {
  if (!_app) {
    const mod = await import('../../app');
    _app = mod.default;
  }
  return _app;
}
