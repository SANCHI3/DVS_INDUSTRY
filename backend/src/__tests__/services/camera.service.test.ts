/**
 * Factory CCTV status: heartbeats from the perception PC, offline after 3
 * minutes of silence, one "PC offline" notice, and snapshot checks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/prismaClient', () => ({ prisma: {} }));

import { CameraService, effectiveStatus } from '../../services/camera.service';
import { cameraNotifications } from '../../services/notifications.service';
import { jpegDimensions } from '../../utils/jpeg';
import { fakeJpeg } from '../helpers/jpeg';
import type { CameraRepository } from '../../repositories/camera.repository';

const NOW = new Date('2026-11-04T09:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

function makeRepo(state: {
  cameras?: Array<Record<string, unknown>>;
  instances?: Array<{
    id: string;
    source: 'LIVE' | 'DEV';
    lastHeartbeatAt: Date;
    cameraIds: string[];
  }>;
}) {
  const repo = {
    findAll: vi.fn().mockResolvedValue(state.cameras ?? []),
    findStatus: vi
      .fn()
      .mockResolvedValue((state.cameras ?? []).map((c) => ({ id: c['id'], status: c['status'] }))),
    findInstances: vi.fn().mockResolvedValue(state.instances ?? []),
    upsertFromHeartbeat: vi.fn().mockResolvedValue(undefined),
    ensure: vi.fn().mockResolvedValue(undefined),
    saveInstance: vi.fn().mockResolvedValue(undefined),
    saveSnapshot: vi.fn().mockResolvedValue(true),
    findSnapshot: vi.fn(),
    lastDetections: vi.fn().mockResolvedValue([]),
  };
  return repo as unknown as CameraRepository & typeof repo;
}

const camRow = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  channel: Number(id.slice(-1)),
  name: `Camera 0${id.slice(-1)}`,
  zone: null,
  enabled: true,
  status: 'ONLINE',
  statusDetail: null,
  statusSince: ago(3_600_000),
  lastHeartbeatAt: ago(20_000),
  lastFrameAt: ago(21_000),
  achievedFps: 2.9,
  inferMs: 80,
  snapshotAt: null,
  ...over,
});

const beat = (over: Record<string, unknown> = {}) => ({
  instanceId: 'factory-pc',
  source: 'LIVE' as const,
  cameras: [
    { id: 'dvr-ch1', channel: 1, name: 'Camera 01', enabled: true, status: 'ONLINE' as const },
    { id: 'dvr-ch2', channel: 2, name: 'Camera 02', enabled: true, status: 'VIDEO_LOSS' as const },
  ],
  ...over,
});

describe('jpegDimensions', () => {
  it('reads the size from the frame header', () => {
    expect(jpegDimensions(fakeJpeg(640, 360))).toEqual({ width: 640, height: 360 });
  });

  it('rejects data that only claims to be a JPEG', () => {
    expect(jpegDimensions(Buffer.from('not a picture'))).toBeNull();
    expect(jpegDimensions(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull();
  });
});

describe('heartbeat', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stores every camera and the instance, marking status changes', async () => {
    const repo = makeRepo({ cameras: [camRow('dvr-ch1'), camRow('dvr-ch2')] });
    await new CameraService(repo).heartbeat(beat(), NOW);
    expect(repo.upsertFromHeartbeat).toHaveBeenCalledTimes(2);
    expect(repo.upsertFromHeartbeat.mock.calls[0]![2]).toBe(false); // ch1 still ONLINE
    expect(repo.upsertFromHeartbeat.mock.calls[1]![2]).toBe(true); // ch2 ONLINE -> VIDEO_LOSS
    expect(repo.saveInstance).toHaveBeenCalledWith(
      'factory-pc',
      'LIVE',
      ['dvr-ch1', 'dvr-ch2'],
      undefined,
      NOW,
    );
  });

  it('does not let a test laptop overwrite what the factory PC reports', async () => {
    const repo = makeRepo({
      instances: [
        { id: 'factory-pc', source: 'LIVE', lastHeartbeatAt: ago(10_000), cameraIds: ['dvr-ch1'] },
      ],
    });
    await new CameraService(repo).heartbeat(beat({ instanceId: 'dev-laptop', source: 'DEV' }), NOW);
    expect(repo.ensure).toHaveBeenCalledWith(expect.objectContaining({ id: 'dvr-ch1' }));
    expect(repo.upsertFromHeartbeat).toHaveBeenCalledTimes(1); // only ch2, which the PC does not watch
    expect(repo.saveInstance).toHaveBeenCalledWith(
      'dev-laptop',
      'DEV',
      expect.any(Array),
      undefined,
      NOW,
    );
  });

  it('refuses repeated camera ids', async () => {
    const cams = [beat().cameras[0]!, beat().cameras[0]!];
    await expect(
      new CameraService(makeRepo({})).heartbeat(beat({ cameras: cams }), NOW),
    ).rejects.toThrow('unique');
  });
});

describe('status and monitoring', () => {
  it('shows a camera offline after 3 minutes without a heartbeat', () => {
    expect(effectiveStatus(camRow('dvr-ch1') as never, NOW).status).toBe('ONLINE');
    const stale = effectiveStatus(
      camRow('dvr-ch1', { lastHeartbeatAt: ago(200_000) }) as never,
      NOW,
    );
    expect(stale).toEqual({ status: 'OFFLINE', since: ago(200_000) });
  });

  it('reports the monitoring PC online, offline since, or never started', async () => {
    const online = await new CameraService(
      makeRepo({
        cameras: [camRow('dvr-ch1')],
        instances: [
          {
            id: 'factory-pc',
            source: 'LIVE',
            lastHeartbeatAt: ago(15_000),
            cameraIds: ['dvr-ch1'],
          },
        ],
      }),
    ).list(NOW);
    expect(online.monitoring.state).toBe('online');
    expect(online.cameras[0]).toMatchObject({
      status: 'ONLINE',
      sources: ['factory-pc'],
      duplicate: false,
    });

    const offline = await new CameraService(
      makeRepo({
        cameras: [camRow('dvr-ch1', { lastHeartbeatAt: ago(600_000) })],
        instances: [
          {
            id: 'factory-pc',
            source: 'LIVE',
            lastHeartbeatAt: ago(600_000),
            cameraIds: ['dvr-ch1'],
          },
        ],
      }),
    ).list(NOW);
    expect(offline.monitoring).toMatchObject({
      state: 'offline',
      since: ago(600_000).toISOString(),
    });
    expect(offline.cameras[0]!.status).toBe('OFFLINE');

    expect((await new CameraService(makeRepo({})).list(NOW)).monitoring.state).toBe('never');
  });

  it('flags a camera watched by two services at once', async () => {
    const list = await new CameraService(
      makeRepo({
        cameras: [camRow('dvr-ch1')],
        instances: [
          {
            id: 'factory-pc',
            source: 'LIVE',
            lastHeartbeatAt: ago(15_000),
            cameraIds: ['dvr-ch1'],
          },
          { id: 'dev-laptop', source: 'DEV', lastHeartbeatAt: ago(5_000), cameraIds: ['dvr-ch1'] },
        ],
      }),
    ).list(NOW);
    expect(list.cameras[0]).toMatchObject({
      duplicate: true,
      sources: ['factory-pc', 'dev-laptop'],
    });
  });
});

describe('camera notifications', () => {
  it('gives one notice when the whole monitoring PC is silent', async () => {
    const svc = new CameraService(
      makeRepo({
        cameras: [1, 2, 3].map((n) => camRow(`dvr-ch${n}`, { lastHeartbeatAt: ago(900_000) })),
        instances: [
          { id: 'factory-pc', source: 'LIVE', lastHeartbeatAt: ago(900_000), cameraIds: [] },
        ],
      }),
    );
    const items = await cameraNotifications(NOW, svc);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'camera', message: 'CCTV monitoring PC is offline' });
  });

  it('lists cameras with no picture, never as incidents', async () => {
    const svc = new CameraService(
      makeRepo({
        cameras: [camRow('dvr-ch1'), camRow('dvr-ch2', { status: 'VIDEO_LOSS', zone: 'Gate' })],
        instances: [
          { id: 'factory-pc', source: 'LIVE', lastHeartbeatAt: ago(15_000), cameraIds: [] },
        ],
      }),
    );
    const items = await cameraNotifications(NOW, svc);
    expect(items).toEqual([
      expect.objectContaining({ kind: 'camera', message: 'Camera 02 (Gate) shows no picture' }),
    ]);
  });
});

describe('snapshots', () => {
  const svc = new CameraService(makeRepo({}));

  it('accepts a small JPEG up to 640 px wide', () => {
    expect(() => svc.validateSnapshot(fakeJpeg(640, 480, 5_000))).not.toThrow();
  });

  it.each([
    [Buffer.from('GIF89a'), 'Not a JPEG'],
    [fakeJpeg(1280, 720), 'wider than 640'],
    [fakeJpeg(640, 480, 101 * 1024), 'larger than 100 KB'],
    [{}, 'image/jpeg'],
  ])('rejects %#', (data, message) => {
    expect(() => svc.validateSnapshot(data)).toThrow(message);
  });
});
