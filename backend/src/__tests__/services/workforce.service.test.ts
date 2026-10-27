/**
 * Workforce service unit tests — Shifts + Attendance
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictError, NotFoundError, BadRequestError } from '../../errors';

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
    shift: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    attendance: {
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      delete: vi.fn(),
    },
    employee: { findFirst: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
    department: { findMany: vi.fn() },
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ max: null }]),
    $transaction: vi.fn((fns: unknown[]) => Promise.all(fns as Promise<unknown>[])),
  },
}));

vi.mock('../../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { prisma } from '../../lib/prismaClient';

const mockShift = {
  id: 1,
  name: 'Morning',
  startTime: '08:00',
  endTime: '16:00',
  isNightShift: false,
  description: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  _count: { employees: 0 },
};

const mockEmployee = { id: 1, deletedAt: null };

const mockAttendance = {
  id: 1,
  employeeId: 1,
  date: new Date('2026-06-12T00:00:00.000Z'),
  clockIn: new Date('2026-06-12T08:00:00.000Z'),
  clockOut: null,
  workingHours: null,
  status: 'PRESENT',
  remarks: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  employee: {
    id: 1,
    employeeCode: 'EMP-001',
    firstName: 'Arjun',
    lastName: 'Mehta',
    designation: 'Operator',
    department: null,
  },
};

const { WorkforceService } = await import('../../services/workforce.service');

describe('WorkforceService', () => {
  let svc: InstanceType<typeof WorkforceService>;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new WorkforceService();
  });

  // ── Shifts ──────────────────────────────────────────────────────────────────

  describe('createShift', () => {
    it('creates shift when name is unique', async () => {
      (prisma.shift.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (prisma.shift.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockShift);

      const result = await svc.createShift({
        name: 'Morning',
        startTime: '08:00',
        endTime: '16:00',
      });
      expect(result.name).toBe('Morning');
      expect(prisma.shift.create).toHaveBeenCalledOnce();
    });

    it('throws ConflictError when name already taken', async () => {
      (prisma.shift.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockShift);

      await expect(
        svc.createShift({ name: 'Morning', startTime: '08:00', endTime: '16:00' }),
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('deleteShift', () => {
    it('throws BadRequestError if employees are assigned', async () => {
      (prisma.shift.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...mockShift,
        _count: { employees: 3 },
      });

      await expect(svc.deleteShift(1)).rejects.toThrow(BadRequestError);
    });

    it('deletes shift when no employees assigned', async () => {
      (prisma.shift.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockShift);
      (prisma.shift.delete as ReturnType<typeof vi.fn>).mockResolvedValue(mockShift);

      await expect(svc.deleteShift(1)).resolves.not.toThrow();
      expect(prisma.shift.delete).toHaveBeenCalledOnce();
    });

    it('throws NotFoundError for unknown shift id', async () => {
      (prisma.shift.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(svc.deleteShift(99)).rejects.toThrow(NotFoundError);
    });
  });

  // ── Attendance ──────────────────────────────────────────────────────────────

  describe('createAttendance', () => {
    it('creates attendance record successfully', async () => {
      (prisma.employee.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockEmployee);
      (prisma.attendance.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (prisma.attendance.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockAttendance);

      const result = await svc.createAttendance({
        employeeId: 1,
        date: new Date('2026-06-12'),
        status: 'PRESENT',
      });

      expect(result.status).toBe('PRESENT');
    });

    it('throws NotFoundError if employee does not exist', async () => {
      (prisma.employee.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        svc.createAttendance({ employeeId: 999, date: new Date(), status: 'PRESENT' }),
      ).rejects.toThrow(NotFoundError);
    });

    it('throws BadRequestError if clockOut is before clockIn', async () => {
      (prisma.employee.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockEmployee);

      const clockIn = new Date('2026-06-12T10:00:00Z');
      const clockOut = new Date('2026-06-12T08:00:00Z'); // before clockIn

      await expect(
        svc.createAttendance({
          employeeId: 1,
          date: new Date(),
          status: 'PRESENT',
          clockIn,
          clockOut,
        }),
      ).rejects.toThrow(BadRequestError);
    });
  });

  describe('clockIn', () => {
    it('creates clock-in record', async () => {
      (prisma.employee.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockEmployee);
      (prisma.attendance.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (prisma.attendance.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(mockAttendance);

      const result = await svc.clockIn(1, new Date('2026-06-12T08:00:00Z'), null);
      expect(result.status).toBe('PRESENT');
    });

    it('throws BadRequestError if already clocked in today', async () => {
      (prisma.employee.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockEmployee);
      (prisma.attendance.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockAttendance);

      await expect(svc.clockIn(1, new Date('2026-06-12T09:00:00Z'), null)).rejects.toThrow(
        BadRequestError,
      );
    });
  });

  describe('clockOut', () => {
    it('throws BadRequestError if no clock-in exists', async () => {
      (prisma.attendance.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...mockAttendance,
        clockIn: null,
      });

      await expect(svc.clockOut(1, new Date('2026-06-12T17:00:00Z'), null)).rejects.toThrow(
        BadRequestError,
      );
    });

    it('throws BadRequestError if clockOut <= clockIn', async () => {
      (prisma.attendance.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockAttendance);

      await expect(
        svc.clockOut(1, new Date('2026-06-12T07:00:00Z'), null), // before clockIn at 08:00
      ).rejects.toThrow(BadRequestError);
    });

    it('throws NotFoundError for unknown attendance id', async () => {
      (prisma.attendance.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(svc.clockOut(999, new Date(), null)).rejects.toThrow(NotFoundError);
    });
  });
});
