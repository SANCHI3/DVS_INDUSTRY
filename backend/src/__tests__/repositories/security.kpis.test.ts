/**
 * Security KPI repository tests — the incident counts the AI Security page uses
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
    securityIncident: { count: vi.fn(), groupBy: vi.fn() },
    securityAlert: { count: vi.fn(), groupBy: vi.fn() },
    $transaction: vi.fn((fns: unknown[]) => Promise.all(fns as Promise<unknown>[])),
  },
}));

import { prisma } from '../../lib/prismaClient';
import { SecurityRepository } from '../../repositories/security.repository';

type Where = Record<string, unknown> & {
  status?: unknown;
  severity?: unknown;
  occurredAt?: { gte?: Date };
};

const countMock = vi.mocked(prisma.securityIncident.count);
const groupByMock = vi.mocked(prisma.securityIncident.groupBy);
const NOW = new Date(2026, 9, 17, 14, 30);
const MIDNIGHT = new Date(2026, 9, 17);

function isToday(where: Where) {
  return where.occurredAt?.gte?.getTime() === MIDNIGHT.getTime();
}

describe('SecurityRepository.getKPIs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    // Each incident count answers with a distinct number so the test can tell
    // which query produced which KPI.
    countMock.mockImplementation((async (args: { where: Where }) => {
      const where = args.where;
      if (isToday(where)) return 9;
      if (where.severity === 'CRITICAL') {
        return JSON.stringify(where.status) === JSON.stringify({ in: ['OPEN', 'INVESTIGATING'] }) ? 2 : 5;
      }
      if (where.status === 'OPEN') return 4;
      if (where.status === 'INVESTIGATING') return 3;
      if (where.status === 'RESOLVED') return 6;
      return 40;
    }) as never);
    groupByMock.mockImplementation((async (args: { by: string[]; where: Where }) => {
      if (args.by[0] === 'severity') return [{ severity: 'CRITICAL', _count: { id: 5 } }];
      if (isToday(args.where)) {
        return [
          { type: 'FALL', _count: { id: 6 } },
          { type: 'FIGHT', _count: { id: 3 } },
        ];
      }
      return [{ type: 'FALL', _count: { id: 30 } }];
    }) as never);
    vi.mocked(prisma.securityAlert.count).mockResolvedValue(0);
    vi.mocked(prisma.securityAlert.groupBy).mockResolvedValue([] as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns detections today, open, investigating and critical-open incident counts', async () => {
    const kpis = await new SecurityRepository().getKPIs();

    expect(kpis.detectionsToday).toBe(9);
    expect(kpis.openIncidents).toBe(4);
    expect(kpis.investigatingIncidents).toBe(3);
    expect(kpis.resolvedThisMonth).toBe(6);
    expect(kpis.criticalOpenIncidents).toBe(2);
    expect(kpis.criticalIncidents).toBe(5);
  });

  it('counts today from local midnight and excludes deleted incidents', async () => {
    await new SecurityRepository().getKPIs();

    const todayCount = countMock.mock.calls
      .map(([args]) => (args as { where: Where }).where)
      .find((where) => isToday(where) && where.status === undefined);
    expect(todayCount).toMatchObject({ deletedAt: null, occurredAt: { gte: MIDNIGHT } });
  });

  it('breaks today\'s incidents down by type', async () => {
    const kpis = await new SecurityRepository().getKPIs();

    expect(kpis.incidentsTodayByType).toEqual([
      { type: 'FALL', count: 6 },
      { type: 'FIGHT', count: 3 },
    ]);
    expect(kpis.incidentsByType).toEqual([{ type: 'FALL', count: 30 }]);
  });
});
