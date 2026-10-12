/**
 * Employee routes integration tests
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { adminToken, managerToken, mirrorTokenUser } from '../helpers/app';

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
    employee: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    department: { findFirst: vi.fn() },
    shift: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ max: null }]),
    $transaction: vi.fn((arg: unknown) => {
      if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
      if (typeof arg === 'function') return arg({});
      return Promise.resolve([]);
    }),
  },
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

vi.mock('../../utils/token', () => ({
  generateAccessToken: vi.fn(),
  generateRefreshToken: vi.fn(),
  verifyAccessToken: vi.fn().mockImplementation((token: string) => {
    if (token === 'admin-token') return { sub: 1, email: 'admin@test.com', role: 'ADMIN' };
    if (token === 'manager-token') return { sub: 2, email: 'mgr@test.com', role: 'MANAGER' };
    throw new Error('invalid token');
  }),
  parseExpiresInMs: vi.fn().mockReturnValue(900000),
  generateJti: vi.fn().mockReturnValue('jti'),
  generateOpaqueToken: vi.fn().mockReturnValue('opaque'),
}));

import { prisma } from '../../lib/prismaClient';

const mockEmployee = {
  id: 1,
  employeeCode: 'EMP-001',
  firstName: 'Arjun',
  lastName: 'Mehta',
  email: 'arjun@test.com',
  phone: null,
  gender: null,
  dateOfBirth: null,
  joiningDate: new Date('2021-03-14'),
  designation: 'Sr. Operator',
  employmentType: 'FULL_TIME',
  salary: null,
  departmentId: 1,
  department: { id: 1, name: 'Cutting', code: 'CUT' },
  shiftId: 1,
  shift: { id: 1, name: 'Morning' },
  managerId: null,
  userId: null,
  status: 'ACTIVE',
  profileImage: null,
  address: null,
  city: null,
  state: null,
  country: null,
  pincode: null,
  emergencyName: null,
  emergencyPhone: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

let app: Express;
beforeAll(async () => {
  const m = await import('../../app');
  app = m.default;
});
afterAll(() => vi.clearAllMocks());

// Patch token validation so our static tokens work
const { verifyAccessToken } = (await import('../../utils/token')) as {
  verifyAccessToken: ReturnType<typeof vi.fn>;
};
mirrorTokenUser(prisma.user.findUnique as ReturnType<typeof vi.fn>, verifyAccessToken);

describe('GET /api/v1/employees', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/v1/employees');
    expect(res.status).toBe(401);
  });

  it('returns 200 with valid ADMIN token', async () => {
    (verifyAccessToken as ReturnType<typeof vi.fn>).mockReturnValue({
      sub: 1,
      email: 'admin@test.com',
      role: 'ADMIN',
    });

    const res = await request(app)
      .get('/api/v1/employees')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 200 with MANAGER token', async () => {
    (verifyAccessToken as ReturnType<typeof vi.fn>).mockReturnValue({
      sub: 2,
      email: 'mgr@test.com',
      role: 'MANAGER',
    });

    const res = await request(app)
      .get('/api/v1/employees')
      .set('Authorization', 'Bearer manager-token');

    expect(res.status).toBe(200);
  });
});

describe('GET /api/v1/employees/:id', () => {
  it('returns 200 for existing employee', async () => {
    (verifyAccessToken as ReturnType<typeof vi.fn>).mockReturnValue({
      sub: 1,
      email: 'admin@test.com',
      role: 'ADMIN',
    });
    (prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockEmployee);

    const res = await request(app)
      .get('/api/v1/employees/1')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body.data.employeeCode).toBe('EMP-001');
  });

  it('returns 404 for non-existent employee', async () => {
    (verifyAccessToken as ReturnType<typeof vi.fn>).mockReturnValue({
      sub: 1,
      email: 'admin@test.com',
      role: 'ADMIN',
    });
    (prisma.employee.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await request(app)
      .get('/api/v1/employees/99')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/employees', () => {
  it('returns 403 for non-admin/HR role', async () => {
    (verifyAccessToken as ReturnType<typeof vi.fn>).mockReturnValue({
      sub: 2,
      email: 'prod@test.com',
      role: 'PRODUCTION',
    });

    const res = await request(app)
      .post('/api/v1/employees')
      .set('Authorization', 'Bearer any-token')
      .send({
        employeeCode: 'EMP-NEW',
        firstName: 'Test',
        lastName: 'User',
        designation: 'Op',
        joiningDate: new Date().toISOString(),
      });

    expect(res.status).toBe(403);
  });
});
