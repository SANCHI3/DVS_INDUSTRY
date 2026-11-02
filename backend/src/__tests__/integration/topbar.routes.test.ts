/**
 * Top bar: the notification feed (role-filtered, unread since last seen) and
 * the search box (only record kinds the role may open).
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { Prisma } from '@prisma/client';

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
    securityIncident: { findMany: vi.fn() },
    material: { findMany: vi.fn() },
    purchaseOrder: { findMany: vi.fn() },
    clientOrder: { findMany: vi.fn() },
    inquiry: { findMany: vi.fn() },
    employee: { findMany: vi.fn() },
    workOrder: { findMany: vi.fn() },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    // No CCTV reported yet: no camera notifications
    camera: { findMany: vi.fn().mockResolvedValue([]) },
    perceptionInstance: { findMany: vi.fn().mockResolvedValue([]) },
    $queryRaw: vi.fn().mockResolvedValue([]),
  },
}));

const ROLE_OF: Record<string, { id: number; role: string }> = {
  production: { id: 2, role: 'PRODUCTION' },
  store: { id: 3, role: 'STORE' },
  admin: { id: 1, role: 'ADMIN' },
};

vi.mock('../../utils/token', () => ({
  verifyAccessToken: vi.fn((token: string) => {
    const u = ROLE_OF[token];
    if (!u) throw new Error('invalid');
    return { sub: u.id, email: `${token}@test.com`, role: u.role };
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

import { prisma } from '../../lib/prismaClient';

const fn = (f: unknown) => f as ReturnType<typeof vi.fn>;
const D = (n: number) => new Prisma.Decimal(n);
let seenAt: Date | null = null;
let app: Express;

beforeAll(async () => {
  app = (await import('../../app')).default;
});

beforeEach(() => {
  vi.clearAllMocks();
  seenAt = null;
  fn(prisma.user.findUnique).mockImplementation(
    ({ where, select }: { where: { id: number }; select?: Record<string, unknown> }) => {
      if (select && 'notificationsSeenAt' in select) {
        return Promise.resolve({ notificationsSeenAt: seenAt });
      }
      const u = Object.values(ROLE_OF).find((x) => x.id === where.id)!;
      return Promise.resolve({
        id: u.id,
        email: 'x@test.com',
        fullName: 'X',
        isActive: true,
        role: { name: u.role },
      });
    },
  );
  fn(prisma.securityIncident.findMany).mockResolvedValue([
    {
      id: 9,
      type: 'FIRE_SMOKE',
      severity: 'CRITICAL',
      location: 'Press shop',
      occurredAt: new Date(Date.now() - 3_600_000),
    },
  ]);
  fn(prisma.material.findMany).mockResolvedValue([
    {
      id: 4,
      name: 'CRCA Sheet 1.6mm',
      unit: 'kg',
      currentStock: D(40),
      minStockLevel: D(200),
      updatedAt: new Date('2026-10-30'),
    },
    {
      id: 5,
      name: 'HR Sheet 2mm',
      unit: 'kg',
      currentStock: D(900),
      minStockLevel: D(200),
      updatedAt: new Date('2026-10-30'),
    },
  ]);
  fn(prisma.purchaseOrder.findMany).mockResolvedValue([
    {
      id: 3,
      poNumber: 'PO-TEST-001',
      expectedDelivery: new Date('2026-09-15'),
      supplier: { name: 'Mahindra Accelo' },
      material: 'CRCA',
      status: 'PENDING',
    },
  ]);
  fn(prisma.clientOrder.findMany).mockResolvedValue([]);
  fn(prisma.inquiry.findMany).mockResolvedValue([]);
  fn(prisma.employee.findMany).mockResolvedValue([]);
  fn(prisma.workOrder.findMany).mockResolvedValue([]);
  fn(prisma.user.update).mockResolvedValue({});
});

describe('GET /api/v1/notifications', () => {
  it('gives Production only security incidents', async () => {
    const res = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', 'Bearer production');

    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([
      expect.objectContaining({
        kind: 'incident',
        severity: 'critical',
        message: 'Fire or smoke seen at Press shop (critical)',
        section: 'security-incidents',
        unread: true,
      }),
    ]);
    expect(prisma.material.findMany).not.toHaveBeenCalled();
    expect(prisma.purchaseOrder.findMany).not.toHaveBeenCalled();
  });

  it('gives Store low stock and overdue purchase orders, not incidents', async () => {
    const res = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', 'Bearer store');

    const kinds = res.body.data.items.map((i: { kind: string }) => i.kind);
    expect(kinds).toEqual(expect.arrayContaining(['low-stock', 'overdue-po']));
    expect(kinds).not.toContain('incident');
    expect(prisma.securityIncident.findMany).not.toHaveBeenCalled();
    const messages = res.body.data.items.map((i: { message: string }) => i.message);
    expect(messages).toContain('CRCA Sheet 1.6mm is low: 40 kg (minimum 200 kg)');
    expect(messages.some((m: string) => m.startsWith('PO-TEST-001 from Mahindra Accelo is'))).toBe(
      true,
    );
    expect(messages.join(' ')).not.toContain('HR Sheet 2mm');
  });

  it('counts only items newer than the last time the bell was opened', async () => {
    seenAt = new Date(); // just now: the incident an hour ago is read
    const res = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', 'Bearer production');
    expect(res.body.data.unreadCount).toBe(0);
    expect(res.body.data.items[0].unread).toBe(false);
  });

  it('records when the bell was opened', async () => {
    const res = await request(app)
      .post('/api/v1/notifications/seen')
      .set('Authorization', 'Bearer store');
    expect(res.status).toBe(204);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { notificationsSeenAt: expect.any(Date) },
    });
  });
});

describe('GET /api/v1/search', () => {
  it('searches only what the role may open', async () => {
    const res = await request(app)
      .get('/api/v1/search?q=crca')
      .set('Authorization', 'Bearer store');

    expect(res.status).toBe(200);
    expect(prisma.employee.findMany).not.toHaveBeenCalled();
    expect(prisma.workOrder.findMany).not.toHaveBeenCalled();
    expect(prisma.material.findMany).toHaveBeenCalled();
    expect(res.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'purchase-order', title: 'PO-TEST-001' }),
        expect.objectContaining({ kind: 'material', title: 'CRCA Sheet 1.6mm' }),
      ]),
    );
  });

  it('needs at least two characters', async () => {
    const res = await request(app).get('/api/v1/search?q=a').set('Authorization', 'Bearer admin');
    expect(res.status).toBe(422);
  });
});
