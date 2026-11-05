import type { CameraStatus, Prisma } from '@prisma/client';
import { BadRequestError, NotFoundError } from '../errors';
import { logger } from '../logger';
import { CameraRepository, type CameraRow } from '../repositories/camera.repository';
import { jpegDimensions } from '../utils/jpeg';
import { LIVE_TOKEN_TTL_S, signLiveToken } from '../utils/liveToken';
import type { HeartbeatInput } from '../validators/camera.validator';
import type { CameraState } from './camera.state';
import { sharedCameraState, type CameraLive } from './camera.state';

/** No heartbeat for this long: the camera (or the whole monitoring PC) is offline. */
export const HEARTBEAT_STALE_MS = 3 * 60_000;
export const SNAPSHOT_MAX_BYTES = 100 * 1024;
export const SNAPSHOT_MAX_WIDTH = 640;
/** Memory holds the newest picture; the database gets one this often at most. */
export const DB_REFRESH_MS = 30 * 60_000;
/** The address the CCTV PC reports for live video: only its own Tailscale name. */
const LIVE_URL = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net$/;

export type LiveQuality = 'sd' | 'hd';
export type LiveAccess =
  | { available: true; token: string; whepUrl: string; hlsUrl: string; expiresAt: string }
  | { available: false; reason: 'monitoring-offline' | 'camera-offline' | 'not-enabled' };

export interface CameraDto {
  id: string;
  channel: number | null;
  name: string;
  zone: string | null;
  enabled: boolean;
  status: CameraStatus;
  statusDetail: string | null;
  statusSince: string | null;
  lastHeartbeatAt: string | null;
  lastFrameAt: string | null;
  achievedFps: number | null;
  inferMs: number | null;
  hasSnapshot: boolean;
  snapshotAt: string | null;
  lastDetection: {
    incidentId: number;
    incidentNumber: string;
    type: string;
    occurredAt: string;
  } | null;
  /** Perception services currently reporting this camera */
  sources: string[];
  /** More than one service is watching it (e.g. the factory PC and a test laptop) */
  duplicate: boolean;
}

export interface MonitoringDto {
  /** online: the factory PC reports; offline: it stopped; never: it has not reported yet */
  state: 'online' | 'offline' | 'never';
  since: string | null;
  /** e.g. "DVR address changed to 192.168.0.110" */
  notice: string | null;
  /** Live video is switched on at the CCTV PC */
  liveEnabled: boolean;
  instances: Array<{
    id: string;
    source: 'LIVE' | 'DEV';
    online: boolean;
    lastHeartbeatAt: string;
  }>;
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/** OFFLINE when the last heartbeat is older than 3 minutes, else what was reported. */
export function effectiveStatus(
  row: Pick<CameraRow, 'status' | 'statusSince' | 'lastHeartbeatAt'>,
  now: Date,
): { status: CameraStatus; since: Date | null } {
  const last = row.lastHeartbeatAt;
  if (!last || now.getTime() - last.getTime() > HEARTBEAT_STALE_MS) {
    return { status: 'OFFLINE', since: last ?? row.statusSince ?? null };
  }
  return { status: row.status, since: row.statusSince };
}

/** The first text value of an info field across monitoring PCs. */
function infoText(instances: Array<{ info: unknown }>, key: string): string | null {
  for (const { info } of instances) {
    const value = (info as Record<string, unknown> | null)?.[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return null;
}

export class CameraService {
  constructor(
    private readonly repo = new CameraRepository(),
    private readonly state: CameraState = sharedCameraState,
  ) {}

  /** After a restart: what the database last knew, read once. */
  private async hydrate(): Promise<void> {
    if (this.state.hydrated) return;
    const [rows, instances] = await Promise.all([this.repo.findAll(), this.repo.findInstances()]);
    for (const { id, snapshotAt, ...row } of rows) {
      if (!this.state.cameras.has(id)) this.state.cameras.set(id, { ...row, unsaved: false });
      if (snapshotAt && !this.state.snapshots.has(id)) {
        this.state.snapshots.set(id, { data: null, at: snapshotAt, savedAt: snapshotAt });
      }
    }
    for (const i of instances) {
      if (this.state.instances.has(i.id)) continue;
      this.state.instances.set(i.id, {
        source: i.source,
        cameraIds: i.cameraIds,
        info: (i.info as Record<string, unknown> | null) ?? null,
        lastHeartbeatAt: i.lastHeartbeatAt,
        savedAt: i.lastHeartbeatAt,
      });
    }
    this.state.hydrated = true;
  }

  async heartbeat(input: HeartbeatInput, now: Date = new Date()): Promise<{ cameras: number }> {
    const ids = input.cameras.map((c) => c.id);
    if (new Set(ids).size !== ids.length) throw new BadRequestError('Camera ids must be unique');

    await this.hydrate();
    const liveElsewhere = new Set(
      [...this.state.instances]
        .filter(
          ([id, i]) =>
            id !== input.instanceId &&
            i.source === 'LIVE' &&
            now.getTime() - i.lastHeartbeatAt.getTime() <= HEARTBEAT_STALE_MS,
        )
        .flatMap(([, i]) => i.cameraIds),
    );

    for (const cam of input.cameras) {
      const previous = this.state.cameras.get(cam.id);
      const details = {
        channel: cam.channel ?? null,
        name: cam.name,
        zone: cam.zone ?? null,
        enabled: cam.enabled,
      };
      // A test laptop must not overwrite what the factory PC reports
      if (input.source === 'DEV' && liveElsewhere.has(cam.id)) {
        if (!previous) {
          await this.repo.ensure({
            id: cam.id,
            name: cam.name,
            zone: details.zone,
            channel: details.channel,
          });
        }
        continue;
      }
      const statusChanged = previous?.status !== cam.status;
      const live: CameraLive = {
        ...details,
        status: cam.status,
        statusDetail: cam.statusDetail ?? null,
        statusSince: statusChanged ? now : (previous.statusSince ?? now),
        lastHeartbeatAt: now,
        lastFrameAt: cam.lastFrameAt ?? null,
        achievedFps: cam.achievedFps ?? null,
        inferMs: cam.inferMs ?? null,
        unsaved: false,
      };
      const detailsChanged =
        !previous ||
        previous.statusDetail !== live.statusDetail ||
        (Object.keys(details) as Array<keyof typeof details>).some(
          (k) => previous[k] !== details[k],
        );
      this.state.cameras.set(cam.id, live);
      if (statusChanged || detailsChanged || previous.unsaved) {
        try {
          await this.repo.upsertFromHeartbeat(
            { id: cam.id, ...live },
            now,
            live.statusSince ?? now,
          );
        } catch (err) {
          // The website keeps working from memory; the next heartbeat tries again
          live.unsaved = true;
          logger.warn('Camera status not saved', {
            camera: cam.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      if (previous && statusChanged) {
        logger.info('Camera status changed', {
          camera: cam.id,
          from: previous.status,
          to: cam.status,
        });
      }
    }
    await this.recordInstance(input, ids, now);
    return { cameras: ids.length };
  }

  private async recordInstance(
    input: HeartbeatInput,
    cameraIds: string[],
    now: Date,
  ): Promise<void> {
    const previous = this.state.instances.get(input.instanceId);
    const info = input.info ?? previous?.info ?? null;
    const changed =
      !previous ||
      previous.source !== input.source ||
      previous.cameraIds.join() !== cameraIds.join() ||
      previous.info?.['dvrNotice'] !== info?.['dvrNotice'] ||
      previous.info?.['liveUrl'] !== info?.['liveUrl'];
    const stale = !previous?.savedAt || now.getTime() - previous.savedAt.getTime() >= DB_REFRESH_MS;
    let savedAt = previous?.savedAt ?? null;
    if (changed || stale) {
      try {
        await this.repo.saveInstance(
          input.instanceId,
          input.source,
          cameraIds,
          input.info as Prisma.InputJsonValue | undefined,
          now,
        );
        savedAt = now;
      } catch (err) {
        savedAt = null;
        logger.warn('Monitoring PC status not saved', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    this.state.instances.set(input.instanceId, {
      source: input.source,
      cameraIds,
      info,
      lastHeartbeatAt: now,
      savedAt,
    });
  }

  /** A 2-minute pass for one camera's live video, or the reason there is none. */
  liveAccess(id: string, quality: LiveQuality, userId: number, now: Date = new Date()): LiveAccess {
    const reporting = [...this.state.instances.values()].filter(
      (i) =>
        i.source === 'LIVE' &&
        i.cameraIds.includes(id) &&
        now.getTime() - i.lastHeartbeatAt.getTime() <= HEARTBEAT_STALE_MS,
    );
    if (reporting.length === 0) return { available: false, reason: 'monitoring-offline' };
    if (this.state.cameras.get(id)?.status !== 'ONLINE') {
      return { available: false, reason: 'camera-offline' };
    }
    const base = reporting
      .map((i) => i.info?.['liveUrl'])
      .find((u): u is string => typeof u === 'string' && LIVE_URL.test(u));
    if (!base) return { available: false, reason: 'not-enabled' };

    const path = `${id}-${quality}`;
    return {
      available: true,
      token: signLiveToken(path, userId),
      whepUrl: `${base}/${path}/whep`,
      hlsUrl: `${base}:8443/${path}/index.m3u8`,
      expiresAt: new Date(now.getTime() + LIVE_TOKEN_TTL_S * 1000).toISOString(),
    };
  }

  /** Checks a snapshot upload: a real JPEG, at most 640 px wide and 100 KB. */
  validateSnapshot(data: unknown): Buffer {
    if (!Buffer.isBuffer(data) || data.length === 0) {
      throw new BadRequestError('Send the picture as image/jpeg');
    }
    if (data.length > SNAPSHOT_MAX_BYTES)
      throw new BadRequestError('Picture is larger than 100 KB');
    const size = jpegDimensions(data);
    if (!size) throw new BadRequestError('Not a JPEG picture');
    if (size.width > SNAPSHOT_MAX_WIDTH) throw new BadRequestError('Picture is wider than 640 px');
    return data;
  }

  async saveSnapshot(id: string, data: unknown, now: Date = new Date()): Promise<void> {
    const jpeg = this.validateSnapshot(data);
    const previous = this.state.snapshots.get(id);
    const due = !previous?.savedAt || now.getTime() - previous.savedAt.getTime() >= DB_REFRESH_MS;
    let savedAt = previous?.savedAt ?? null;
    if (due) {
      try {
        const saved = await this.repo.saveSnapshot(id, jpeg, now);
        if (!saved && !this.state.cameras.has(id)) {
          throw new NotFoundError('Camera not found; send a heartbeat first');
        }
        savedAt = now;
      } catch (err) {
        if (err instanceof NotFoundError) throw err;
        logger.warn('Camera picture not saved', {
          camera: id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else if (!this.state.cameras.has(id)) {
      throw new NotFoundError('Camera not found; send a heartbeat first');
    }
    this.state.snapshots.set(id, { data: jpeg, at: now, savedAt });
  }

  async getSnapshot(id: string): Promise<{ data: Buffer; at: Date | null }> {
    const memory = this.state.snapshots.get(id);
    if (memory?.data) return { data: memory.data, at: memory.at };
    const row = await this.repo.findSnapshot(id);
    if (!row?.lastSnapshot) throw new NotFoundError('No picture from this camera yet');
    return { data: row.lastSnapshot, at: row.snapshotAt };
  }

  async list(now: Date = new Date()): Promise<{ cameras: CameraDto[]; monitoring: MonitoringDto }> {
    const [saved, savedInstances] = await Promise.all([
      this.repo.findAll(),
      this.repo.findInstances(),
    ]);
    // Memory is newer than the database wherever both know a camera
    const rows = saved.map((row) => {
      const live = this.state.cameras.get(row.id);
      const picture = this.state.snapshots.get(row.id);
      return { ...row, ...live, snapshotAt: picture?.at ?? row.snapshotAt };
    });
    const instances = savedInstances.map((row) => {
      const live = this.state.instances.get(row.id);
      return live ? { ...row, ...live } : row;
    });
    const detections = new Map(
      (await this.repo.lastDetections(rows.map((r) => r.id))).map((d) => [d.cameraId, d]),
    );
    const fresh = instances.filter(
      (i) => now.getTime() - i.lastHeartbeatAt.getTime() <= HEARTBEAT_STALE_MS,
    );

    const cameras = rows.map((row): CameraDto => {
      const { status, since } = effectiveStatus(row, now);
      const sources = fresh.filter((i) => i.cameraIds.includes(row.id)).map((i) => i.id);
      const d = detections.get(row.id);
      return {
        id: row.id,
        channel: row.channel,
        name: row.name,
        zone: row.zone,
        enabled: row.enabled,
        status,
        statusDetail: status === row.status ? row.statusDetail : null,
        statusSince: iso(since),
        lastHeartbeatAt: iso(row.lastHeartbeatAt),
        lastFrameAt: iso(row.lastFrameAt),
        achievedFps: row.achievedFps,
        inferMs: row.inferMs,
        hasSnapshot: row.snapshotAt !== null,
        snapshotAt: iso(row.snapshotAt),
        lastDetection: d
          ? {
              incidentId: d.id,
              incidentNumber: d.incidentNumber,
              type: d.type,
              occurredAt: d.occurredAt.toISOString(),
            }
          : null,
        sources,
        duplicate: sources.length > 1,
      };
    });

    const live = instances.filter((i) => i.source === 'LIVE');
    const liveOnline = live.some((i) => fresh.includes(i));
    const lastLive = live.reduce<Date | null>(
      (max, i) => (!max || i.lastHeartbeatAt > max ? i.lastHeartbeatAt : max),
      null,
    );
    return {
      cameras,
      monitoring: {
        state: liveOnline ? 'online' : live.length > 0 ? 'offline' : 'never',
        since: liveOnline ? null : iso(lastLive),
        notice: infoText(live, 'dvrNotice'),
        liveEnabled:
          liveOnline &&
          infoText(
            live.filter((i) => fresh.includes(i)),
            'liveUrl',
          ) !== null,
        instances: instances.map((i) => ({
          id: i.id,
          source: i.source,
          online: fresh.includes(i),
          lastHeartbeatAt: i.lastHeartbeatAt.toISOString(),
        })),
      },
    };
  }
}
