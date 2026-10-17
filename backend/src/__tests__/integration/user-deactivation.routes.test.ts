/**
 * User deactivation route tests: PATCH /api/v1/auth/users/:id/deactivate.
 * Regression: the validated :id arrives as a number, and was once read as 0.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

// ── Mocks must be hoisted above imports ──────────────────────────────────────

vi.mock('../../config/env', () => ({
  env: {
    NODE_ENV: 'test',
    PORT: 3001,
    DATABASE_URL: 'postgresql://test:test@localhost/test',
    JWT_SECRET: 'test-secret-at-least-32-characters-long!!',
    JWT_EXPIRES_IN: '15m',
    REFRESH_TOKEN_SECRET: 'test-refresh-secret-at-least-32-chars!!',
    REFRESH_TOKEN_EXPIRES_IN: '7d',
    BCRYPT_SALT_ROUNDS: 10,
    CORS_ORIGINS: 'http://localhost:5173',
    LOG_LEVEL: 'silent',
    RATE_LIMIT_MAX: 500,
  },
}));

vi.mock('../../lib/prismaClient', () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    refreshToken: { deleteMany: vi.fn() },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ max: null }]),
    $transaction: vi.fn((fns: unknown[]) => Promise.all(fns as Promise<unknown>[])),
  },
}));

vi.mock('../../utils/token', () => ({
  verifyAccessToken: vi.fn((token: string) => {
    if (token !== 'admin') throw new Error('invalid');
    return { sub: 1, email: 'admin@test.com', role: 'ADMIN' };
  }),
}));

vi.mock('../../logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    http: vi.fn(),
    debug: vi.fn(),
    log: vi.fn(),
  },
}));

// ── Load app after mocks ──────────────────────────────────────────────────────

import { prisma } from '../../lib/prismaClient';

const fn = (f: unknown) => f as ReturnType<typeof vi.fn>;

const user = (id: number, role: string, isActive = true) => ({
  id,
  fullName: `User ${id}`,
  email: `user${id}@test.com`,
  phone: null,
  isActive,
  lastLogin: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  role: { id: role === 'ADMIN' ? 1 : 2, name: role, description: null },
});

const USERS: Record<number, ReturnType<typeof user>> = {
  1: user(1, 'ADMIN'),
  5: user(5, 'MANAGER'),
};

let app: Express;

beforeAll(async () => {
  app = (await import('../../app')).default;
});

beforeEach(() => {
  vi.clearAllMocks();
  fn(prisma.user.findUnique).mockImplementation(({ where }: { where: { id: number } }) =>
    Promise.resolve(USERS[where.id] ?? null),
  );
  fn(prisma.user.update).mockImplementation(({ where }: { where: { id: number } }) =>
    Promise.resolve({ ...USERS[where.id], isActive: false }),
  );
  fn(prisma.refreshToken.deleteMany).mockResolvedValue({ count: 0 });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PATCH /api/v1/auth/users/:id/deactivate', () => {
  it('deactivates user 5 for an admin and returns 200', async () => {
    const res = await request(app)
      .patch('/api/v1/auth/users/5/deactivate')
      .set('Authorization', 'Bearer admin');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(5);
    expect(res.body.data.isActive).toBe(false);
    expect(fn(prisma.user.findUnique)).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 5 } }),
    );
    expect(fn(prisma.user.update)).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 5 }, data: { isActive: false } }),
    );
    expect(fn(prisma.refreshToken.deleteMany)).toHaveBeenCalledWith({ where: { userId: 5 } });
  });

  it('returns 404 for a user id that does not exist', async () => {
    const res = await request(app)
      .patch('/api/v1/auth/users/999/deactivate')
      .set('Authorization', 'Bearer admin');

    expect(res.status).toBe(404);
    expect(fn(prisma.user.update)).not.toHaveBeenCalled();
  });

  it('returns 400 when an admin tries to deactivate their own account', async () => {
    const res = await request(app)
      .patch('/api/v1/auth/users/1/deactivate')
      .set('Authorization', 'Bearer admin');

    expect(res.status).toBe(400);
    expect(fn(prisma.user.update)).not.toHaveBeenCalled();
  });
});
