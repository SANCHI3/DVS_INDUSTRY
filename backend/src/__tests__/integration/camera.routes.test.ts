/**
 * /api/v1/cameras: only the perception service reports; Security readers see
 * status and pictures through the API (no public image URLs).
 */
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
  },
}));

vi.mock('../../lib/prismaClient', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    camera: {
      findMany: vi.fn(),
      upsert: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
    perceptionInstance: { findMany: vi.fn(), upsert: vi.fn().mockResolvedValue({}) },
    $queryRaw: vi.fn().mockResolvedValue([]),
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  },
}));

const ROLE_OF: Record<string, { id: number; role: string }> = {
  service: { id: 5, role: 'PERCEPTION_SERVICE' },
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
let app: Express;
const auth = (who: string) => ({ Authorization: `Bearer ${who}` });

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
  fn(prisma.camera.findMany).mockResolvedValue([]);
  fn(prisma.perceptionInstance.findMany).mockResolvedValue([]);
  fn(prisma.camera.updateMany).mockResolvedValue({ count: 1 });
});

const heartbeat = {
  instanceId: 'factory-pc',
  source: 'live',
  info: { device: 'CPU', path: 'direct' },
  cameras: [{ id: 'dvr-ch1', channel: 1, name: 'Camera 01', status: 'ONLINE', achievedFps: 2.9 }],
};

describe('POST /api/v1/cameras/heartbeat', () => {
  it('accepts the perception service', async () => {
    const res = await request(app)
      .post('/api/v1/cameras/heartbeat')
      .set(auth('service'))
      .send(heartbeat);
    expect(res.status).toBe(200);
    expect(prisma.camera.upsert).toHaveBeenCalled();
    expect(prisma.perceptionInstance.upsert).toHaveBeenCalled();
  });

  it('is not open to website users', async () => {
    const res = await request(app)
      .post('/api/v1/cameras/heartbeat')
      .set(auth('admin'))
      .send(heartbeat);
    expect(res.status).toBe(403);
  });

  it('rejects ids that could be anything', async () => {
    const res = await request(app)
      .post('/api/v1/cameras/heartbeat')
      .set(auth('service'))
      .send({ ...heartbeat, cameras: [{ ...heartbeat.cameras[0], id: '../etc' }] });
    expect(res.status).toBe(422);
  });
});

describe('snapshots', () => {
  it('takes a small JPEG from the service and overwrites the last one', async () => {
    const res = await request(app)
      .post('/api/v1/cameras/dvr-ch1/snapshot')
      .set(auth('service'))
      .set('Content-Type', 'image/jpeg')
      .send(fakeJpeg(640, 360, 4_000));
    expect(res.status).toBe(204);
    expect(prisma.camera.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'dvr-ch1' } }),
    );
  });

  it('refuses pictures that are too wide or not JPEGs', async () => {
    const wide = await request(app)
      .post('/api/v1/cameras/dvr-ch1/snapshot')
      .set(auth('service'))
      .set('Content-Type', 'image/jpeg')
      .send(fakeJpeg(1920, 1080));
    expect(wide.status).toBe(400);
    const png = await request(app)
      .post('/api/v1/cameras/dvr-ch1/snapshot')
      .set(auth('service'))
      .set('Content-Type', 'image/jpeg')
      .send(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));
    expect(png.status).toBe(400);
  });

  it('serves the picture to Security readers only, privately', async () => {
    fn(prisma.camera.findUnique).mockResolvedValue({
      lastSnapshot: new Uint8Array(fakeJpeg(640, 360)),
      snapshotAt: new Date(),
    });
    const ok = await request(app).get('/api/v1/cameras/dvr-ch1/snapshot').set(auth('production'));
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toBe('image/jpeg');
    expect(ok.headers['cache-control']).toContain('private');
    const denied = await request(app).get('/api/v1/cameras/dvr-ch1/snapshot').set(auth('store'));
    expect(denied.status).toBe(403);
    const anonymous = await request(app).get('/api/v1/cameras/dvr-ch1/snapshot');
    expect(anonymous.status).toBe(401);
  });
});

describe('GET /api/v1/cameras', () => {
  it('lists cameras and the monitoring state for Production', async () => {
    const res = await request(app).get('/api/v1/cameras').set(auth('production'));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      cameras: [],
      monitoring: { state: 'never', since: null, instances: [] },
    });
  });

  it('is closed to Store', async () => {
    expect((await request(app).get('/api/v1/cameras').set(auth('store'))).status).toBe(403);
  });
});
