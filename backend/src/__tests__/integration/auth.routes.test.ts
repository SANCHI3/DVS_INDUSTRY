/**
 * Auth routes integration tests
 * Uses supertest against the real Express app, but mocks Prisma + bcrypt
 * so no live DB connection is needed.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
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
  },
}));

vi.mock('../../lib/prismaClient', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    role: { findUnique: vi.fn(), findMany: vi.fn() },
    refreshToken: { create: vi.fn(), findUnique: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ max: null }]),
    $transaction: vi.fn((fns: unknown[]) => Promise.all(fns as Promise<unknown>[])),
  },
}));

vi.mock('bcrypt', () => ({
  default: { hash: vi.fn().mockResolvedValue('$hashed$'), compare: vi.fn() },
  hash: vi.fn().mockResolvedValue('$hashed$'),
  compare: vi.fn(),
}));

vi.mock('../../utils/token', () => ({
  generateAccessToken: vi.fn().mockReturnValue('test-access-token'),
  generateRefreshToken: vi.fn().mockReturnValue('test-refresh-token'),
  verifyRefreshToken: vi.fn(),
  parseExpiresInMs: vi.fn().mockReturnValue(604800000),
  generateJti: vi.fn().mockReturnValue('jti-test'),
  generateOpaqueToken: vi.fn().mockReturnValue('opaque-test'),
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
import bcrypt from 'bcrypt';

let app: Express;

const mockUser = {
  id: 1,
  fullName: 'Admin User',
  email: 'admin@test.com',
  password: '$hashed$',
  phone: null,
  roleId: 1,
  isActive: true,
  lastLogin: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  role: { id: 1, name: 'ADMIN', description: null, createdAt: new Date(), updatedAt: new Date() },
  refreshTokens: [],
  employee: null,
};

beforeAll(async () => {
  const mod = await import('../../app');
  app = mod.default;
});

afterAll(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/login', () => {
  it('returns 200 + tokens on valid credentials', async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
    (bcrypt.compare as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (prisma.refreshToken.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (prisma.user.update as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@test.com', password: 'Secret@1234' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBe('test-access-token');
    expect(res.body.data.user.email).toBe('admin@test.com');
  });

  it('returns 401 for wrong password', async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
    (bcrypt.compare as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@test.com', password: 'wrong' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 for unknown email', async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@test.com', password: 'pass' });

    expect(res.status).toBe(401);
  });

  it('returns 422 for missing fields', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'admin@test.com' }); // no password

    expect(res.status).toBe(422);
  });
});

describe('GET /api/v1/auth/me', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 with malformed token', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer bad.token.here');

    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).post('/api/v1/auth/logout');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/health', () => {
  it('returns 200 status ok', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
