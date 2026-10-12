/**
 * Security service unit tests — incident state machine + alert lifecycle
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
    securityIncident: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    incidentUpdate: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
    securityAlert: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      delete: vi.fn(),
      groupBy: vi.fn(),
    },
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ max: null }]),
    $transaction: vi.fn((fns: unknown[]) => Promise.all(fns as Promise<unknown>[])),
  },
}));

vi.mock('../../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { prisma } from '../../lib/prismaClient';

const makeIncident = (status = 'OPEN', extra = {}) => ({
  id: 1,
  incidentNumber: 'INC-0001',
  title: 'Test',
  description: 'desc',
  aiSummary: null,
  type: 'FIRE',
  severity: 'MEDIUM',
  status,
  location: null,
  departmentId: null,
  departmentName: null,
  reportedById: null,
  reportedByName: null,
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
  updates: [],
  alerts: [],
  ...extra,
});

const makeAlert = (status = 'ACTIVE', severity = 'MEDIUM', extra = {}) => ({
  id: 1,
  alertNumber: 'ALT-0001',
  title: 'Alert',
  message: 'msg',
  type: 'SAFETY',
  severity,
  status,
  source: null,
  location: null,
  departmentId: null,
  departmentName: null,
  incidentId: null,
  acknowledgedById: null,
  acknowledgedByName: null,
  acknowledgedAt: null,
  resolvedById: null,
  resolvedByName: null,
  resolvedAt: null,
  expiresAt: null,
  createdById: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...extra,
});

const { SecurityService } = await import('../../services/security.service');

describe('SecurityService', () => {
  let svc: InstanceType<typeof SecurityService>;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new SecurityService();
  });

  // ── Incident state machine ───────────────────────────────────────────────────

  describe('createIncident — external incident idempotency', () => {
    it('creates an external incident when the incident id is new', async () => {
      const created = makeIncident('OPEN', {
        incidentNumber: 'INC-20260923-3A838D',
      });
      (prisma.securityIncident.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (prisma.securityIncident.create as ReturnType<typeof vi.fn>).mockResolvedValue(created);

      const result = await svc.createIncident({
        incidentNumber: 'INC-20260923-3A838D',
        title: 'fire',
        description: 'A fire was detected.',
        type: 'FIRE',
        severity: 'HIGH',
      });

      expect(result).toEqual(created);
      expect(prisma.securityIncident.create).toHaveBeenCalledOnce();
    });

    it('reuses an existing non-deleted incident with the same external id', async () => {
      const existing = makeIncident('OPEN', {
        incidentNumber: 'INC-20260923-3A838D',
      });
      (prisma.securityIncident.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(existing);

      const result = await svc.createIncident({
        incidentNumber: 'INC-20260923-3A838D',
        title: 'fire',
        description: 'A duplicate event.',
        type: 'FIRE',
      });

      expect(result).toEqual(existing);
      expect(prisma.securityIncident.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { incidentNumber: 'INC-20260923-3A838D', deletedAt: null },
        }),
      );
      expect(prisma.securityIncident.create).not.toHaveBeenCalled();
    });

    it('keeps external ids out of automatic numeric sequencing', async () => {
      const created = makeIncident('OPEN', { incidentNumber: 'INC-0001' });
      (prisma.securityIncident.create as ReturnType<typeof vi.fn>).mockResolvedValue(created);
      (prisma.securityIncident.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await svc.createIncident({
        title: 'manual incident',
        description: 'Created by the dashboard.',
        type: 'OTHER',
      });

      expect(result).toEqual(created);
      expect(prisma.securityIncident.findFirst).not.toHaveBeenCalled();
      expect(prisma.securityIncident.create).toHaveBeenCalledOnce();
    });
  });

  describe('updateIncident — state machine', () => {
    it('accepts aiSummary in an existing numeric update', async () => {
      (prisma.securityIncident.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeIncident('OPEN'),
      );
      (prisma.securityIncident.update as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeIncident('OPEN', { aiSummary: 'AI summary' }),
      );

      const result = await svc.updateIncident(1, { aiSummary: 'AI summary' });

      expect(result.aiSummary).toBe('AI summary');
      expect((prisma.securityIncident.update as ReturnType<typeof vi.fn>).mock.calls[0][0].data).toEqual({
        aiSummary: 'AI summary',
      });
    });

    it('allows OPEN → INVESTIGATING', async () => {
      (prisma.securityIncident.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeIncident('OPEN'),
      );
      (prisma.securityIncident.update as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeIncident('INVESTIGATING'),
      );

      const result = await svc.updateIncident(1, { status: 'INVESTIGATING' });
      expect(result.status).toBe('INVESTIGATING');
    });

    it('allows OPEN → RESOLVED (minor incident shortcut) and auto-sets resolvedAt', async () => {
      (prisma.securityIncident.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeIncident('OPEN'),
      );
      (prisma.securityIncident.update as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeIncident('RESOLVED'),
      );

      await svc.updateIncident(1, { status: 'RESOLVED' });
      const updateCall = (prisma.securityIncident.update as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(updateCall.data.resolvedAt).toBeDefined();
    });

    it('allows RESOLVED → CLOSED and auto-sets closedAt', async () => {
      (prisma.securityIncident.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeIncident('RESOLVED'),
      );
      (prisma.securityIncident.update as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeIncident('CLOSED'),
      );

      await svc.updateIncident(1, { status: 'CLOSED' });
      const updateCall = (prisma.securityIncident.update as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(updateCall.data.closedAt).toBeDefined();
    });

    it('rejects OPEN → CLOSED (illegal jump)', async () => {
      (prisma.securityIncident.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeIncident('OPEN'),
      );

      await expect(svc.updateIncident(1, { status: 'CLOSED' })).rejects.toThrow(BadRequestError);
    });

    it('rejects any transition from CLOSED', async () => {
      (prisma.securityIncident.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeIncident('CLOSED'),
      );

      await expect(svc.updateIncident(1, { status: 'RESOLVED' })).rejects.toThrow(BadRequestError);
    });
  });

  describe('updateIncidentAiSummary', () => {
    it('updates the existing incident found by incident number', async () => {
      const existing = makeIncident('OPEN', { incidentNumber: 'INC-20260921-C64998' });
      const updated = makeIncident('OPEN', {
        incidentNumber: 'INC-20260921-C64998',
        aiSummary: 'A possible fight was detected.',
      });
      (prisma.securityIncident.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(existing);
      (prisma.securityIncident.update as ReturnType<typeof vi.fn>).mockResolvedValue(updated);

      const result = await svc.updateIncidentAiSummary(
        'INC-20260921-C64998',
        'A possible fight was detected.',
      );

      expect(result).toEqual(updated);
      expect(prisma.securityIncident.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { incidentNumber: 'INC-20260921-C64998', deletedAt: null } }),
      );
      expect(prisma.securityIncident.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 1 }, data: { aiSummary: 'A possible fight was detected.' } }),
      );
      expect(prisma.securityIncident.create).not.toHaveBeenCalled();
    });

    it('throws when the incident number does not exist', async () => {
      (prisma.securityIncident.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        svc.updateIncidentAiSummary('INC-20260921-MISSING', 'A summary'),
      ).rejects.toThrow(NotFoundError);
      expect(prisma.securityIncident.update).not.toHaveBeenCalled();
      expect(prisma.securityIncident.create).not.toHaveBeenCalled();
    });
  });

  describe('escalateIncidentSeverity', () => {
    it('raises severity and records an incident update', async () => {
      const existing = makeIncident('OPEN', { incidentNumber: 'INC-20261012-FALL01', type: 'FALL' });
      const updated = makeIncident('OPEN', {
        incidentNumber: 'INC-20261012-FALL01',
        type: 'FALL',
        severity: 'CRITICAL',
      });
      (prisma.securityIncident.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(existing);
      (prisma.securityIncident.update as ReturnType<typeof vi.fn>).mockResolvedValue(updated);
      (prisma.incidentUpdate.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1 });

      const result = await svc.escalateIncidentSeverity(
        'INC-20261012-FALL01',
        'CRITICAL',
        'person still down 20s after fall',
        4,
        'Perception Service',
      );

      expect(result.severity).toBe('CRITICAL');
      expect(prisma.securityIncident.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 1 }, data: { severity: 'CRITICAL' } }),
      );
      expect(prisma.incidentUpdate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            incidentId: 1,
            comment: 'Raised severity MEDIUM -> CRITICAL: person still down 20s after fall',
            updatedById: 4,
            updatedByName: 'Perception Service',
          }),
        }),
      );
    });

    it.each([
      ['a lower severity', 'OPEN', 'LOW'],
      ['the same severity', 'OPEN', 'MEDIUM'],
      ['a resolved incident', 'RESOLVED', 'CRITICAL'],
    ])('is a no-op for %s', async (_label, status, severity) => {
      const existing = makeIncident(status);
      (prisma.securityIncident.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(existing);

      const result = await svc.escalateIncidentSeverity('INC-0001', severity as 'LOW', 'reason');

      expect(result).toEqual(existing);
      expect(prisma.securityIncident.update).not.toHaveBeenCalled();
      expect(prisma.incidentUpdate.create).not.toHaveBeenCalled();
    });

    it('raises confidence alone when severity is unchanged', async () => {
      const existing = makeIncident('OPEN', { confidenceScore: 0.82 });
      (prisma.securityIncident.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(existing);
      (prisma.securityIncident.update as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeIncident('OPEN', { confidenceScore: 0.97 }),
      );
      (prisma.incidentUpdate.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1 });

      await svc.escalateIncidentSeverity('INC-0001', 'MEDIUM', 'detection grew more certain', null, null, 0.97);

      expect(prisma.securityIncident.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { confidenceScore: 0.97 } }),
      );
      expect(prisma.incidentUpdate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            comment: 'Raised confidence 82% -> 97%: detection grew more certain',
          }),
        }),
      );
    });

    it('never lowers confidence', async () => {
      (prisma.securityIncident.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeIncident('OPEN', { confidenceScore: 0.9 }),
      );

      await svc.escalateIncidentSeverity('INC-0001', 'MEDIUM', 'reason', null, null, 0.7);

      expect(prisma.securityIncident.update).not.toHaveBeenCalled();
    });

    it('throws when the incident number does not exist', async () => {
      (prisma.securityIncident.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        svc.escalateIncidentSeverity('INC-MISSING', 'HIGH', 'reason'),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('deleteIncident', () => {
    it('soft-deletes OPEN incident', async () => {
      (prisma.securityIncident.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeIncident('OPEN'),
      );
      (prisma.securityIncident.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

      await expect(svc.deleteIncident(1)).resolves.not.toThrow();
    });

    it('blocks deletion of CLOSED incident', async () => {
      (prisma.securityIncident.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeIncident('CLOSED'),
      );

      await expect(svc.deleteIncident(1)).rejects.toThrow(BadRequestError);
    });
  });

  // ── Alert lifecycle ──────────────────────────────────────────────────────────

  describe('acknowledgeAlert', () => {
    it('acknowledges an ACTIVE alert', async () => {
      (prisma.securityAlert.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeAlert('ACTIVE'),
      );
      (prisma.securityAlert.update as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeAlert('ACKNOWLEDGED'),
      );

      const result = await svc.acknowledgeAlert(1, {});
      expect(result.status).toBe('ACKNOWLEDGED');
    });

    it('throws BadRequestError if alert is not ACTIVE', async () => {
      (prisma.securityAlert.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeAlert('RESOLVED'),
      );

      await expect(svc.acknowledgeAlert(1, {})).rejects.toThrow(BadRequestError);
    });

    it('auto-expires and throws if expiresAt is in the past', async () => {
      const past = new Date(Date.now() - 1000);
      (prisma.securityAlert.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeAlert('ACTIVE', 'MEDIUM', { expiresAt: past }),
      );
      (prisma.securityAlert.update as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeAlert('EXPIRED'),
      );

      await expect(svc.acknowledgeAlert(1, {})).rejects.toThrow(BadRequestError);
    });
  });

  describe('resolveAlert', () => {
    it('resolves ACKNOWLEDGED alert', async () => {
      (prisma.securityAlert.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeAlert('ACKNOWLEDGED'),
      );
      (prisma.securityAlert.update as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeAlert('RESOLVED'),
      );

      const result = await svc.resolveAlert(1, {});
      expect(result.status).toBe('RESOLVED');
    });

    it('throws BadRequestError if already RESOLVED', async () => {
      (prisma.securityAlert.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeAlert('RESOLVED'),
      );

      await expect(svc.resolveAlert(1, {})).rejects.toThrow(BadRequestError);
    });
  });

  describe('deleteAlert', () => {
    it('blocks deletion of ACTIVE + CRITICAL alert', async () => {
      (prisma.securityAlert.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeAlert('ACTIVE', 'CRITICAL'),
      );

      await expect(svc.deleteAlert(1)).rejects.toThrow(BadRequestError);
    });

    it('allows deletion of RESOLVED alert', async () => {
      (prisma.securityAlert.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeAlert('RESOLVED'),
      );
      (prisma.securityAlert.delete as ReturnType<typeof vi.fn>).mockResolvedValue({});

      await expect(svc.deleteAlert(1)).resolves.not.toThrow();
    });
  });
});
