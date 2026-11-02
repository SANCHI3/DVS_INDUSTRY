/** POST /security/incidents/:ref/evidence: perception service only, JPEGs only. */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { fakeJpeg } from '../helpers/jpeg';

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
    EVIDENCE_RETENTION_DAYS: 30,
    EVIDENCE_S3_REGION: 'auto',
  },
}));

vi.mock('../../lib/prismaClient', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    securityIncident: { findFirst: vi.fn(), update: vi.fn() },
    incidentEvidence: { upsert: vi.fn() },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  },
}));

const ROLE_OF: Record<string, { id: number; role: string }> = {
  service: { id: 5, role: 'PERCEPTION_SERVICE' },
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
let app: Express;
const auth = (who: string) => ({ Authorization: `Bearer ${who}` });
const URL = '/api/v1/security/incidents/INC-20261104-ABC123/evidence';

beforeAll(async () => {
  app = (await import('../../app')).default;
});

beforeEach(() => {
  vi.clearAllMocks();
  fn(prisma.user.findUnique).mockImplementation(({ where }: { where: { id: number } }) => {
    const u = Object.values(ROLE_OF).find((x) => x.id === where.id)!;
    return Promise.resolve({
      id: u.id,
      email: 'x@test.com',
      fullName: 'X',
      isActive: true,
      role: { name: u.role },
    });
  });
  fn(prisma.securityIncident.findFirst).mockResolvedValue({
    id: 7,
    incidentNumber: 'INC-20261104-ABC123',
  });
});

describe('evidence upload', () => {
  it('stores keyframes and details sent by the perception service', async () => {
    const res = await request(app)
      .post(URL)
      .set(auth('service'))
      .field('meta', JSON.stringify({ eventType: 'fire_smoke', detail: {} }))
      .attach('keyframe_before', fakeJpeg(704, 576), {
        filename: 'b.jpg',
        contentType: 'image/jpeg',
      })
      .attach('keyframe_at', fakeJpeg(1280, 720), { filename: 'a.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ stored: 2 });
    expect(prisma.incidentEvidence.upsert).toHaveBeenCalledTimes(2);
  });

  it('is closed to website users', async () => {
    const res = await request(app)
      .post(URL)
      .set(auth('admin'))
      .attach('keyframe_at', fakeJpeg(640, 360), { filename: 'a.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(403);
  });

  it('rejects files that are not JPEGs or too big', async () => {
    const svg = await request(app)
      .post(URL)
      .set(auth('service'))
      .attach('keyframe_at', Buffer.from('<svg onload=alert(1)>'), {
        filename: 'a.jpg',
        contentType: 'image/jpeg',
      });
    expect(svg.status).toBe(400);
    const big = await request(app)
      .post(URL)
      .set(auth('service'))
      .attach('keyframe_at', fakeJpeg(640, 360, 300 * 1024), {
        filename: 'a.jpg',
        contentType: 'image/jpeg',
      });
    expect(big.status).toBeGreaterThanOrEqual(400);
    expect(big.status).toBeLessThan(500);
    expect(prisma.incidentEvidence.upsert).not.toHaveBeenCalled();
  });

  it('says when the incident is not on the website yet', async () => {
    fn(prisma.securityIncident.findFirst).mockResolvedValue(null);
    const res = await request(app)
      .post(URL)
      .set(auth('service'))
      .attach('keyframe_at', fakeJpeg(640, 360), { filename: 'a.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(404);
  });
});
