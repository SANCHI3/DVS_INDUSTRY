/**
 * Access-control regression tests: perception-service incident reporting,
 * external incident numbers, supplier data scoping and portal messages.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

vi.mock('../../config/env', () => ({
  env: {
    NODE_ENV: 'test',
    PORT: 3001,
    JWT_SECRET: 'test-secret-at-least-32-characters-long!!',
    JWT_EXPIRES_IN: '15m',
    REFRESH_TOKEN_SECRET: 'test-refresh-secret-at-least-32-chars!!',
    REFRESH_TOKEN_EXPIRES_IN: '7d',
    BCRYPT_SALT_ROUNDS: 10,
    CORS_ORIGINS: 'http://localhost:5173',
    LOG_LEVEL: 'silent',
    RATE_LIMIT_MAX: 500,
    TRUST_PROXY: 0,
  },
}));

vi.mock('../../lib/prismaClient', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    securityIncident: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    supplier: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    purchaseOrder: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    portalMessage: { findMany: vi.fn(), groupBy: vi.fn() },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ max: null }]),
    $transaction: vi.fn((arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg as Promise<unknown>[]) : Promise.resolve([]),
    ),
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

const USERS: Record<string, { id: number; email: string; role: string; supplierId?: number }> = {
  perception: { id: 9, email: 'perception@test.com', role: 'PERCEPTION_SERVICE' },
  sales: { id: 4, email: 'sales@test.com', role: 'SALES' },
  supplier: { id: 7, email: 'vendor@acme.test', role: 'SUPPLIER' },
  // A login linked to supplier 5, though its email matches supplier 3
  linked: { id: 8, email: 'vendor@acme.test', role: 'SUPPLIER', supplierId: 5 },
};

vi.mock('../../utils/token', () => ({
  verifyAccessToken: vi.fn((token: string) => {
    const u = { perception: 9, sales: 4, supplier: 7, linked: 8 }[token];
    if (u === undefined) throw new Error('invalid');
    return { sub: u, email: '', role: '' };
  }),
}));

import { prisma } from '../../lib/prismaClient';

const fn = (f: unknown) => f as ReturnType<typeof vi.fn>;

const incident = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  incidentNumber: 'CAM1-20261010-0001',
  title: 'fight',
  description: 'Two people fighting',
  aiSummary: null,
  type: 'FIGHT',
  confidenceScore: 0.91,
  severity: 'HIGH',
  status: 'OPEN',
  location: 'Gate 2',
  departmentId: null,
  departmentName: null,
  reportedById: 9,
  reportedByName: 'Perception Service',
  assignedToId: null,
  assignedToName: null,
  occurredAt: new Date(),
  resolvedAt: null,
  closedAt: null,
  rootCause: null,
  correctiveAction: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  _count: { updates: 0, alerts: 0 },
  ...overrides,
});

const supplierRow = (id: number, email: string) => ({
  id,
  name: `Supplier ${id}`,
  code: `SUP-${id}`,
  contactName: null,
  email,
  phone: null,
  address: null,
  city: null,
  state: null,
  country: 'India',
  gstin: null,
  rating: null,
  leadTimeDays: null,
  reliability: null,
  materials: null,
  isActive: true,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

let app: Express;
beforeAll(async () => {
  app = (await import('../../app')).default;
});

beforeEach(() => {
  vi.clearAllMocks();
  fn(prisma.user.findUnique).mockImplementation(({ where }: { where: { id: number } }) => {
    const u = Object.values(USERS).find((x) => x.id === where.id);
    return Promise.resolve(
      u && {
        id: u.id,
        email: u.email,
        fullName: u.email,
        isActive: true,
        supplierId: u.supplierId ?? null,
        clientId: null,
        role: { name: u.role },
      },
    );
  });
});

const payload = {
  incident_id: 'CAM1-20261010-0001',
  title: 'fight',
  description: 'Two people fighting',
  type: 'FIGHT',
  severity: 'HIGH',
};

describe('POST /api/v1/security/incidents', () => {
  it('lets the perception service report an incident', async () => {
    fn(prisma.securityIncident.findFirst).mockResolvedValue(null);
    fn(prisma.securityIncident.create).mockResolvedValue(incident());

    const res = await request(app)
      .post('/api/v1/security/incidents')
      .set('Authorization', 'Bearer perception')
      .send(payload);

    expect(res.status).toBe(201);
    // Reporter is the authenticated service account, not a body field
    const data = fn(prisma.securityIncident.create).mock.calls[0][0].data;
    expect(data.reportedById).toBe(9);
  });

  it('forbids other roles from choosing an external incident_id', async () => {
    const res = await request(app)
      .post('/api/v1/security/incidents')
      .set('Authorization', 'Bearer sales')
      .send(payload);

    expect(res.status).toBe(403);
    expect(prisma.securityIncident.findFirst).not.toHaveBeenCalled();
  });

  it('ignores a spoofed reportedById', async () => {
    fn(prisma.securityIncident.create).mockResolvedValue(incident());
    await request(app)
      .post('/api/v1/security/incidents')
      .set('Authorization', 'Bearer sales')
      .send({ ...payload, incident_id: undefined, reportedById: 1 });

    const data = fn(prisma.securityIncident.create).mock.calls[0][0].data;
    expect(data.reportedById).toBe(4);
  });

  it('does not let the perception service change incident status', async () => {
    const res = await request(app)
      .patch('/api/v1/security/incidents/1/status')
      .set('Authorization', 'Bearer perception')
      .send({ status: 'RESOLVED' });
    expect(res.status).toBe(403);
  });
});

describe('supplier scoping', () => {
  beforeEach(() => {
    fn(prisma.supplier.findFirst).mockResolvedValue(supplierRow(3, 'vendor@acme.test'));
    fn(prisma.purchaseOrder.findMany).mockResolvedValue([]);
    fn(prisma.purchaseOrder.count).mockResolvedValue(0);
  });

  it('returns only the supplier’s own profile', async () => {
    const res = await request(app)
      .get('/api/v1/orders/suppliers')
      .set('Authorization', 'Bearer supplier');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(3);
    expect(prisma.supplier.findMany).not.toHaveBeenCalled();
  });

  it('forces purchase-order queries to the supplier’s own id', async () => {
    const res = await request(app)
      .get('/api/v1/orders/purchase-orders?supplierId=99')
      .set('Authorization', 'Bearer supplier');

    expect(res.status).toBe(200);
    const where = fn(prisma.purchaseOrder.findMany).mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('"supplierId":3');
    expect(JSON.stringify(where)).not.toContain('99');
  });

  it('uses the supplier linked to the login rather than the email match', async () => {
    fn(prisma.supplier.findUnique).mockResolvedValue(supplierRow(5, 'other@acme.test'));
    const res = await request(app)
      .get('/api/v1/orders/purchase-orders')
      .set('Authorization', 'Bearer linked');

    expect(res.status).toBe(200);
    const where = fn(prisma.purchaseOrder.findMany).mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('"supplierId":5');
    expect(prisma.supplier.findFirst).not.toHaveBeenCalled();
  });

  it('blocks suppliers from client orders', async () => {
    const res = await request(app)
      .get('/api/v1/orders/client-orders')
      .set('Authorization', 'Bearer supplier');
    expect(res.status).toBe(403);
  });
});

describe('portal messages', () => {
  beforeEach(() => {
    fn(prisma.supplier.findFirst).mockResolvedValue(supplierRow(3, 'vendor@acme.test'));
    fn(prisma.portalMessage.findMany).mockResolvedValue([]);
    fn(prisma.portalMessage.groupBy).mockResolvedValue([]);
  });

  it('keeps a supplier in its own conversation whatever id it sends', async () => {
    const res = await request(app)
      .get('/api/v1/portal/messages?supplierId=99')
      .set('Authorization', 'Bearer supplier');

    expect(res.status).toBe(200);
    expect(fn(prisma.portalMessage.findMany).mock.calls[0][0].where).toEqual({ supplierId: 3 });
  });

  it('keeps the staff inbox away from suppliers', async () => {
    const res = await request(app)
      .get('/api/v1/portal/threads')
      .set('Authorization', 'Bearer sales');
    expect(res.status).toBe(200);

    const blocked = await request(app)
      .get('/api/v1/portal/threads')
      .set('Authorization', 'Bearer supplier');
    expect(blocked.status).toBe(403);
  });

  it('refuses a message naming both a supplier and a client', async () => {
    const res = await request(app)
      .post('/api/v1/portal/messages')
      .set('Authorization', 'Bearer sales')
      .send({ supplierId: 3, clientId: 4, body: 'Hi' });
    expect(res.status).toBe(422);
  });
});

describe('supplier actions on its own purchase orders', () => {
  const po = (id: number, supplierId: number, status: string) => ({
    id,
    poNumber: `PO-${id}`,
    supplierId,
    material: 'CRCA',
    quantity: '500',
    unit: 'kg',
    totalCost: null,
    currency: 'INR',
    orderDate: new Date('2026-10-20'),
    expectedDelivery: null,
    actualDelivery: null,
    confirmedAt: null,
    dispatchDate: null,
    dispatchedAt: null,
    supplierNote: null,
    status,
    notes: null,
    createdById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    supplier: { name: `Supplier ${supplierId}` },
  });

  beforeEach(() => {
    fn(prisma.supplier.findFirst).mockResolvedValue(supplierRow(3, 'vendor@acme.test'));
    fn(prisma.purchaseOrder.findUnique).mockImplementation(({ where }: { where: { id: number } }) =>
      Promise.resolve(where.id === 10 ? po(10, 3, 'PENDING') : po(11, 8, 'PENDING')),
    );
    fn(prisma.purchaseOrder.update).mockImplementation(
      ({ where, data }: { where: { id: number }; data: { status: string } }) =>
        Promise.resolve({ ...po(where.id, 3, 'PENDING'), ...data }),
    );
  });

  it('lets a supplier confirm its own PO with a dispatch date', async () => {
    const res = await request(app)
      .patch('/api/v1/orders/purchase-orders/10/supplier-confirm')
      .set('Authorization', 'Bearer supplier')
      .send({ dispatchDate: '2099-01-10', note: 'Ready next week' });

    expect(res.status).toBe(200);
    expect(fn(prisma.purchaseOrder.update)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 10 },
        data: expect.objectContaining({
          status: 'CONFIRMED',
          confirmedAt: expect.any(Date),
          supplierNote: 'Ready next week',
        }),
      }),
    );
  });

  it("hides another supplier's PO", async () => {
    const res = await request(app)
      .patch('/api/v1/orders/purchase-orders/11/supplier-confirm')
      .set('Authorization', 'Bearer supplier')
      .send({});
    expect(res.status).toBe(404);
    expect(fn(prisma.purchaseOrder.update)).not.toHaveBeenCalled();
  });

  it('cannot dispatch a PO that is not confirmed yet', async () => {
    const res = await request(app)
      .patch('/api/v1/orders/purchase-orders/10/supplier-dispatch')
      .set('Authorization', 'Bearer supplier')
      .send({});
    expect(res.status).toBe(400);
  });

  it('is for supplier logins only', async () => {
    const res = await request(app)
      .patch('/api/v1/orders/purchase-orders/10/supplier-confirm')
      .set('Authorization', 'Bearer sales')
      .send({});
    expect(res.status).toBe(403);
  });
});
