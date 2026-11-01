/**
 * Portal messages: a supplier or client account only ever reaches its own
 * company's conversation, and every message records which side sent it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestError, NotFoundError } from '../../errors';

vi.mock('../../lib/prismaClient', () => ({
  prisma: {
    portalMessage: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      groupBy: vi.fn().mockResolvedValue([]),
    },
  },
}));

const orders = {
  getSupplierByEmail: vi.fn(),
  getClientByEmail: vi.fn(),
  // Linked company first; these mocks fall back to the email lookups
  getSupplierForAccount: vi.fn((a: { email: string }) => orders.getSupplierByEmail(a.email)),
  getClientForAccount: vi.fn((a: { email: string }) => orders.getClientByEmail(a.email)),
  getSupplierById: vi.fn(),
  getClientById: vi.fn(),
};
vi.mock('../../services/orders.service', () => ({
  OrdersService: vi.fn(function OrdersService() {
    return orders;
  }),
}));

import { prisma } from '../../lib/prismaClient';

const { PortalService } = await import('../../services/portal.service');

const fn = (f: unknown) => f as ReturnType<typeof vi.fn>;
const supplierUser = { id: 31, email: 'mal@test.local', role: 'SUPPLIER' };
const clientUser = { id: 32, email: 'ces@test.local', role: 'CLIENT' };
const admin = { id: 1, email: 'admin@test.local', role: 'ADMIN' };
const row = (fromDvs: boolean) => ({
  id: 1,
  fromDvs,
  body: 'Hello',
  readAt: null,
  createdAt: new Date('2026-11-01T10:00:00Z'),
  sender: { fullName: 'Asha Kulkarni' },
});

describe('PortalService', () => {
  let svc: InstanceType<typeof PortalService>;

  beforeEach(() => {
    vi.clearAllMocks();
    orders.getSupplierByEmail.mockResolvedValue({ id: 7 });
    orders.getClientByEmail.mockResolvedValue({ id: 9 });
    orders.getSupplierById.mockResolvedValue({ id: 7 });
    orders.getClientById.mockResolvedValue({ id: 9 });
    svc = new PortalService();
  });

  it('uses the company linked to the portal login', async () => {
    const linked = { ...supplierUser, supplierId: 7 };
    await svc.resolveParty(linked, { supplierId: 99 });
    expect(orders.getSupplierForAccount).toHaveBeenCalledWith(linked);
  });

  it('gives a supplier its own conversation, ignoring any id it asks for', async () => {
    await svc.getMessages(supplierUser, { supplierId: 99, clientId: undefined });

    expect(orders.getSupplierByEmail).toHaveBeenCalledWith('mal@test.local');
    expect(fn(prisma.portalMessage.findMany).mock.calls[0][0].where).toEqual({ supplierId: 7 });
  });

  it('gives a client its own conversation', async () => {
    await svc.getMessages(clientUser, {});
    expect(fn(prisma.portalMessage.findMany).mock.calls[0][0].where).toEqual({ clientId: 9 });
  });

  it('refuses a portal account with no linked company', async () => {
    orders.getSupplierByEmail.mockRejectedValue(new NotFoundError('No supplier profile'));
    await expect(svc.getMessages(supplierUser, {})).rejects.toThrow(NotFoundError);
    expect(prisma.portalMessage.findMany).not.toHaveBeenCalled();
  });

  it('requires staff to name the supplier or client', async () => {
    await expect(svc.getMessages(admin, {})).rejects.toThrow(BadRequestError);
  });

  it('checks that the supplier a staff member names exists', async () => {
    orders.getSupplierById.mockRejectedValue(new NotFoundError('Supplier not found'));
    await expect(svc.sendMessage(admin, { supplierId: 404 }, 'Hi')).rejects.toThrow(NotFoundError);
    expect(prisma.portalMessage.create).not.toHaveBeenCalled();
  });

  it('marks staff messages as from DVS and portal messages as not', async () => {
    fn(prisma.portalMessage.create).mockResolvedValue(row(true));
    const sent = await svc.sendMessage(admin, { clientId: 9 }, 'Your order is dispatched');
    expect(fn(prisma.portalMessage.create).mock.calls[0][0].data).toEqual({
      clientId: 9,
      fromDvs: true,
      senderId: 1,
      body: 'Your order is dispatched',
    });
    expect(sent.senderName).toBe('DVS Industries');

    fn(prisma.portalMessage.create).mockResolvedValue(row(false));
    const reply = await svc.sendMessage(supplierUser, {}, 'Noted');
    expect(fn(prisma.portalMessage.create).mock.calls[1][0].data.fromDvs).toBe(false);
    expect(reply.senderName).toBe('Asha Kulkarni');
  });

  it("marks only the other side's messages read", async () => {
    await svc.markRead(supplierUser, {});
    expect(fn(prisma.portalMessage.updateMany).mock.calls[0][0].where).toEqual({
      supplierId: 7,
      fromDvs: true,
      readAt: null,
    });

    await svc.markRead(admin, { supplierId: 7 });
    expect(fn(prisma.portalMessage.updateMany).mock.calls[1][0].where.fromDvs).toBe(false);
  });

  it('lists staff threads with unread counts per company', async () => {
    fn(prisma.portalMessage.findMany).mockResolvedValue([
      {
        body: 'When is PO 96 due?',
        createdAt: new Date('2026-11-01T10:00:00Z'),
        fromDvs: false,
        supplier: { id: 7, name: 'Mahindra Accelo', code: 'SUP-MAL' },
        client: null,
      },
      {
        body: 'Dispatched today',
        createdAt: new Date('2026-10-31T10:00:00Z'),
        fromDvs: true,
        supplier: null,
        client: { id: 9, name: 'Chitnis', code: 'CLT-CHITNIS' },
      },
    ]);
    fn(prisma.portalMessage.groupBy).mockResolvedValue([
      { supplierId: 7, clientId: null, _count: { _all: 2 } },
    ]);

    const threads = await svc.getThreads();

    expect(threads.map((t) => [t.kind, t.code, t.unread])).toEqual([
      ['supplier', 'SUP-MAL', 2],
      ['client', 'CLT-CHITNIS', 0],
    ]);
  });
});
