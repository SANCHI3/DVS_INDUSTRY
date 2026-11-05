/**
 * Heartbeats and pictures stay in memory so Neon can sleep; live-view passes.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/prismaClient', () => ({ prisma: {} }));

import { CameraService, DB_REFRESH_MS } from '../../services/camera.service';
import { CameraState } from '../../services/camera.state';
import { liveTokenPath, signLiveToken } from '../../utils/liveToken';
import { serviceKeyMatches } from '../../utils/serviceKey';
import { resolveAction } from '../../middleware/auditLog';
import { fakeJpeg } from '../helpers/jpeg';
import type { CameraRepository } from '../../repositories/camera.repository';

const NOW = new Date('2026-11-05T09:00:00Z');
const later = (ms: number) => new Date(NOW.getTime() + ms);

function setup() {
  const repo = {
    findAll: vi.fn().mockResolvedValue([]),
    findInstances: vi.fn().mockResolvedValue([]),
    upsertFromHeartbeat: vi.fn().mockResolvedValue(undefined),
    ensure: vi.fn().mockResolvedValue(undefined),
    saveInstance: vi.fn().mockResolvedValue(undefined),
    saveSnapshot: vi.fn().mockResolvedValue(true),
    findSnapshot: vi.fn().mockResolvedValue(null),
    lastDetections: vi.fn().mockResolvedValue([]),
  };
  const service = new CameraService(repo as unknown as CameraRepository, new CameraState());
  return { repo, service };
}

const beat = (status: 'ONLINE' | 'OFFLINE' = 'ONLINE', info?: Record<string, string>) => ({
  instanceId: 'factory-pc',
  source: 'LIVE' as const,
  ...(info && { info }),
  cameras: [{ id: 'dvr-ch1', channel: 1, name: 'Camera 01', enabled: true, status }],
});

describe('database writes', () => {
  it('reads the database once and then only writes when something changes', async () => {
    const { repo, service } = setup();
    await service.heartbeat(beat(), NOW);
    expect(repo.upsertFromHeartbeat).toHaveBeenCalledTimes(1);
    expect(repo.saveInstance).toHaveBeenCalledTimes(1);

    for (let i = 1; i <= 20; i++) await service.heartbeat(beat(), later(i * 30_000));
    expect(repo.findAll).toHaveBeenCalledTimes(1);
    expect(repo.upsertFromHeartbeat).toHaveBeenCalledTimes(1);
    expect(repo.saveInstance).toHaveBeenCalledTimes(1);

    await service.heartbeat(beat('OFFLINE'), later(630_000));
    expect(repo.upsertFromHeartbeat).toHaveBeenCalledTimes(2);
  });

  it('retries a status that could not be saved', async () => {
    const { repo, service } = setup();
    repo.upsertFromHeartbeat.mockRejectedValueOnce(new Error('database asleep'));
    await service.heartbeat(beat(), NOW);
    await service.heartbeat(beat(), later(30_000));
    expect(repo.upsertFromHeartbeat).toHaveBeenCalledTimes(2);
  });

  it('keeps every picture in memory but saves one per 30 minutes', async () => {
    const { repo, service } = setup();
    await service.heartbeat(beat(), NOW);
    const first = fakeJpeg(640, 360, 2_000);
    const second = fakeJpeg(640, 360, 3_000);
    await service.saveSnapshot('dvr-ch1', first, NOW);
    await service.saveSnapshot('dvr-ch1', second, later(120_000));
    expect(repo.saveSnapshot).toHaveBeenCalledTimes(1);
    expect((await service.getSnapshot('dvr-ch1')).data).toBe(second);
    expect(repo.findSnapshot).not.toHaveBeenCalled();

    await service.saveSnapshot('dvr-ch1', second, later(DB_REFRESH_MS));
    expect(repo.saveSnapshot).toHaveBeenCalledTimes(2);
  });

  it('does not write an audit row for machine traffic', () => {
    expect(resolveAction('POST', '/api/v1/cameras/heartbeat', 200)).toBeNull();
    expect(resolveAction('POST', '/api/v1/cameras/dvr-ch1/snapshot', 204)).toBeNull();
    expect(resolveAction('POST', '/api/v1/cameras/stream-auth', 200)).toBeNull();
  });

  it('shows memory newer than the database', async () => {
    const { repo, service } = setup();
    await service.heartbeat(beat(), NOW);
    repo.findAll.mockResolvedValue([
      {
        id: 'dvr-ch1',
        channel: 1,
        name: 'Camera 01',
        zone: null,
        enabled: true,
        status: 'ONLINE',
        statusDetail: null,
        statusSince: NOW,
        lastHeartbeatAt: NOW,
        lastFrameAt: null,
        achievedFps: null,
        inferMs: null,
        snapshotAt: null,
      },
    ]);
    const seen = later(20 * 60_000);
    await service.heartbeat(beat(), seen);
    const { cameras } = await service.list(later(20 * 60_000 + 1_000));
    expect(cameras[0]?.lastHeartbeatAt).toBe(seen.toISOString());
    expect(cameras[0]?.status).toBe('ONLINE'); // the database copy alone would look stale
  });
});

describe('DVR address notice', () => {
  it('reaches the Cameras page', async () => {
    const { repo, service } = setup();
    await service.heartbeat(
      beat('ONLINE', { dvrNotice: 'DVR address changed to 192.168.0.110' }),
      NOW,
    );
    repo.findInstances.mockResolvedValue([
      {
        id: 'factory-pc',
        source: 'LIVE',
        lastHeartbeatAt: NOW,
        cameraIds: ['dvr-ch1'],
        info: null,
      },
    ]);
    const { monitoring } = await service.list(later(1_000));
    expect(monitoring.notice).toBe('DVR address changed to 192.168.0.110');
  });
});

describe('live view access', () => {
  const url = 'https://dvsaccounts-server.tail1234.ts.net';

  it('gives a pass for exactly one camera stream', async () => {
    const { service } = setup();
    await service.heartbeat(beat('ONLINE', { liveUrl: url }), NOW);
    const access = service.liveAccess('dvr-ch1', 'hd', 7, later(1_000));
    if (!access.available) throw new Error('expected a pass');
    expect(access.whepUrl).toBe(`${url}/dvr-ch1-hd/whep`);
    expect(access.hlsUrl).toBe(`${url}:8443/dvr-ch1-hd/index.m3u8`);
    expect(liveTokenPath(access.token)).toBe('dvr-ch1-hd');
  });

  it('says why when there is no video', async () => {
    const { service } = setup();
    expect(service.liveAccess('dvr-ch1', 'sd', 7, NOW)).toEqual({
      available: false,
      reason: 'monitoring-offline',
    });
    await service.heartbeat(beat('OFFLINE', { liveUrl: url }), NOW);
    expect(service.liveAccess('dvr-ch1', 'sd', 7, later(1_000))).toEqual({
      available: false,
      reason: 'camera-offline',
    });
    await service.heartbeat(beat('ONLINE'), later(2_000));
    expect(service.liveAccess('dvr-ch1', 'sd', 7, later(10 * 60_000))).toEqual({
      available: false,
      reason: 'monitoring-offline',
    });
  });

  it('never points viewers anywhere but a Tailscale address', async () => {
    const { service } = setup();
    await service.heartbeat(beat('ONLINE', { liveUrl: 'https://evil.example.com' }), NOW);
    expect(service.liveAccess('dvr-ch1', 'sd', 7, later(1_000))).toEqual({
      available: false,
      reason: 'not-enabled',
    });
  });

  it('refuses a forged or expired pass', () => {
    vi.useFakeTimers({ now: NOW });
    const token = signLiveToken('dvr-ch1-sd', 7);
    expect(liveTokenPath(token)).toBe('dvr-ch1-sd');
    expect(liveTokenPath(`${token}x`)).toBeNull();
    vi.setSystemTime(later(121_000));
    expect(liveTokenPath(token)).toBeNull();
    vi.useRealTimers();
  });
});

describe('service key', () => {
  const key = 'k'.repeat(32);

  it('accepts only the exact key', () => {
    expect(serviceKeyMatches(key, key)).toBe(true);
    expect(serviceKeyMatches(`${key}x`, key)).toBe(false);
    expect(serviceKeyMatches(undefined, key)).toBe(false);
  });

  it('lets nobody in when the key is missing or too short', () => {
    expect(serviceKeyMatches('', undefined)).toBe(false);
    expect(serviceKeyMatches('short', 'short')).toBe(false);
  });
});
