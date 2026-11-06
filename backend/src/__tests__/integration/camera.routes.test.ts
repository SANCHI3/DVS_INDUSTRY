/**
 * /api/v1/cameras: only the perception service reports; Security readers see
 * status and pictures through the API (no public image URLs).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
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
      update: vi.fn().mockResolvedValue({}),
    },
    securityIncident: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    securityAlert: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    $transaction: vi.fn().mockResolvedValue([]),
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
import { env } from '../../config/env';
import { signLiveToken } from '../../utils/liveToken';

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
    expect(res.body.data).toMatchObject({
      cameras: [],
      monitoring: { state: 'never', since: null, notice: null, liveEnabled: false, instances: [] },
    });
  });

  it('is closed to Store', async () => {
    expect((await request(app).get('/api/v1/cameras').set(auth('store'))).status).toBe(403);
  });
});

describe('the CCTV PC signing in with the service key', () => {
  const key = 'test-camera-service-key-0123456789abcdef';
  beforeAll(() => {
    env.CAMERA_SERVICE_KEY = key;
  });
  afterAll(() => {
    delete env.CAMERA_SERVICE_KEY;
  });

  it('works without any user lookup', async () => {
    const res = await request(app).get('/api/v1/cameras/ping').set('X-Service-Key', key);
    expect(res.status).toBe(200);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('refuses a wrong key', async () => {
    const res = await request(app).get('/api/v1/cameras/ping').set('X-Service-Key', 'wrong');
    expect(res.status).toBe(401);
  });

  it('gives no access to website data', async () => {
    const res = await request(app).get('/api/v1/cameras').set('X-Service-Key', key);
    expect(res.status).toBe(403);
  });
});

describe('live view', () => {
  const send = (body: object) => request(app).post('/api/v1/cameras/stream-auth').send(body);
  const read = { action: 'read', path: 'dvr-ch1-sd', protocol: 'webrtc' };

  it('lets the video server admit a valid pass for that stream only', async () => {
    const token = signLiveToken('dvr-ch1-sd', 1);
    expect((await send({ ...read, token })).status).toBe(200);
    expect((await send({ ...read, protocol: 'hls', query: `token=${token}` })).status).toBe(200);
    expect((await send({ ...read, path: 'dvr-ch2-sd', token })).status).toBe(401);
    expect((await send({ ...read, path: 'dvr-ch1-hd', token })).status).toBe(401);
  });

  it('never allows publishing, other protocols or no pass', async () => {
    const token = signLiveToken('dvr-ch1-sd', 1);
    expect((await send({ ...read, action: 'publish', token })).status).toBe(401);
    expect((await send({ ...read, protocol: 'rtsp', token })).status).toBe(401);
    expect((await send(read)).status).toBe(401);
    expect((await send({ ...read, token: 'admin' })).status).toBe(401);
  });

  it('gives passes to Security readers only, and logs the viewing once', async () => {
    const hb = { ...heartbeat, info: { liveUrl: 'https://plant.tail1234.ts.net' } };
    await request(app).post('/api/v1/cameras/heartbeat').set(auth('service')).send(hb);
    const url = '/api/v1/cameras/dvr-ch1/live-token?quality=sd';
    const ok = await request(app).get(url).set(auth('production'));
    expect(ok.status).toBe(200);
    expect(ok.body.data.available).toBe(true);
    await request(app).get(url).set(auth('production'));
    const logged = fn(prisma.auditLog.create).mock.calls.filter(
      (c) => (c[0] as { data: { action: string } }).data.action === 'LIVE_VIEW',
    );
    expect(logged).toHaveLength(1);
    expect((await request(app).get(url).set(auth('store'))).status).toBe(403);
    expect((await request(app).get(url)).status).toBe(401);
  });
});

describe('the software already installed at the plant', () => {
  // Exactly what cctv-setup-5 sends (reporting/camera_heartbeat.py). If this
  // fails, the change would break a PC that nobody can reach to update.
  const installedHeartbeat = {
    instanceId: 'plant-pc',
    source: 'live',
    cameras: [
      {
        id: 'dvr-ch1',
        channel: 1,
        name: 'Camera 01',
        zone: null,
        enabled: true,
        status: 'ONLINE',
        statusDetail: null,
        lastFrameAt: '2026-11-06T12:00:00.123456+00:00',
        achievedFps: 0.87,
        inferMs: 412.5,
      },
      {
        id: 'dvr-ch2',
        channel: 2,
        name: 'Camera 02',
        zone: null,
        enabled: true,
        status: 'VIDEO_LOSS',
        statusDetail: 'Black picture',
        lastFrameAt: null,
        achievedFps: null,
        inferMs: null,
      },
    ],
    info: { device: 'cpu', liveUrl: 'https://server.taild7bde2.ts.net' },
  };

  it('heartbeat is accepted', async () => {
    const res = await request(app)
      .post('/api/v1/cameras/heartbeat')
      .set('Authorization', 'Bearer service')
      .send(installedHeartbeat);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ cameras: 2 });
  });

  it('picture upload is accepted', async () => {
    await request(app)
      .post('/api/v1/cameras/heartbeat')
      .set('Authorization', 'Bearer service')
      .send(installedHeartbeat);
    const res = await request(app)
      .post('/api/v1/cameras/dvr-ch1/snapshot')
      .set('Authorization', 'Bearer service')
      .set('Content-Type', 'image/jpeg')
      .send(fakeJpeg(640, 360));
    expect(res.status).toBe(204);
  });
});

describe('PATCH /api/v1/cameras/:id', () => {
  const rename = (token: string, body: object) =>
    request(app)
      .patch('/api/v1/cameras/dvr-ch1')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  beforeEach(() => {
    fn(prisma.camera.findUnique).mockResolvedValue({
      name: 'Camera 01',
      zone: null,
      displayName: null,
      displayZone: null,
    });
  });

  it('lets an admin set the name and area', async () => {
    const res = await rename('admin', { name: 'Store aisle', zone: 'Warehouse' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ name: 'Store aisle', zone: 'Warehouse' });
  });

  it('is admin only, and the plant service cannot use it', async () => {
    expect((await rename('production', { name: 'x' })).status).toBe(403);
    expect((await rename('service', { name: 'x' })).status).toBe(403);
  });

  it('needs a name or an area', async () => {
    expect((await rename('admin', {})).status).toBe(422);
  });
});
