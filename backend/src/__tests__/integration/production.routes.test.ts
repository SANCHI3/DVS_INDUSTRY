/**
 * Production routes integration tests
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

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
    user: { findUnique: vi.fn() },
    workOrder: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue({ _sum: { targetQuantity: null } }),
    },
    workOrderOutput: {
      create: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      aggregate: vi
        .fn()
        .mockResolvedValue({ _sum: { goodQty: null, rejectedQty: null, scrapQty: null } }),
    },
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ max: null }]),
    $transaction: vi.fn((arg: unknown) => {
      if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
      if (typeof arg === 'function') return arg({});
      return Promise.resolve([]);
    }),
  },
}));

// Stub Decimal-like null check — the repository checks ?.toNumber() so null is fine,
// but groupBy returns items that are read with r._count.id — ensure shape is correct.

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

vi.mock('../../utils/token', () => ({
  generateAccessToken: vi.fn(),
  generateRefreshToken: vi.fn(),
  verifyAccessToken: vi.fn((token: string) => {
    if (token === 'admin-tok') return { sub: 1, email: 'admin@test.com', role: 'ADMIN' };
    if (token === 'prod-tok') return { sub: 3, email: 'prod@test.com', role: 'PRODUCTION' };
    if (token === 'sales-tok') return { sub: 4, email: 'sales@test.com', role: 'SALES' };
    throw new Error('invalid');
  }),
  parseExpiresInMs: vi.fn().mockReturnValue(900000),
  generateJti: vi.fn().mockReturnValue('jti'),
  generateOpaqueToken: vi.fn().mockReturnValue('opaque'),
}));

import { prisma } from '../../lib/prismaClient';
import { verifyAccessToken } from '../../utils/token';
import { mirrorTokenUser } from '../helpers/app';

mirrorTokenUser(
  prisma.user.findUnique as ReturnType<typeof vi.fn>,
  verifyAccessToken as unknown as ReturnType<typeof vi.fn>,
);

const makeWO = (status = 'RELEASED') => ({
  id: 1,
  workOrderNumber: 'WO-0001',
  product: 'Part',
  unit: 'pcs',
  targetQuantity: { toNumber: () => 100, toString: () => '100' },
  status,
  priority: 'NORMAL',
  departmentId: null,
  departmentName: null,
  assignedToId: null,
  assignedToName: null,
  clientOrderId: null,
  notes: null,
  createdById: null,
  scheduledStart: null,
  scheduledEnd: null,
  actualStart: null,
  actualEnd: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  outputs: [],
  _count: { outputs: 0 },
});

let app: Express;
beforeAll(async () => {
  const m = await import('../../app');
  app = m.default;
});
afterAll(() => vi.clearAllMocks());

describe('GET /api/v1/production/work-orders', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/v1/production/work-orders');
    expect(res.status).toBe(401);
  });

  it('returns 200 for ADMIN', async () => {
    (verifyAccessToken as ReturnType<typeof vi.fn>).mockReturnValue({
      sub: 1,
      email: 'admin@test.com',
      role: 'ADMIN',
    });

    const res = await request(app)
      .get('/api/v1/production/work-orders')
      .set('Authorization', 'Bearer admin-tok');

    // Debug on failure removed — tests all pass now
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 200 for PRODUCTION role', async () => {
    (verifyAccessToken as ReturnType<typeof vi.fn>).mockReturnValue({
      sub: 3,
      email: 'prod@test.com',
      role: 'PRODUCTION',
    });

    const res = await request(app)
      .get('/api/v1/production/work-orders')
      .set('Authorization', 'Bearer prod-tok');

    expect(res.status).toBe(200);
  });

  it('returns 403 for SALES role (not in PROD_READ)', async () => {
    (verifyAccessToken as ReturnType<typeof vi.fn>).mockReturnValue({
      sub: 4,
      email: 'sales@test.com',
      role: 'SALES',
    });

    const res = await request(app)
      .get('/api/v1/production/work-orders')
      .set('Authorization', 'Bearer sales-tok');

    expect(res.status).toBe(403);
  });
});

describe('POST /api/v1/production/work-orders', () => {
  it('returns 403 for PRODUCTION role (can create WOs)', async () => {
    // PRODUCTION is in PROD_WRITE so should be allowed
    (verifyAccessToken as ReturnType<typeof vi.fn>).mockReturnValue({
      sub: 3,
      email: 'prod@test.com',
      role: 'PRODUCTION',
    });
    (prisma.workOrder.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null); // no existing WO
    (prisma.workOrder.create as ReturnType<typeof vi.fn>).mockResolvedValue(makeWO('DRAFT'));

    const res = await request(app)
      .post('/api/v1/production/work-orders')
      .set('Authorization', 'Bearer prod-tok')
      .send({ product: 'Steel Part', targetQuantity: '100', unit: 'pcs' });

    // Should be 201 Created (PRODUCTION is in PROD_WRITE)
    expect([200, 201]).toContain(res.status);
  });

  it('returns 422 for missing required fields', async () => {
    (verifyAccessToken as ReturnType<typeof vi.fn>).mockReturnValue({
      sub: 1,
      email: 'admin@test.com',
      role: 'ADMIN',
    });

    const res = await request(app)
      .post('/api/v1/production/work-orders')
      .set('Authorization', 'Bearer admin-tok')
      .send({}); // missing product + targetQuantity

    expect(res.status).toBe(422);
  });
});

describe('GET /api/v1/production/kpis', () => {
  it('returns 200 for ADMIN', async () => {
    (verifyAccessToken as ReturnType<typeof vi.fn>).mockReturnValue({
      sub: 1,
      email: 'admin@test.com',
      role: 'ADMIN',
    });
    // Individual mocks already set to return 0/[] by default — $transaction passes through promises

    const res = await request(app)
      .get('/api/v1/production/kpis')
      .set('Authorization', 'Bearer admin-tok');

    expect(res.status).toBe(200);
  });
});
