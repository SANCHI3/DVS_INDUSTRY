/**
 * Production service unit tests — work order state machine + output recording
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestError, NotFoundError } from '../../errors';

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
    workOrder: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
      aggregate: vi.fn(),
    },
    workOrderOutput: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      delete: vi.fn(),
      aggregate: vi.fn(),
    },
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ max: null }]),
    $transaction: vi.fn((fns: unknown[]) => Promise.all(fns as Promise<unknown>[])),
  },
}));

vi.mock('../../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { prisma } from '../../lib/prismaClient';

const makeWO = (status = 'DRAFT', extra = {}) => ({
  id: 1,
  workOrderNumber: 'WO-0001',
  product: 'Steel Part',
  targetQuantity: { toNumber: () => 100 },
  unit: 'pcs',
  scheduledStart: null,
  scheduledEnd: null,
  actualStart: null,
  actualEnd: null,
  status,
  priority: 'NORMAL',
  departmentId: null,
  departmentName: null,
  assignedToId: null,
  assignedToName: null,
  clientOrderId: null,
  notes: null,
  createdById: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  outputs: [],
  _count: { outputs: 0 },
  ...extra,
});

const { ProductionService } = await import('../../services/production.service');

describe('ProductionService', () => {
  let svc: InstanceType<typeof ProductionService>;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new ProductionService();
  });

  // ── State machine ────────────────────────────────────────────────────────────

  describe('updateWorkOrder — status machine', () => {
    it('allows DRAFT → RELEASED', async () => {
      (prisma.workOrder.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(makeWO('DRAFT'));
      (prisma.workOrder.update as ReturnType<typeof vi.fn>).mockResolvedValue(makeWO('RELEASED'));

      const result = await svc.updateWorkOrder(1, { status: 'RELEASED' });
      expect(result.status).toBe('RELEASED');
    });

    it('allows RELEASED → IN_PROGRESS and auto-sets actualStart', async () => {
      (prisma.workOrder.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeWO('RELEASED'),
      );
      (prisma.workOrder.update as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeWO('IN_PROGRESS'),
      );

      const result = await svc.updateWorkOrder(1, { status: 'IN_PROGRESS' });
      expect(result.status).toBe('IN_PROGRESS');
      // auto-set actualStart — verify update was called with an actualStart
      const updateCall = (prisma.workOrder.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(updateCall.data.actualStart).toBeDefined();
    });

    it('allows IN_PROGRESS → COMPLETED and auto-sets actualEnd', async () => {
      (prisma.workOrder.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeWO('IN_PROGRESS'),
      );
      (prisma.workOrder.update as ReturnType<typeof vi.fn>).mockResolvedValue(makeWO('COMPLETED'));

      const result = await svc.updateWorkOrder(1, { status: 'COMPLETED' });
      expect(result.status).toBe('COMPLETED');
      const updateCall = (prisma.workOrder.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(updateCall.data.actualEnd).toBeDefined();
    });

    it('rejects DRAFT → COMPLETED (illegal jump)', async () => {
      (prisma.workOrder.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(makeWO('DRAFT'));

      await expect(svc.updateWorkOrder(1, { status: 'COMPLETED' })).rejects.toThrow(
        BadRequestError,
      );
    });

    it('rejects COMPLETED → RELEASED (terminal state)', async () => {
      (prisma.workOrder.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeWO('COMPLETED'),
      );

      await expect(svc.updateWorkOrder(1, { status: 'RELEASED' })).rejects.toThrow(BadRequestError);
    });

    it('throws NotFoundError for unknown WO', async () => {
      (prisma.workOrder.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(svc.getWorkOrderById(99)).rejects.toThrow(NotFoundError);
    });
  });

  // ── Delete work order ────────────────────────────────────────────────────────

  describe('deleteWorkOrder', () => {
    it('allows soft-delete of IN_PROGRESS WO', async () => {
      (prisma.workOrder.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeWO('IN_PROGRESS'),
      );
      (prisma.workOrder.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

      await expect(svc.deleteWorkOrder(1)).resolves.not.toThrow();
    });

    it('blocks deletion of COMPLETED WO', async () => {
      (prisma.workOrder.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeWO('COMPLETED'),
      );

      await expect(svc.deleteWorkOrder(1)).rejects.toThrow(BadRequestError);
    });
  });

  // ── Output recording ─────────────────────────────────────────────────────────

  describe('addOutput', () => {
    const mockOutput = {
      id: 1,
      workOrderId: 1,
      goodQty: { toString: () => '10' },
      rejectedQty: { toString: () => '1' },
      scrapQty: { toString: () => '0' },
      recordedAt: new Date(),
      recordedById: null,
      recordedByName: null,
      remarks: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('records output for RELEASED WO', async () => {
      (prisma.workOrder.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeWO('RELEASED'),
      );
      (prisma.workOrderOutput.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockOutput);

      const result = await svc.addOutput(1, { goodQty: '10', rejectedQty: '1', scrapQty: '0' });
      expect(result.goodQty).toBe('10');
    });

    it('records output for IN_PROGRESS WO', async () => {
      (prisma.workOrder.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeWO('IN_PROGRESS'),
      );
      (prisma.workOrderOutput.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockOutput);

      await expect(svc.addOutput(1, { goodQty: '5' })).resolves.not.toThrow();
    });

    it('blocks output for DRAFT WO', async () => {
      (prisma.workOrder.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(makeWO('DRAFT'));

      await expect(svc.addOutput(1, { goodQty: '5' })).rejects.toThrow(BadRequestError);
    });

    it('blocks output for COMPLETED WO', async () => {
      (prisma.workOrder.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeWO('COMPLETED'),
      );

      await expect(svc.addOutput(1, { goodQty: '5' })).rejects.toThrow(BadRequestError);
    });
  });
});
