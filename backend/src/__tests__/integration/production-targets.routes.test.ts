/**
 * Monthly production targets & KPI thresholds: editable by management,
 * compared with — never mixed into — recorded work-order output.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { mirrorTokenUser } from '../helpers/app';

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

vi.mock('../../lib/prismaClient', () => {
  const model = () => ({
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    aggregate: vi.fn(),
  });
  return {
    prisma: {
      productionMonthlyTarget: model(),
      workOrderOutput: model(),
      workOrder: model(),
      employeeDailyOutput: model(),
      user: model(),
      $transaction: vi.fn((arg: unknown) =>
        Array.isArray(arg) ? Promise.all(arg as Promise<unknown>[]) : Promise.resolve([]),
      ),
    },
  };
});

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

const ROLE_BY_TOKEN: Record<string, string> = {
  'admin-token': 'ADMIN',
  'manager-token': 'MANAGER',
  'hr-token': 'HR',
  'production-token': 'PRODUCTION',
  'store-token': 'STORE',
  'client-token': 'CLIENT',
};

vi.mock('../../utils/token', () => ({
  generateAccessToken: vi.fn(),
  generateRefreshToken: vi.fn(),
  verifyAccessToken: vi.fn(),
  parseExpiresInMs: vi.fn().mockReturnValue(900000),
  generateJti: vi.fn().mockReturnValue('jti'),
  generateOpaqueToken: vi.fn().mockReturnValue('opaque'),
}));

import { prisma } from '../../lib/prismaClient';
import {
  computeTargetProgress,
  checkThreshold,
  monthStart,
  percent,
} from '../../utils/targetProgress';

type Mock = ReturnType<typeof vi.fn>;
const db = prisma as unknown as Record<string, Record<string, Mock>>;
const { Prisma } = await import('@prisma/client');
const { verifyAccessToken } = (await import('../../utils/token')) as unknown as {
  verifyAccessToken: Mock;
};

function useToken(token: string): void {
  verifyAccessToken.mockImplementation((t: string) => {
    const role = ROLE_BY_TOKEN[t];
    if (role === undefined || t !== token) throw new Error('invalid token');
    return { sub: 7, email: `${role.toLowerCase()}@test.com`, role };
  });
}
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const savedAt = new Date('2026-10-20T10:00:00.000Z');
const targetRow = {
  id: 3,
  periodStart: new Date('2026-10-01T00:00:00.000Z'),
  outputTarget: new Prisma.Decimal(3100),
  unit: 'pcs',
  targetCompletionRate: new Prisma.Decimal(90),
  maxRejectionRate: new Prisma.Decimal(5),
  targetEmployeeEfficiency: null,
  notes: null,
  updatedById: 7,
  createdAt: savedAt,
  updatedAt: savedAt,
};

const body = {
  outputTarget: '3100',
  unit: 'pcs',
  targetCompletionRate: 90,
  maxRejectionRate: 5,
  targetEmployeeEfficiency: null,
  notes: 'Diwali month',
  expectedUpdatedAt: null,
};

let app: Express;
beforeAll(async () => {
  app = (await import('../../app')).default;
});

beforeEach(() => {
  vi.clearAllMocks();
  mirrorTokenUser(db['user']!['findUnique']!, verifyAccessToken);
  db['employeeDailyOutput']!['findMany']!.mockResolvedValue([]);
});

// ── Pure maths ───────────────────────────────────────────────────────────────

describe('target maths', () => {
  const oct = monthStart('2026-10')!;

  it('measures progress against a straight-line pace through the month', () => {
    const p = computeTargetProgress(3100, 1200, oct, new Date('2026-10-10T12:00:00Z'));
    expect(p).toMatchObject({
      daysInMonth: 31,
      daysElapsed: 10,
      progressPct: 38.7,
      expectedToDate: 1000,
      pace: 'ON_TRACK',
    });
    expect(computeTargetProgress(3100, 800, oct, new Date('2026-10-10T12:00:00Z')).pace).toBe(
      'BEHIND',
    );
    expect(computeTargetProgress(3100, 3100, oct, new Date('2026-10-10T12:00:00Z')).pace).toBe(
      'MET',
    );
  });

  it('handles past and future months', () => {
    expect(computeTargetProgress(100, 0, oct, new Date('2026-09-01Z'))).toMatchObject({
      daysElapsed: 0,
      pace: 'NOT_STARTED',
      expectedToDate: 0,
    });
    expect(computeTargetProgress(100, 50, oct, new Date('2027-01-01Z'))).toMatchObject({
      daysElapsed: 31,
      expectedToDate: 100,
      pace: 'BEHIND',
    });
  });

  it('never divides by zero: no target means no percentages', () => {
    expect(computeTargetProgress(null, 500, oct)).toMatchObject({
      progressPct: null,
      expectedToDate: null,
      pace: null,
    });
    expect(computeTargetProgress(0, 500, oct).progressPct).toBeNull();
    expect(percent(5, 0)).toBeNull();
    expect(checkThreshold(null, 5, 'atMost')).toBeNull();
    expect(checkThreshold(4.9, 5, 'atMost')).toBe('MET');
    expect(checkThreshold(80, 85, 'atLeast')).toBe('MISSED');
  });

  it.each(['2026-13', '2026-1', 'Oct 2026', ''])('rejects the month "%s"', (m) => {
    expect(monthStart(m)).toBeNull();
  });
});

// ── Routes ───────────────────────────────────────────────────────────────────

describe('PUT /api/v1/production/targets/:month', () => {
  it.each(['admin-token', 'manager-token'])('lets %s create a target', async (token) => {
    useToken(token);
    db['productionMonthlyTarget']!['findUnique']!.mockResolvedValue(null);
    db['productionMonthlyTarget']!['create']!.mockResolvedValue(targetRow);

    const res = await request(app)
      .put('/api/v1/production/targets/2026-10')
      .set(auth(token))
      .send(body);

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      month: '2026-10',
      outputTarget: 3100,
      maxRejectionRate: 5,
    });
    const data = db['productionMonthlyTarget']!['create']!.mock.calls[0]![0].data as Record<
      string,
      unknown
    >;
    expect((data['periodStart'] as Date).toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(data['outputTarget']).toBe(3100);
    expect(data['updatedById']).toBe(7);
    // A target is never recorded as production
    expect(db['workOrderOutput']!['create']).not.toHaveBeenCalled();
    expect(db['workOrder']!['update']).not.toHaveBeenCalled();
  });

  it.each(['production-token', 'hr-token', 'store-token', 'client-token'])(
    'refuses %s',
    async (token) => {
      useToken(token);
      const res = await request(app)
        .put('/api/v1/production/targets/2026-10')
        .set(auth(token))
        .send(body);
      expect(res.status).toBe(403);
      expect(db['productionMonthlyTarget']!['create']).not.toHaveBeenCalled();
    },
  );

  it('updates the version the user edited', async () => {
    useToken('manager-token');
    db['productionMonthlyTarget']!['findUnique']!.mockResolvedValue(targetRow);
    db['productionMonthlyTarget']!['update']!.mockResolvedValue({
      ...targetRow,
      outputTarget: new Prisma.Decimal(3500),
    });

    const res = await request(app)
      .put('/api/v1/production/targets/2026-10')
      .set(auth('manager-token'))
      .send({ ...body, outputTarget: '3500', expectedUpdatedAt: savedAt.toISOString() });

    expect(res.status).toBe(200);
    expect(res.body.data.outputTarget).toBe(3500);
  });

  it('refuses to overwrite a target someone else changed (409)', async () => {
    useToken('admin-token');
    db['productionMonthlyTarget']!['findUnique']!.mockResolvedValue({
      ...targetRow,
      updatedAt: new Date('2026-10-21T09:00:00Z'),
    });

    const res = await request(app)
      .put('/api/v1/production/targets/2026-10')
      .set(auth('admin-token'))
      .send({ ...body, expectedUpdatedAt: savedAt.toISOString() });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/changed after you opened it/);
    expect(db['productionMonthlyTarget']!['update']).not.toHaveBeenCalled();
  });

  it('refuses a "create" when a target already exists for the month (409)', async () => {
    useToken('admin-token');
    db['productionMonthlyTarget']!['findUnique']!.mockResolvedValue(targetRow);
    const res = await request(app)
      .put('/api/v1/production/targets/2026-10')
      .set(auth('admin-token'))
      .send(body);
    expect(res.status).toBe(409);
    expect(db['productionMonthlyTarget']!['update']).not.toHaveBeenCalled();
  });

  it.each([
    ['a zero target', { outputTarget: '0' }, 'outputTarget'],
    ['a negative target', { outputTarget: '-10' }, 'outputTarget'],
    ['text as the target', { outputTarget: 'lots' }, 'outputTarget'],
    ['a rejection rate over 100%', { maxRejectionRate: 120 }, 'maxRejectionRate'],
    ['a negative completion rate', { targetCompletionRate: -1 }, 'targetCompletionRate'],
    ['an empty unit', { unit: ' ' }, 'unit'],
  ])('rejects %s', async (_label, patch, field) => {
    useToken('admin-token');
    const res = await request(app)
      .put('/api/v1/production/targets/2026-10')
      .set(auth('admin-token'))
      .send({ ...body, ...patch });
    expect(res.status).toBe(422);
    expect(res.body.error.details.map((d: { field: string }) => d.field)).toContain(field);
  });

  it('rejects an invalid month', async () => {
    useToken('admin-token');
    const res = await request(app)
      .put('/api/v1/production/targets/2026-13')
      .set(auth('admin-token'))
      .send(body);
    expect(res.status).toBe(422);
  });
});

describe('GET /api/v1/production/targets/:month/performance', () => {
  it('compares the saved target with output actually recorded that month', async () => {
    useToken('production-token');
    db['productionMonthlyTarget']!['findUnique']!.mockResolvedValue(targetRow);
    db['workOrderOutput']!['aggregate']!.mockResolvedValue({
      _sum: {
        goodQty: new Prisma.Decimal(950),
        rejectedQty: new Prisma.Decimal(50),
        scrapQty: new Prisma.Decimal(5),
      },
      _count: { _all: 12 },
    });

    const res = await request(app)
      .get('/api/v1/production/targets/2026-10/performance')
      .set(auth('production-token'));

    expect(res.status).toBe(200);
    expect(res.body.data.actual).toMatchObject({
      goodQty: 950,
      rejectedQty: 50,
      outputRecords: 12,
      rejectionRate: 5,
    });
    expect(res.body.data.progress.progressPct).toBe(30.6);
    expect(res.body.data.checks.rejection).toBe('MET');
    // Output is read by recordedAt within the month, on work orders that are not deleted
    const where = db['workOrderOutput']!['aggregate']!.mock.calls[0]![0].where as Record<
      string,
      any
    >;
    expect(where['recordedAt']['gte'].toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(where['recordedAt']['lt'].toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(where['workOrder']).toEqual({ deletedAt: null });
  });

  it('reports no target and no rates for an empty month instead of inventing them', async () => {
    useToken('hr-token');
    db['productionMonthlyTarget']!['findUnique']!.mockResolvedValue(null);
    db['workOrderOutput']!['aggregate']!.mockResolvedValue({
      _sum: { goodQty: null, rejectedQty: null, scrapQty: null },
      _count: { _all: 0 },
    });

    const res = await request(app)
      .get('/api/v1/production/targets/2026-10/performance')
      .set(auth('hr-token'));

    expect(res.status).toBe(200);
    expect(res.body.data.target).toBeNull();
    expect(res.body.data.actual).toMatchObject({
      goodQty: 0,
      rejectionRate: null,
      employeeEfficiency: null,
    });
    expect(res.body.data.progress).toMatchObject({ progressPct: null, pace: null });
    expect(res.body.data.checks).toEqual({ rejection: null, employeeEfficiency: null });
  });

  it('is not available to roles outside production reporting', async () => {
    useToken('store-token');
    const res = await request(app)
      .get('/api/v1/production/targets/2026-10/performance')
      .set(auth('store-token'));
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/v1/production/targets/:month', () => {
  it('is administrator-only', async () => {
    useToken('manager-token');
    const res = await request(app)
      .delete('/api/v1/production/targets/2026-10')
      .set(auth('manager-token'));
    expect(res.status).toBe(403);
    expect(db['productionMonthlyTarget']!['delete']).not.toHaveBeenCalled();
  });

  it('removes only the target record', async () => {
    useToken('admin-token');
    db['productionMonthlyTarget']!['findUnique']!.mockResolvedValue(targetRow);
    const res = await request(app)
      .delete('/api/v1/production/targets/2026-10')
      .set(auth('admin-token'));
    expect(res.status).toBe(204);
    expect(db['productionMonthlyTarget']!['delete']).toHaveBeenCalledWith({ where: { id: 3 } });
    expect(db['workOrderOutput']!['delete']).not.toHaveBeenCalled();
  });
});
