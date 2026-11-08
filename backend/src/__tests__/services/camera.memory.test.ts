/**
 * Heartbeats and pictures stay in memory so Neon can sleep; live-view passes.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/prismaClient', () => ({ prisma: {} }));

import { CameraService, DB_REFRESH_MS } from '../../services/camera.service';
import { CameraState } from '../../services/camera.state';
import { withWebsiteName } from '../../services/security.service';
import { decideStreamAuth, liveTokenPath, signLiveToken } from '../../utils/liveToken';
import { StreamAuthLog } from '../../utils/streamAuthLog';
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

describe('after the API restarts', () => {
  const saved = (minutesAgo: number) => ({
    id: 'dvr-ch1',
    channel: 1,
    name: 'Camera 01',
    zone: null,
    displayName: 'Store aisle',
    displayZone: 'Warehouse',
    enabled: true,
    status: 'ONLINE',
    statusDetail: null,
    statusSince: new Date(NOW.getTime() - 86_400_000),
    lastHeartbeatAt: new Date(NOW.getTime() - minutesAgo * 60_000),
    lastFrameAt: null,
    achievedFps: 1,
    inferMs: 80,
    snapshotAt: new Date(NOW.getTime() - minutesAgo * 60_000),
  });
  const instance = (minutesAgo: number) => ({
    id: 'plant-pc',
    source: 'LIVE',
    cameraIds: ['dvr-ch1'],
    info: null,
    lastHeartbeatAt: new Date(NOW.getTime() - minutesAgo * 60_000),
  });
  const restarted = (minutesAgo: number, bootedMsAgo: number) => {
    const { repo } = setup();
    repo.findAll.mockResolvedValue([saved(minutesAgo)]);
    repo.findInstances.mockResolvedValue([instance(minutesAgo)]);
    const state = new CameraState(new Date(NOW.getTime() - bootedMsAgo));
    return { repo, service: new CameraService(repo as unknown as CameraRepository, state) };
  };

  it('shows the saved cameras, names and picture instead of 0 of 8', async () => {
    const { service } = restarted(25, 20_000);
    const { cameras, monitoring } = await service.list(NOW);
    expect(cameras[0]).toMatchObject({
      status: 'ONLINE',
      name: 'Store aisle',
      zone: 'Warehouse',
      hasSnapshot: true,
    });
    expect(monitoring.state).toBe('online');
  });

  it('stops trusting the saved status once a heartbeat should have come', async () => {
    const { service } = restarted(25, 4 * 60_000);
    const { cameras, monitoring } = await service.list(NOW);
    expect(cameras[0]?.status).toBe('OFFLINE');
    expect(monitoring.state).toBe('offline');
  });

  it('is online again from the next heartbeat', async () => {
    const { service } = restarted(25, 4 * 60_000);
    await service.heartbeat(beat(), NOW);
    expect((await service.list(NOW)).cameras[0]?.status).toBe('ONLINE');
  });

  it('keeps website names out of memory, so a rename is seen at once', async () => {
    const { repo, service } = restarted(25, 20_000);
    await service.heartbeat(beat(), NOW);
    repo.findAll.mockResolvedValue([{ ...saved(0), displayName: 'Front gate' }]);
    expect((await service.list(NOW)).cameras[0]?.name).toBe('Front gate');
  });
});

describe('website camera names', () => {
  it('heartbeats never write them', async () => {
    const { repo, service } = setup();
    await service.heartbeat(beat(), NOW);
    const sent = repo.upsertFromHeartbeat.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent).not.toHaveProperty('displayName');
    expect(sent).not.toHaveProperty('displayZone');
  });

  it('saves the name and puts it on the incidents and alerts', async () => {
    const rename = vi.fn().mockResolvedValue(undefined);
    const findNames = vi
      .fn()
      .mockResolvedValue({ name: 'Camera 01', zone: null, displayName: null, displayZone: null });
    const service = new CameraService(
      { rename, findNames } as unknown as CameraRepository,
      new CameraState(),
    );
    await service.rename('dvr-ch1', { name: 'Store aisle', zone: 'Warehouse' });
    expect(rename).toHaveBeenCalledWith(
      'dvr-ch1',
      { displayName: 'Store aisle', displayZone: 'Warehouse' },
      'Store aisle, Warehouse',
    );
  });

  it('goes back to the plant name when emptied, and leaves the other field alone', async () => {
    const rename = vi.fn().mockResolvedValue(undefined);
    const findNames = vi.fn().mockResolvedValue({
      name: 'Camera 01',
      zone: null,
      displayName: 'Old',
      displayZone: 'Warehouse',
    });
    const service = new CameraService(
      { rename, findNames } as unknown as CameraRepository,
      new CameraState(),
    );
    await service.rename('dvr-ch1', { name: '' });
    expect(rename).toHaveBeenCalledWith(
      'dvr-ch1',
      { displayName: null, displayZone: 'Warehouse' },
      'Camera 01, Warehouse',
    );
  });

  it('refuses a camera that does not exist', async () => {
    const service = new CameraService(
      { findNames: vi.fn().mockResolvedValue(null) } as unknown as CameraRepository,
      new CameraState(),
    );
    await expect(service.rename('dvr-ch9', { name: 'x' })).rejects.toThrow('Camera not found');
  });

  it('a new incident uses the website name, in its text too', () => {
    const named = withWebsiteName(
      { location: 'Camera 01', description: 'A fall in Camera 01', aiSummary: 'At Camera 01.' },
      { name: 'Camera 01', zone: null, displayName: 'Store aisle', displayZone: null },
    );
    expect(named).toEqual({
      location: 'Store aisle',
      description: 'A fall in Store aisle',
      aiSummary: 'At Store aisle.',
    });
  });

  it('an incident on an unnamed camera is left exactly as it came', () => {
    const data = { location: 'Camera 01', description: 'x' };
    const names = { name: 'Camera 01', zone: null, displayName: null, displayZone: null };
    expect(withWebsiteName(data, names)).toBe(data);
    expect(withWebsiteName(data, undefined)).toBe(data);
  });
});

describe('database writes stay rare', () => {
  it('a camera that keeps flipping is written at most once a minute', async () => {
    const { repo, service } = setup();
    await service.heartbeat(beat('ONLINE'), NOW);
    await service.heartbeat(beat('OFFLINE'), later(30_000));
    expect(repo.upsertFromHeartbeat).toHaveBeenCalledTimes(1);
    await service.heartbeat(beat('OFFLINE'), later(60_000));
    expect(repo.upsertFromHeartbeat).toHaveBeenCalledTimes(2);
    expect(repo.upsertFromHeartbeat.mock.calls[1]?.[0]).toMatchObject({ status: 'OFFLINE' });
  });

  it('saves the last seen time every 30 minutes, for after a restart', async () => {
    const { repo, service } = setup();
    await service.heartbeat(beat(), NOW);
    for (let t = 30_000; t <= DB_REFRESH_MS; t += 30_000) {
      await service.heartbeat(beat(), later(t));
    }
    expect(repo.upsertFromHeartbeat).toHaveBeenCalledTimes(2);
    expect(repo.saveInstance).toHaveBeenCalledTimes(2);
  });
});

describe('plant computer offline', () => {
  const silentFor = async (ms: number) => {
    const { service } = setup();
    const { repo } = {
      repo: (service as unknown as { repo: ReturnType<typeof setup>['repo'] }).repo,
    };
    repo.findInstances.mockResolvedValue([
      {
        id: 'plant-pc',
        source: 'LIVE',
        cameraIds: [],
        info: null,
        lastHeartbeatAt: new Date(NOW.getTime() - ms),
      },
    ]);
    return (await service.list(NOW)).monitoring;
  };

  it('raises the alert after 10 minutes and always says when it was last seen', async () => {
    expect(await silentFor(5 * 60_000)).toMatchObject({ state: 'offline', offlineAlert: false });
    const monitoring = await silentFor(10 * 60_000);
    expect(monitoring.offlineAlert).toBe(true);
    expect(monitoring.lastSeenAt).toBe(new Date(NOW.getTime() - 10 * 60_000).toISOString());
  });

  it('reports the version the plant sends, and works without one', async () => {
    const { service, repo } = setup();
    await service.heartbeat(beat('ONLINE', { version: 'cctv-setup-7' }), NOW);
    repo.findInstances.mockResolvedValue([
      {
        id: 'factory-pc',
        source: 'LIVE',
        cameraIds: ['dvr-ch1'],
        info: null,
        lastHeartbeatAt: NOW,
      },
    ]);
    expect((await service.list(NOW)).monitoring.version).toBe('cctv-setup-7');
    expect((await silentFor(0)).version).toBeNull();
  });

  it('shows the update fields when the plant sends them, and works without them', async () => {
    const { service, repo } = setup();
    repo.findInstances.mockResolvedValue([
      {
        id: 'factory-pc',
        source: 'LIVE',
        cameraIds: ['dvr-ch1'],
        info: null,
        lastHeartbeatAt: NOW,
      },
    ]);
    await service.heartbeat(beat('ONLINE', { version: 'cctv-setup-7' }), NOW);
    expect((await service.list(NOW)).monitoring).toMatchObject({
      lastUpdateCheck: null,
      updateWaiting: null,
      updatesOff: false,
    });

    await service.heartbeat(
      beat('ONLINE', {
        version: 'cctv-setup-9',
        lastUpdateCheck: '2026-11-07T08:30:00+00:00',
        updateWaiting: 'cctv-setup-10',
      }),
      later(30_000),
    );
    expect((await service.list(later(30_000))).monitoring).toMatchObject({
      lastUpdateCheck: '2026-11-07T08:30:00+00:00',
      updateWaiting: 'cctv-setup-10',
      updatesOff: false,
    });

    await service.heartbeat(beat('ONLINE', { autoUpdate: 'off' }), later(60_000));
    expect((await service.list(later(60_000))).monitoring.updatesOff).toBe(true);
  });

  it('saves a waiting update straight away, so a restart still shows it', async () => {
    const { service, repo } = setup();
    await service.heartbeat(beat('ONLINE', { version: 'cctv-setup-9' }), NOW);
    repo.saveInstance.mockClear();
    await service.heartbeat(
      beat('ONLINE', { version: 'cctv-setup-9', updateWaiting: 'cctv-setup-10' }),
      later(30_000),
    );
    expect(repo.saveInstance).toHaveBeenCalledTimes(1);
  });
});

describe('live view check', () => {
  // What cctv-setup-5 sends when its process started before LIVE_VIEW_URL was set
  const setup5 = (info: Record<string, string> = { device: 'cpu' }) => ({
    instanceId: 'plant-pc',
    source: 'LIVE' as const,
    info,
    cameras: [
      { id: 'dvr-ch2', channel: 2, name: 'Camera 02', enabled: true, status: 'OFFLINE' as const },
      { id: 'dvr-ch1', channel: 1, name: 'Camera 01', enabled: true, status: 'ONLINE' as const },
    ],
  });

  it('shows a plant with no live address and no version, as cctv-setup-5 is', async () => {
    const { service } = setup();
    await service.heartbeat(setup5(), NOW);
    const check = await service.liveCheck(later(10_000));
    expect(check.plants).toEqual([
      expect.objectContaining({
        id: 'plant-pc',
        online: true,
        version: null,
        liveUrl: null,
        liveUrlAccepted: false,
        startedAt: null,
        infoFields: ['device'],
      }),
    ]);
    expect(check.cameras.map((c) => [c.id, c.live])).toEqual([
      ['dvr-ch1', 'not-enabled'],
      ['dvr-ch2', 'camera-offline'],
    ]);
  });

  it('says a camera is available once the live address arrives', async () => {
    const { service } = setup();
    await service.heartbeat(setup5({ liveUrl: 'https://server.taild7bde2.ts.net' }), NOW);
    const check = await service.liveCheck(later(10_000));
    expect(check.plants[0]).toMatchObject({
      liveUrl: 'https://server.taild7bde2.ts.net',
      liveUrlAccepted: true,
    });
    expect(check.cameras[0]).toMatchObject({ id: 'dvr-ch1', live: 'available' });
  });

  it('shows an address the website will not hand out', async () => {
    const { service } = setup();
    await service.heartbeat(setup5({ liveUrl: 'http://192.168.0.108:8889' }), NOW);
    const check = await service.liveCheck(later(10_000));
    expect(check.plants[0]).toMatchObject({ liveUrlAccepted: false });
    expect(check.cameras[0]?.live).toBe('not-enabled');
  });

  it('notices heartbeats coming back after a restart', async () => {
    const { service } = setup();
    await service.heartbeat(setup5(), NOW);
    await service.heartbeat(setup5(), later(30_000));
    expect((await service.liveCheck(later(31_000))).plants[0]?.resumedAt).toBeNull();
    await service.heartbeat(setup5(), later(5 * 60_000));
    expect((await service.liveCheck(later(5 * 60_000))).plants[0]?.resumedAt).toBe(
      later(5 * 60_000).toISOString(),
    );
  });

  it('does not take a website restart for a plant restart', async () => {
    const { service, repo } = setup();
    repo.findInstances.mockResolvedValue([
      {
        id: 'plant-pc',
        source: 'LIVE',
        cameraIds: ['dvr-ch1', 'dvr-ch2'],
        info: { device: 'cpu' },
        lastHeartbeatAt: later(-20 * 60_000),
      },
    ]);
    const before = await service.liveCheck(NOW);
    expect(before.plants[0]).toMatchObject({ fromDatabase: true, online: false });
    await service.heartbeat(setup5(), NOW);
    expect((await service.liveCheck(NOW)).plants[0]).toMatchObject({
      fromDatabase: false,
      resumedAt: null,
    });
  });

  it('reports a version and start time when newer plant software sends them', async () => {
    const { service } = setup();
    await service.heartbeat(
      setup5({ version: 'cctv-setup-10', startedAt: '2026-11-05T08:59:00Z' }),
      NOW,
    );
    expect((await service.liveCheck(NOW)).plants[0]).toMatchObject({
      version: 'cctv-setup-10',
      startedAt: '2026-11-05T08:59:00Z',
    });
  });
});

describe('stream-auth decisions', () => {
  const read = { action: 'read', path: 'dvr-ch1-sd', protocol: 'webrtc' };

  it('accepts the pass as a Bearer token (WHEP, hls.js) or in the address (Safari HLS)', () => {
    const token = signLiveToken('dvr-ch1-sd', 1);
    expect(decideStreamAuth({ ...read, token })).toEqual({ allowed: true, reason: 'allowed' });
    expect(decideStreamAuth({ ...read, protocol: 'hls', token })).toEqual({
      allowed: true,
      reason: 'allowed',
    });
    expect(decideStreamAuth({ ...read, protocol: 'hls', query: `token=${token}` })).toEqual({
      allowed: true,
      reason: 'allowed',
    });
  });

  it('says why a viewer is refused', () => {
    const token = signLiveToken('dvr-ch1-sd', 1);
    expect(decideStreamAuth(read).reason).toBe('no-pass');
    expect(decideStreamAuth({ ...read, token: 'forged' }).reason).toBe('invalid');
    expect(decideStreamAuth({ ...read, path: 'dvr-ch1-hd', token }).reason).toBe('wrong-path');
    expect(decideStreamAuth({ ...read, action: 'publish', token }).reason).toBe('not-viewing');
    expect(decideStreamAuth({ ...read, protocol: 'rtsp', token }).reason).toBe('not-viewing');
  });

  it('tells an expired pass from a forged one', () => {
    vi.useFakeTimers({ now: NOW });
    try {
      const token = signLiveToken('dvr-ch1-sd', 1);
      vi.setSystemTime(later(121_000));
      expect(decideStreamAuth({ ...read, token })).toEqual({ allowed: false, reason: 'expired' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the last calls, newest first, and no more than it should', () => {
    const log = new StreamAuthLog();
    for (let i = 0; i < 60; i++) {
      log.add(
        { path: `p${i}`, protocol: 'hls', action: 'read', allowed: false, reason: 'no-pass' },
        later(i * 1000),
      );
    }
    expect(log.latest(10).map((e) => e.path)).toEqual(
      Array.from({ length: 10 }, (_, i) => `p${59 - i}`),
    );
    expect(log.latest(100)).toHaveLength(50);
  });
});
