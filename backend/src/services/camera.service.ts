import type { CameraStatus, Prisma } from '@prisma/client';
import { BadRequestError, NotFoundError } from '../errors';
import { logger } from '../logger';
import { CameraRepository, type CameraRow } from '../repositories/camera.repository';
import { jpegDimensions } from '../utils/jpeg';
import type { HeartbeatInput } from '../validators/camera.validator';

/** No heartbeat for this long: the camera (or the whole monitoring PC) is offline. */
export const HEARTBEAT_STALE_MS = 3 * 60_000;
export const SNAPSHOT_MAX_BYTES = 100 * 1024;
export const SNAPSHOT_MAX_WIDTH = 640;

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

export class CameraService {
  constructor(private readonly repo = new CameraRepository()) {}

  async heartbeat(input: HeartbeatInput, now: Date = new Date()): Promise<{ cameras: number }> {
    const ids = input.cameras.map((c) => c.id);
    if (new Set(ids).size !== ids.length) throw new BadRequestError('Camera ids must be unique');

    const instances = await this.repo.findInstances();
    const liveElsewhere = new Set(
      instances
        .filter(
          (i) =>
            i.id !== input.instanceId &&
            i.source === 'LIVE' &&
            now.getTime() - i.lastHeartbeatAt.getTime() <= HEARTBEAT_STALE_MS,
        )
        .flatMap((i) => i.cameraIds),
    );
    const previous = new Map((await this.repo.findStatus(ids)).map((c) => [c.id, c.status]));

    for (const cam of input.cameras) {
      // A test laptop must not overwrite what the factory PC reports
      if (input.source === 'DEV' && liveElsewhere.has(cam.id)) {
        await this.repo.ensure({
          id: cam.id,
          name: cam.name,
          zone: cam.zone ?? null,
          channel: cam.channel ?? null,
        });
        continue;
      }
      await this.repo.upsertFromHeartbeat(
        {
          id: cam.id,
          channel: cam.channel ?? null,
          name: cam.name,
          zone: cam.zone ?? null,
          enabled: cam.enabled,
          status: cam.status,
          statusDetail: cam.statusDetail ?? null,
          lastFrameAt: cam.lastFrameAt ?? null,
          achievedFps: cam.achievedFps ?? null,
          inferMs: cam.inferMs ?? null,
        },
        now,
        previous.get(cam.id) !== cam.status,
      );
      if (previous.has(cam.id) && previous.get(cam.id) !== cam.status) {
        logger.info('Camera status changed', {
          camera: cam.id,
          from: previous.get(cam.id),
          to: cam.status,
        });
      }
    }
    await this.repo.saveInstance(
      input.instanceId,
      input.source,
      ids,
      input.info as Prisma.InputJsonValue | undefined,
      now,
    );
    return { cameras: ids.length };
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
    const saved = await this.repo.saveSnapshot(id, jpeg, now);
    if (!saved) throw new NotFoundError('Camera not found; send a heartbeat first');
  }

  async getSnapshot(id: string): Promise<{ data: Buffer; at: Date | null }> {
    const row = await this.repo.findSnapshot(id);
    if (!row?.lastSnapshot) throw new NotFoundError('No picture from this camera yet');
    return { data: row.lastSnapshot, at: row.snapshotAt };
  }

  async list(now: Date = new Date()): Promise<{ cameras: CameraDto[]; monitoring: MonitoringDto }> {
    const [rows, instances] = await Promise.all([this.repo.findAll(), this.repo.findInstances()]);
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
