import { Prisma, type CameraStatus, type IncidentSource } from '@prisma/client';
import { prisma } from '../lib/prismaClient';

export const cameraSelect = {
  id: true,
  channel: true,
  name: true,
  zone: true,
  displayName: true,
  displayZone: true,
  enabled: true,
  status: true,
  statusDetail: true,
  statusSince: true,
  lastHeartbeatAt: true,
  lastFrameAt: true,
  achievedFps: true,
  inferMs: true,
  snapshotAt: true,
} satisfies Prisma.CameraSelect;

export type CameraRow = Prisma.CameraGetPayload<{ select: typeof cameraSelect }>;

const cameraNamesSelect = {
  name: true,
  zone: true,
  displayName: true,
  displayZone: true,
} satisfies Prisma.CameraSelect;

export type CameraNames = Prisma.CameraGetPayload<{ select: typeof cameraNamesSelect }>;

export interface LastDetectionRow {
  cameraId: string;
  id: number;
  incidentNumber: string;
  type: string;
  occurredAt: Date;
}

export interface CameraUpsert {
  id: string;
  channel: number | null;
  name: string;
  zone: string | null;
  enabled: boolean;
  status: CameraStatus;
  statusDetail: string | null;
  lastFrameAt: Date | null;
  achievedFps: number | null;
  inferMs: number | null;
}

export class CameraRepository {
  async findAll(): Promise<CameraRow[]> {
    return prisma.camera.findMany({
      select: cameraSelect,
      orderBy: [{ channel: 'asc' }, { id: 'asc' }],
    });
  }

  async upsertFromHeartbeat(cam: CameraUpsert, now: Date, statusSince: Date): Promise<void> {
    const fields = {
      channel: cam.channel,
      name: cam.name,
      zone: cam.zone,
      enabled: cam.enabled,
      status: cam.status,
      statusDetail: cam.statusDetail,
      lastHeartbeatAt: now,
      lastFrameAt: cam.lastFrameAt,
      achievedFps: cam.achievedFps,
      inferMs: cam.inferMs,
      statusSince,
    };
    await prisma.camera.upsert({
      where: { id: cam.id },
      create: { id: cam.id, ...fields },
      update: fields,
    });
  }

  /** Make sure a camera row exists (e.g. an incident arrives before the first heartbeat). */
  async ensure(cam: {
    id: string;
    name: string;
    zone: string | null;
    channel: number | null;
  }): Promise<CameraNames> {
    return prisma.camera.upsert({
      where: { id: cam.id },
      create: { id: cam.id, name: cam.name, zone: cam.zone, channel: cam.channel },
      update: {},
      select: cameraNamesSelect,
    });
  }

  async findNames(id: string): Promise<CameraNames | null> {
    return prisma.camera.findUnique({ where: { id }, select: cameraNamesSelect });
  }

  /**
   * Saves the website's names and puts them on this camera's incidents and
   * alerts, so reports, notifications and Ask DVS all read the same name.
   */
  async rename(
    id: string,
    names: { displayName: string | null; displayZone: string | null },
    location: string,
  ): Promise<void> {
    await prisma.$transaction([
      prisma.camera.update({ where: { id }, data: names }),
      prisma.securityIncident.updateMany({ where: { cameraId: id }, data: { location } }),
      prisma.securityAlert.updateMany({
        where: { incident: { cameraId: id } },
        data: { location },
      }),
    ]);
  }

  async saveInstance(
    id: string,
    source: IncidentSource,
    cameraIds: string[],
    info: Prisma.InputJsonValue | undefined,
    now: Date,
  ): Promise<void> {
    const data = { source, cameraIds, lastHeartbeatAt: now, ...(info !== undefined && { info }) };
    await prisma.perceptionInstance.upsert({
      where: { id },
      create: { id, ...data },
      update: data,
    });
  }

  async findInstances() {
    return prisma.perceptionInstance.findMany({ orderBy: { lastHeartbeatAt: 'desc' } });
  }

  async saveSnapshot(id: string, data: Buffer, now: Date): Promise<boolean> {
    const result = await prisma.camera.updateMany({
      where: { id },
      data: { lastSnapshot: new Uint8Array(data), snapshotAt: now },
    });
    return result.count > 0;
  }

  async findSnapshot(
    id: string,
  ): Promise<{ lastSnapshot: Buffer | null; snapshotAt: Date | null } | null> {
    const row = await prisma.camera.findUnique({
      where: { id },
      select: { lastSnapshot: true, snapshotAt: true },
    });
    return row
      ? {
          lastSnapshot: row.lastSnapshot ? Buffer.from(row.lastSnapshot) : null,
          snapshotAt: row.snapshotAt,
        }
      : null;
  }

  /** The newest real (LIVE) incident per camera. */
  async lastDetections(cameraIds: string[]): Promise<LastDetectionRow[]> {
    if (cameraIds.length === 0) return [];
    return prisma.$queryRaw<LastDetectionRow[]>`
      SELECT DISTINCT ON ("cameraId") "cameraId", "id", "incidentNumber", "type"::text AS "type", "occurredAt"
      FROM "SecurityIncident"
      WHERE "cameraId" IN (${Prisma.join(cameraIds)}) AND "deletedAt" IS NULL AND "source" = 'LIVE'
      ORDER BY "cameraId", "occurredAt" DESC`;
  }
}
