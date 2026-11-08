import type { CameraStatus, Prisma } from '@prisma/client';
import { BadRequestError, NotFoundError } from '../errors';
import { logger } from '../logger';
import { CameraRepository, type CameraRow } from '../repositories/camera.repository';
import { cameraLabel, displayedCamera } from '../utils/cameraLabel';
import { jpegDimensions } from '../utils/jpeg';
import { LIVE_TOKEN_TTL_S, signLiveToken } from '../utils/liveToken';
import type { CameraRenameInput, HeartbeatInput } from '../validators/camera.validator';
import type { CameraState } from './camera.state';
import { sharedCameraState, type CameraLive } from './camera.state';
import { streamAuthLog, type StreamAuthEntry } from '../utils/streamAuthLog';

/** No heartbeat for this long: the camera (or the whole monitoring PC) is offline. */
export const HEARTBEAT_STALE_MS = 3 * 60_000;
/** Silent this long: the red banner and the admin notification. */
export const OFFLINE_ALERT_MS = 10 * 60_000;
export const SNAPSHOT_MAX_BYTES = 100 * 1024;
export const SNAPSHOT_MAX_WIDTH = 640;
/**
 * Memory holds the newest heartbeat and picture; the database gets them this
 * often. Writing every minute would keep Neon awake all day and use up the free
 * compute hours, and the page only needs these after a restart.
 */
export const DB_REFRESH_MS = 30 * 60_000;
/** However often a camera's status flips, at most one database write a minute. */
export const MIN_DB_WRITE_MS = 60_000;
/** The address the CCTV PC reports for live video: only its own Tailscale name. */
const LIVE_URL = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net$/;

/** Silence this long, then heartbeats again: the plant software most likely restarted. */
export const RESTART_GAP_MS = 2 * 60_000;

export type LiveQuality = 'sd' | 'hd';
export type LiveRefusal = 'monitoring-offline' | 'camera-offline' | 'not-enabled';
export type LiveAccess =
  | { available: true; token: string; whepUrl: string; hlsUrl: string; expiresAt: string }
  | { available: false; reason: LiveRefusal };

/** Admin page: where live view stops, from what this process knows. */
export interface LiveCheckDto {
  checkedAt: string;
  /** This website server's start: memory, and the stream-auth log, begin here */
  websiteStartedAt: string;
  plants: Array<{
    id: string;
    source: 'LIVE' | 'DEV';
    online: boolean;
    lastHeartbeatAt: string;
    /** null: an older version that does not report one (cctv-setup-5) */
    version: string | null;
    liveUrl: string | null;
    /** The address has the form the website hands out (https://name.tailnet.ts.net) */
    liveUrlAccepted: boolean;
    /** Only if the plant software reports it */
    startedAt: string | null;
    /** Heartbeats came back after 2+ minutes of silence (seen by this server) */
    resumedAt: string | null;
    /** Read from the database after a website restart; no heartbeat heard yet */
    fromDatabase: boolean;
    /** Names of the fields in the last heartbeat's info, never their values */
    infoFields: string[];
  }>;
  cameras: Array<{
    id: string;
    channel: number | null;
    name: string;
    status: string;
    live: 'available' | LiveRefusal;
  }>;
  streamAuth: StreamAuthEntry[];
}

export interface CameraDto {
  id: string;
  channel: number | null;
  name: string;
  zone: string | null;
  /** What the plant calls it, shown when editing the name */
  plantName: string;
  plantZone: string | null;
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
  /** The last heartbeat from the plant computer */
  lastSeenAt: string | null;
  /** Silent for 10 minutes: show the red banner */
  offlineAlert: boolean;
  /** Software version on the plant computer, once it reports one */
  version: string | null;
  /** When the plant computer last asked GitHub for a new version */
  lastUpdateCheck: string | null;
  /** A version downloaded and waiting for the night window */
  updateWaiting: string | null;
  /** AUTO_UPDATE=false at the plant */
  updatesOff: boolean;
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

/**
 * Just after a restart the newest heartbeat is the one saved in the database,
 * up to 30 minutes old. For the first 3 minutes that counts as current, so the
 * page does not show "0 of 8" while the next heartbeat is on its way.
 */
export function savedHeartbeatStillCounts(bootedAt: Date, last: Date, now: Date): boolean {
  const sinceBoot = now.getTime() - bootedAt.getTime();
  return (
    sinceBoot >= 0 &&
    sinceBoot <= HEARTBEAT_STALE_MS &&
    now.getTime() - last.getTime() <= DB_REFRESH_MS + HEARTBEAT_STALE_MS
  );
}

/** OFFLINE when the last heartbeat is older than 3 minutes, else what was reported. */
export function effectiveStatus(
  row: Pick<CameraRow, 'status' | 'statusSince' | 'lastHeartbeatAt'>,
  now: Date,
  bootedAt?: Date,
): { status: CameraStatus; since: Date | null } {
  const last = row.lastHeartbeatAt;
  const current =
    last &&
    (now.getTime() - last.getTime() <= HEARTBEAT_STALE_MS ||
      (bootedAt && savedHeartbeatStillCounts(bootedAt, last, now)));
  if (!current) {
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
    for (const { id, snapshotAt, displayName: _name, displayZone: _zone, ...row } of rows) {
      if (!this.state.cameras.has(id)) {
        this.state.cameras.set(id, { ...row, unsaved: false, savedAt: row.lastHeartbeatAt });
      }
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
        fromDatabase: true,
        resumedAt: null,
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
        savedAt: previous?.savedAt ?? null,
      };
      const detailsChanged =
        !previous ||
        previous.statusDetail !== live.statusDetail ||
        (Object.keys(details) as Array<keyof typeof details>).some(
          (k) => previous[k] !== details[k],
        );
      this.state.cameras.set(cam.id, live);
      const changed = statusChanged || detailsChanged || previous?.unsaved === true;
      const sinceSaved = live.savedAt ? now.getTime() - live.savedAt.getTime() : Infinity;
      if ((changed && sinceSaved >= MIN_DB_WRITE_MS) || sinceSaved >= DB_REFRESH_MS) {
        try {
          await this.repo.upsertFromHeartbeat(
            { id: cam.id, ...live },
            now,
            live.statusSince ?? now,
          );
          live.savedAt = now;
        } catch (err) {
          // The website keeps working from memory; the next heartbeat tries again
          live.unsaved = true;
          logger.warn('Camera status not saved', {
            camera: cam.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } else if (changed) {
        live.unsaved = true;
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
      previous.info?.['liveUrl'] !== info?.['liveUrl'] ||
      previous.info?.['version'] !== info?.['version'] ||
      previous.info?.['updateWaiting'] !== info?.['updateWaiting'] ||
      previous.info?.['autoUpdate'] !== info?.['autoUpdate'];
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
    // Only a silence this process heard counts: after a website restart the saved time is old
    const resumed =
      previous &&
      !previous.fromDatabase &&
      now.getTime() - previous.lastHeartbeatAt.getTime() >= RESTART_GAP_MS;
    this.state.instances.set(input.instanceId, {
      source: input.source,
      cameraIds,
      info,
      lastHeartbeatAt: now,
      savedAt,
      fromDatabase: false,
      resumedAt: resumed ? now : (previous?.resumedAt ?? null),
    });
  }

  /** The website's name and area for a camera. An empty value goes back to the plant's. */
  async rename(
    id: string,
    input: CameraRenameInput,
  ): Promise<{ name: string; zone: string | null }> {
    const row = await this.repo.findNames(id);
    if (!row) throw new NotFoundError('Camera not found');
    const names = {
      displayName: input.name === undefined ? row.displayName : input.name || null,
      displayZone: input.zone === undefined ? row.displayZone : input.zone || null,
    };
    const shown = displayedCamera({ ...row, ...names });
    await this.repo.rename(id, names, cameraLabel(shown.name, shown.zone));
    return shown;
  }

  /** A 2-minute pass for one camera's live video, or the reason there is none. */
  liveAccess(id: string, quality: LiveQuality, userId: number, now: Date = new Date()): LiveAccess {
    const live = this.liveBase(id, now);
    if ('reason' in live) return { available: false, reason: live.reason };
    const { base } = live;

    const path = `${id}-${quality}`;
    return {
      available: true,
      token: signLiveToken(path, userId),
      whepUrl: `${base}/${path}/whep`,
      hlsUrl: `${base}:8443/${path}/index.m3u8`,
      expiresAt: new Date(now.getTime() + LIVE_TOKEN_TTL_S * 1000).toISOString(),
    };
  }

  /** The plant's live address for this camera, or the reason live view cannot start. */
  private liveBase(id: string, now: Date): { base: string } | { reason: LiveRefusal } {
    const reporting = [...this.state.instances.values()].filter(
      (i) =>
        i.source === 'LIVE' &&
        i.cameraIds.includes(id) &&
        now.getTime() - i.lastHeartbeatAt.getTime() <= HEARTBEAT_STALE_MS,
    );
    if (reporting.length === 0) return { reason: 'monitoring-offline' };
    if (this.state.cameras.get(id)?.status !== 'ONLINE') return { reason: 'camera-offline' };
    const base = reporting
      .map((i) => i.info?.['liveUrl'])
      .find((u): u is string => typeof u === 'string' && LIVE_URL.test(u));
    return base ? { base } : { reason: 'not-enabled' };
  }

  /** Admin Live view check: the last heartbeat's facts and what /live-token would answer. */
  async liveCheck(now: Date = new Date()): Promise<LiveCheckDto> {
    await this.hydrate();
    const text = (info: Record<string, unknown> | null, key: string): string | null => {
      const value = info?.[key];
      return typeof value === 'string' && value !== '' ? value : null;
    };
    const plants = [...this.state.instances.entries()]
      .map(([id, i]) => {
        const liveUrl = text(i.info, 'liveUrl');
        return {
          id,
          source: i.source,
          online: now.getTime() - i.lastHeartbeatAt.getTime() <= HEARTBEAT_STALE_MS,
          lastHeartbeatAt: i.lastHeartbeatAt.toISOString(),
          version: text(i.info, 'version'),
          liveUrl,
          liveUrlAccepted: liveUrl !== null && LIVE_URL.test(liveUrl),
          startedAt: text(i.info, 'startedAt'),
          resumedAt: iso(i.resumedAt ?? null),
          fromDatabase: i.fromDatabase === true,
          infoFields: Object.keys(i.info ?? {}).sort(),
        };
      })
      .sort(
        (a, b) =>
          Number(b.source === 'LIVE') - Number(a.source === 'LIVE') ||
          b.lastHeartbeatAt.localeCompare(a.lastHeartbeatAt),
      );
    const cameras = [...this.state.cameras.entries()]
      .map(([id, c]) => {
        const live = this.liveBase(id, now);
        return {
          id,
          channel: c.channel,
          name: c.name,
          status: c.status,
          live: 'reason' in live ? live.reason : ('available' as const),
        };
      })
      .sort((a, b) => (a.channel ?? 999) - (b.channel ?? 999) || a.id.localeCompare(b.id));
    return {
      checkedAt: now.toISOString(),
      websiteStartedAt: this.state.bootedAt.toISOString(),
      plants,
      cameras,
      streamAuth: streamAuthLog.latest(10),
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
    const { bootedAt } = this.state;
    const fresh = instances.filter(
      (i) =>
        now.getTime() - i.lastHeartbeatAt.getTime() <= HEARTBEAT_STALE_MS ||
        savedHeartbeatStillCounts(bootedAt, i.lastHeartbeatAt, now),
    );

    const cameras = rows.map((row): CameraDto => {
      const { status, since } = effectiveStatus(row, now, bootedAt);
      const sources = fresh.filter((i) => i.cameraIds.includes(row.id)).map((i) => i.id);
      const d = detections.get(row.id);
      return {
        id: row.id,
        channel: row.channel,
        ...displayedCamera(row),
        plantName: row.name,
        plantZone: row.zone,
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
        lastSeenAt: iso(lastLive),
        offlineAlert:
          !liveOnline &&
          lastLive !== null &&
          now.getTime() - lastLive.getTime() >= OFFLINE_ALERT_MS,
        version: infoText(live, 'version'),
        lastUpdateCheck: infoText(live, 'lastUpdateCheck'),
        updateWaiting: infoText(live, 'updateWaiting'),
        updatesOff: infoText(live, 'autoUpdate') === 'off',
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
