/**
 * Website inquiry routes: public POST /api/v1/inquiries (validation, honeypot,
 * email notice) and the admin-only list and status update.
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
    user: { findUnique: vi.fn() },
    inquiry: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn((fns: unknown[]) => Promise.all(fns as Promise<unknown>[])),
  },
}));

vi.mock('../../utils/mailer', () => ({
  sendInquiryNotification: vi.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../utils/token', () => ({
  verifyAccessToken: vi.fn((token: string) => {
    if (token === 'admin') return { sub: 1, email: 'admin@test.com', role: 'ADMIN' };
    if (token === 'manager') return { sub: 5, email: 'manager@test.com', role: 'MANAGER' };
    throw new Error('invalid');
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
import { sendInquiryNotification } from '../../utils/mailer';

const fn = (f: unknown) => f as ReturnType<typeof vi.fn>;

const stored = {
  id: 7,
  name: 'Asha Rao',
  company: 'Rao Pumps',
  email: 'asha@raopumps.in',
  phone: null,
  message: 'Quote for 500 brackets',
  status: 'NEW',
  createdAt: new Date('2026-11-01T10:00:00Z'),
  updatedAt: new Date('2026-11-01T10:00:00Z'),
};

let app: Express;

beforeAll(async () => {
  app = (await import('../../app')).default;
});

beforeEach(() => {
  vi.clearAllMocks();
  // authenticate() reloads the signed-in user's role from the database
  fn(prisma.user.findUnique).mockImplementation(({ where }: { where: { id: number } }) =>
    Promise.resolve(
      where.id === 1 || where.id === 5
        ? {
            id: where.id,
            email: `u${where.id}@test.com`,
            fullName: 'User',
            isActive: true,
            role: { name: where.id === 1 ? 'ADMIN' : 'MANAGER' },
          }
        : null,
    ),
  );
  fn(prisma.inquiry.create).mockResolvedValue(stored);
  fn(prisma.inquiry.findMany).mockResolvedValue([stored]);
  fn(prisma.inquiry.count).mockResolvedValue(1);
  fn(prisma.inquiry.findUnique).mockImplementation(({ where }: { where: { id: number } }) =>
    Promise.resolve(where.id === 7 ? stored : null),
  );
  fn(prisma.inquiry.update).mockResolvedValue({ ...stored, status: 'CONTACTED' });
});

// ── Tests ─────────────────────────────────────────────────────────────────────
// The public POST is limited to 5 per hour per IP, so this file sends at most 4.

describe('POST /api/v1/inquiries (public)', () => {
  it('stores the inquiry without a login and emails the sales inbox', async () => {
    const res = await request(app).post('/api/v1/inquiries').send({
      name: '  Asha Rao ',
      company: 'Rao Pumps',
      email: 'Asha@RaoPumps.in',
      phone: '',
      message: 'Quote for 500 brackets',
    });

    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ received: true });
    expect(fn(prisma.inquiry.create)).toHaveBeenCalledWith({
      data: {
        name: 'Asha Rao',
        company: 'Rao Pumps',
        email: 'asha@raopumps.in',
        phone: null,
        message: 'Quote for 500 brackets',
      },
    });
    expect(fn(sendInquiryNotification)).toHaveBeenCalledWith(stored);
  });

  it('rejects a missing message and an invalid email', async () => {
    const res = await request(app)
      .post('/api/v1/inquiries')
      .send({ name: 'A', email: 'not-an-email', message: '' });

    expect(res.status).toBe(422);
    expect(fn(prisma.inquiry.create)).not.toHaveBeenCalled();
  });

  it('answers a filled honeypot like a success but stores nothing', async () => {
    const res = await request(app).post('/api/v1/inquiries').send({
      name: 'Bot',
      email: 'bot@spam.example',
      message: 'Buy now',
      website: 'http://spam.example',
    });

    expect(res.status).toBe(201);
    expect(fn(prisma.inquiry.create)).not.toHaveBeenCalled();
    expect(fn(sendInquiryNotification)).not.toHaveBeenCalled();
  });
});

describe('Admin inquiry list and status', () => {
  it('lists inquiries for an admin, newest first', async () => {
    const res = await request(app).get('/api/v1/inquiries').set('Authorization', 'Bearer admin');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.total).toBe(1);
    expect(fn(prisma.inquiry.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
    );
  });

  it('refuses the list without a login and for non-admins', async () => {
    expect((await request(app).get('/api/v1/inquiries')).status).toBe(401);
    expect(
      (await request(app).get('/api/v1/inquiries').set('Authorization', 'Bearer manager')).status,
    ).toBe(403);
  });

  it('marks an inquiry as contacted', async () => {
    const res = await request(app)
      .patch('/api/v1/inquiries/7')
      .set('Authorization', 'Bearer admin')
      .send({ status: 'CONTACTED' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CONTACTED');
    expect(fn(prisma.inquiry.update)).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { status: 'CONTACTED' },
    });
  });

  it('returns 404 for an unknown inquiry and 422 for a bad status', async () => {
    const missing = await request(app)
      .patch('/api/v1/inquiries/99')
      .set('Authorization', 'Bearer admin')
      .send({ status: 'CLOSED' });
    expect(missing.status).toBe(404);

    const bad = await request(app)
      .patch('/api/v1/inquiries/7')
      .set('Authorization', 'Bearer admin')
      .send({ status: 'SPAM' });
    expect(bad.status).toBe(422);
  });
});
