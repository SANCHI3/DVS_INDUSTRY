/**
 * Modules connected (Phase 7): PO receipt adds stock, client orders drive
 * work orders, and work-order output can take raw material out of stock.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

vi.mock('../../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const tx = {
  $queryRaw: vi.fn(),
  material: { update: vi.fn() },
  stockTransaction: { create: vi.fn() },
  purchaseOrder: { update: vi.fn() },
  workOrderOutput: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
};

vi.mock('../../lib/prismaClient', () => ({
  prisma: {
    purchaseOrder: { findUnique: vi.fn(), update: vi.fn() },
    clientOrder: { findUnique: vi.fn(), update: vi.fn() },
    workOrder: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    workOrderOutput: { findUnique: vi.fn(), create: vi.fn() },
    partSpec: { findUnique: vi.fn() },
    material: { findUnique: vi.fn(), findFirst: vi.fn() },
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ max: null }]),
    $transaction: vi.fn((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (t: typeof tx) => unknown)(tx)
        : Promise.all(arg as Promise<unknown>[]),
    ),
  },
}));

import { prisma } from '../../lib/prismaClient';
import { BadRequestError } from '../../errors';

const { OrdersService } = await import('../../services/orders.service');
const { ProductionService } = await import('../../services/production.service');

const fn = (f: unknown) => f as ReturnType<typeof vi.fn>;
const D = (n: number) => new Prisma.Decimal(n);

const po = (overrides: Record<string, unknown> = {}) => ({
  id: 4,
  poNumber: 'PO-MAL-96-1',
  supplierId: 1,
  material: 'SPCC Sheet',
  quantity: '1000',
  unit: 'kg',
  totalCost: null,
  currency: 'INR',
  orderDate: new Date('2026-10-20'),
  expectedDelivery: null,
  actualDelivery: null,
  materialId: 7,
  quantityValue: D(1000),
  receivedQty: D(0),
  confirmedAt: null,
  dispatchDate: null,
  dispatchedAt: null,
  supplierNote: null,
  status: 'IN_TRANSIT',
  notes: null,
  createdById: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  supplier: { name: 'Mahindra Accelo' },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  tx.$queryRaw.mockResolvedValue([{ currentStock: '200', unit: 'kg', deletedAt: null }]);
  tx.stockTransaction.create.mockResolvedValue({});
  tx.material.update.mockResolvedValue({});
  tx.purchaseOrder.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve(po({ ...(data['status'] ? { status: data['status'] } : {}) })),
  );
});

describe('receiving a purchase order', () => {
  it('adds the whole due quantity to stock and closes the PO', async () => {
    fn(prisma.purchaseOrder.findUnique).mockResolvedValue(po());
    const result = await new OrdersService().deliverPurchaseOrder(4, undefined, {
      id: 2,
      name: 'Store',
    });

    expect(tx.material.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { currentStock: D(1200) },
    });
    expect(tx.stockTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'IN',
          quantity: '1000.000',
          referenceNo: 'PO-MAL-96-1',
        }),
      }),
    );
    expect(tx.purchaseOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'DELIVERED' }) }),
    );
    expect(result.status).toBe('DELIVERED');
  });

  it('keeps the PO open after a partial receipt', async () => {
    fn(prisma.purchaseOrder.findUnique).mockResolvedValue(po());
    await new OrdersService().deliverPurchaseOrder(4, 400);
    const data = tx.purchaseOrder.update.mock.calls[0]![0].data;
    expect(data.receivedQty).toEqual({ increment: '400.000' });
    expect(data.status).toBeUndefined();
  });

  it('leaves POs without a stock material as before (no stock movement)', async () => {
    fn(prisma.purchaseOrder.findUnique).mockResolvedValue(po({ materialId: null }));
    fn(prisma.purchaseOrder.update).mockResolvedValue(
      po({ materialId: null, status: 'DELIVERED' }),
    );
    await new OrdersService().deliverPurchaseOrder(4);
    expect(tx.stockTransaction.create).not.toHaveBeenCalled();
  });
});

describe('client orders and work orders', () => {
  const linked = (status: string) => ({
    id: 1,
    workOrderNumber: 'WO-0101',
    status,
    targetQuantity: D(500),
    unit: 'pcs',
    outputs: [],
  });

  it('will not dispatch while a linked work order is unfinished', async () => {
    fn(prisma.clientOrder.findUnique).mockResolvedValue({
      id: 9,
      status: 'IN_PRODUCTION',
      orderNumber: 'ORD-9',
      client: { name: 'CES' },
    });
    fn(prisma.workOrder.findMany).mockResolvedValue([linked('IN_PROGRESS')]);
    await expect(new OrdersService().dispatchClientOrder(9, {})).rejects.toThrow(
      'Finish the linked work order first: WO-0101',
    );
  });

  it('moves an approved client order into production when a work order is made for it', async () => {
    fn(prisma.clientOrder.findUnique).mockResolvedValue({
      id: 9,
      status: 'APPROVED',
      orderNumber: 'ORD-9',
    });
    fn(prisma.workOrder.create).mockResolvedValue({
      ...linked('DRAFT'),
      product: 'Bracket',
      outputs: [],
      _count: { outputs: 0 },
    });
    await new ProductionService()
      .createWorkOrder({ product: 'Bracket', targetQuantity: '500', clientOrderId: 9 })
      .catch(() => undefined);
    expect(prisma.clientOrder.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { status: 'IN_PRODUCTION', productionStartedAt: expect.any(Date) },
    });
  });

  it('refuses a work order for a client order that is not approved', async () => {
    fn(prisma.clientOrder.findUnique).mockResolvedValue({
      id: 9,
      status: 'PENDING',
      orderNumber: 'ORD-9',
    });
    await expect(
      new ProductionService().createWorkOrder({
        product: 'Bracket',
        targetQuantity: '500',
        clientOrderId: 9,
      }),
    ).rejects.toThrow(BadRequestError);
  });
});

describe('deducting raw material for output', () => {
  const wo = {
    id: 3,
    workOrderNumber: 'WO-0103',
    product: 'Bracket',
    targetQuantity: D(800),
    unit: 'pcs',
    status: 'IN_PROGRESS',
    partSpecId: 2,
    materialId: 7,
    deductMaterial: true,
    outputs: [],
    _count: { outputs: 0 },
  };

  it('takes sheets out of stock for every piece made', async () => {
    fn(prisma.workOrder.findFirst).mockResolvedValue(wo);
    fn(prisma.partSpec.findUnique).mockResolvedValue({
      partNumber: 'BRK-110',
      piecesPerSheet: 80,
      piecesPerStrip: 10,
    });
    fn(prisma.material.findUnique).mockResolvedValue({ unit: 'sheets' });
    tx.workOrderOutput.create.mockResolvedValue({
      id: 1,
      workOrderId: 3,
      goodQty: D(150),
      rejectedQty: D(8),
      scrapQty: D(2),
      recordedAt: new Date(),
      recordedById: null,
      recordedByName: null,
      remarks: null,
      materialIssued: D(2),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await new ProductionService().addOutput(3, { goodQty: '150', rejectedQty: '8', scrapQty: '2' });

    expect(tx.stockTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'OUT', quantity: '2.000', referenceNo: 'WO-0103' }),
      }),
    );
    expect(tx.workOrderOutput.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ materialIssued: '2.000' }) }),
    );
  });

  it('refuses to turn deduction on for a material counted in kg', async () => {
    fn(prisma.partSpec.findUnique).mockResolvedValue({ piecesPerSheet: 80, piecesPerStrip: 10 });
    fn(prisma.material.findFirst).mockResolvedValue({ unit: 'kg' });
    await expect(
      new ProductionService().createWorkOrder({
        product: 'Bracket',
        targetQuantity: '800',
        partSpecId: 2,
        materialId: 7,
        deductMaterial: true,
      }),
    ).rejects.toThrow(/sheets or strips/);
  });
});
