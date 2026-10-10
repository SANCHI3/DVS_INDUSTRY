/**
 * Inventory service unit tests — stock adjustments + low-stock detection
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError, BadRequestError } from '../../errors';

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
    material: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    stockTransaction: { create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    scrapRecord: { create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ max: null }]),
    $transaction: vi.fn((cb: unknown) => {
      if (typeof cb === 'function')
        return cb({
          material: { findUnique: vi.fn(), update: vi.fn() },
          stockTransaction: { create: vi.fn() },
        });
      if (Array.isArray(cb)) return Promise.all(cb as Promise<unknown>[]);
      return Promise.resolve([]);
    }),
  },
}));

vi.mock('../../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { prisma } from '../../lib/prismaClient';

const makeMaterial = (stock: number, min: number) => ({
  id: 1,
  name: 'Steel Sheet',
  code: 'STL-001',
  description: null,
  unit: 'kg',
  category: 'Steel',
  location: 'WH-A',
  currentStock: {
    toNumber: () => stock,
    lessThanOrEqualTo: (v: unknown) => stock <= Number(v),
    toString: () => String(stock),
  },
  minStockLevel: { toNumber: () => min, toString: () => String(min) },
  maxStockLevel: null,
  costPerUnit: { toNumber: () => 72 },
  currency: 'INR',
  isActive: true,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const { InventoryService } = await import('../../services/inventory.service');

describe('InventoryService', () => {
  let svc: InstanceType<typeof InventoryService>;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new InventoryService();
  });

  // ── Create material ──────────────────────────────────────────────────────────

  describe('createMaterial', () => {
    it('creates material with unique code and name', async () => {
      (prisma.material.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (prisma.material.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (prisma.material.create as ReturnType<typeof vi.fn>).mockResolvedValue(makeMaterial(0, 100));

      const result = await svc.createMaterial({ name: 'Steel Sheet', code: 'STL-001', unit: 'kg' });
      expect(result.name).toBe('Steel Sheet');
    });

    it('throws NotFoundError/ConflictError for duplicate code', async () => {
      (prisma.material.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeMaterial(100, 50),
      );

      await expect(
        svc.createMaterial({ name: 'Other', code: 'STL-001', unit: 'kg' }),
      ).rejects.toThrow();
    });
  });

  // ── Stock adjustment ─────────────────────────────────────────────────────────

  describe('adjustStock', () => {
    const txnRow = (type: string, balance: string) => ({
      id: 1,
      materialId: 1,
      type,
      quantity: { toString: () => '10' },
      balanceAfter: { toString: () => balance },
      referenceNo: null,
      reason: null,
      performedById: null,
      performedByName: null,
      departmentId: null,
      departmentName: null,
      createdAt: new Date(),
      material: { name: 'Steel', code: 'STL-001', unit: 'kg' },
    });

    /** Wire $transaction to a tx whose locked material row has `stock`. */
    const useLockedStock = (stock: string | null, deletedAt: Date | null = null) => {
      const tx = {
        $queryRaw: vi
          .fn()
          .mockResolvedValue(stock === null ? [] : [{ currentStock: stock, unit: 'kg', deletedAt }]),
        material: { update: vi.fn().mockResolvedValue({}) },
        stockTransaction: { create: vi.fn().mockResolvedValue(txnRow('OUT', '0')) },
        scrapRecord: { create: vi.fn() },
      };
      (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation((cb: unknown) =>
        typeof cb === 'function' ? cb(tx) : Promise.resolve([]),
      );
      return tx;
    };

    it('throws NotFoundError for unknown material', async () => {
      useLockedStock(null);
      await expect(
        svc.adjustStock({ materialId: 99, type: 'IN', quantity: '100' }),
      ).rejects.toThrow(NotFoundError);
    });

    it('locks the material row before reading stock', async () => {
      const tx = useLockedStock('50');
      await svc.adjustStock({ materialId: 1, type: 'OUT', quantity: '10' });
      const sql = (tx.$queryRaw.mock.calls[0][0] as string[]).join('?');
      expect(sql).toContain('FOR UPDATE');
    });

    it('rejects OUT beyond available stock instead of clamping to zero', async () => {
      const tx = useLockedStock('50');
      await expect(
        svc.adjustStock({ materialId: 1, type: 'OUT', quantity: '200' }),
      ).rejects.toThrow(BadRequestError);
      expect(tx.material.update).not.toHaveBeenCalled();
      expect(tx.stockTransaction.create).not.toHaveBeenCalled();
    });

    it('rejects movements on a deleted material', async () => {
      useLockedStock('50', new Date());
      await expect(
        svc.adjustStock({ materialId: 1, type: 'IN', quantity: '1' }),
      ).rejects.toThrow(BadRequestError);
    });

    it('uses exact decimal arithmetic for the new balance', async () => {
      const tx = useLockedStock('0.3');
      await svc.adjustStock({ materialId: 1, type: 'OUT', quantity: '0.1' });
      const update = tx.material.update.mock.calls[0][0] as { data: { currentStock: unknown } };
      expect(String(update.data.currentStock)).toBe('0.2'); // not 0.19999999999999998
    });

    it('applies a negative ADJUSTMENT as a reduction', async () => {
      const tx = useLockedStock('10');
      await svc.adjustStock({ materialId: 1, type: 'ADJUSTMENT', quantity: '-2.5' });
      const update = tx.material.update.mock.calls[0][0] as { data: { currentStock: unknown } };
      expect(String(update.data.currentStock)).toBe('7.5');
    });

    it('allows IN regardless of current stock', async () => {
      const tx = useLockedStock('0');
      tx.stockTransaction.create.mockResolvedValue(txnRow('IN', '100'));
      const result = await svc.adjustStock({ materialId: 1, type: 'IN', quantity: '100' });
      expect(result.type).toBe('IN');
    });

    it('records scrap and deducts stock in the same transaction', async () => {
      const tx = useLockedStock('20');
      tx.scrapRecord.create.mockResolvedValue({
        id: 7,
        materialId: 1,
        quantity: { toString: () => '5' },
        unit: 'kg',
        departmentId: null,
        departmentName: null,
        employeeId: null,
        employeeName: null,
        reason: null,
        recoveryValue: null,
        recordedAt: new Date(),
        createdAt: new Date(),
        material: { name: 'Steel', code: 'STL-001' },
      });
      await svc.recordScrap({ materialId: 1, quantity: '5', unit: 'kg' });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.material.update).toHaveBeenCalledTimes(1);
      expect(tx.scrapRecord.create).toHaveBeenCalledTimes(1);
    });
  });

  // ── Low-stock detection ──────────────────────────────────────────────────────

  describe('getMaterialById', () => {
    it('returns material with isLowStock=true when stock <= min', async () => {
      (prisma.material.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeMaterial(50, 100),
      );

      const result = await svc.getMaterialById(1);
      expect(result.isLowStock).toBe(true);
    });

    it('returns isLowStock=false when stock > min', async () => {
      (prisma.material.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeMaterial(500, 100),
      );

      const result = await svc.getMaterialById(1);
      expect(result.isLowStock).toBe(false);
    });

    it('throws NotFoundError for unknown material', async () => {
      (prisma.material.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(svc.getMaterialById(99)).rejects.toThrow(NotFoundError);
    });
  });
});
