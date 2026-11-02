import crypto from 'crypto';
import { z } from 'zod';
import type { EvidenceKind, Prisma } from '@prisma/client';
import { prisma } from '../lib/prismaClient';
import { env } from '../config/env';
import { BadRequestError, NotFoundError } from '../errors';
import { logger } from '../logger';
import { jpegDimensions } from '../utils/jpeg';
import { evidenceStore, type EvidenceStore } from './evidenceStore';
import { explain, type IncidentEvidence } from './perceptionEvidence.service';

export const EVIDENCE_MAX_BYTES = 250 * 1024;
export const EVIDENCE_MAX_WIDTH = 1280;
export const FALSE_ALARM_RETENTION_DAYS = 7;
const DAY_MS = 86_400_000;

/** Multipart field name -> what it is. Up to 3 keyframes and 3 Grad-CAM images. */
export const EVIDENCE_FIELDS: Record<
  string,
  { kind: EvidenceKind; position: number; label: string | null }
> = {
  keyframe_before: { kind: 'KEYFRAME', position: 0, label: 'before' },
  keyframe_at: { kind: 'KEYFRAME', position: 1, label: 'at' },
  keyframe_after: { kind: 'KEYFRAME', position: 2, label: 'after' },
  gradcam_0: { kind: 'GRADCAM', position: 0, label: null },
  gradcam_1: { kind: 'GRADCAM', position: 1, label: null },
  gradcam_2: { kind: 'GRADCAM', position: 2, label: null },
};

/** Detector details for the explanation; no file paths or URLs. */
const metaSchema = z.object({
  eventType: z.string().max(40),
  tier: z.string().max(40).optional().default(''),
  confidenceBasis: z.string().max(300).nullable().optional(),
  recommendedAction: z.string().max(500).nullable().optional(),
  validationVersion: z.number().int().nullable().optional(),
  detail: z.record(z.string(), z.unknown()).optional().default({}),
});
type EvidenceMeta = z.infer<typeof metaSchema>;

export interface UploadedPart {
  fieldname: string;
  buffer: Buffer;
}

export function parseMeta(raw: unknown): EvidenceMeta | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' || raw.length > 16_384)
    throw new BadRequestError('Evidence details are too large');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BadRequestError('Evidence details are not valid JSON');
  }
  const result = metaSchema.safeParse(parsed);
  if (!result.success) throw new BadRequestError('Evidence details have the wrong shape');
  return result.data;
}

/** Checks one picture: a real JPEG, <= 1280 px wide, <= 250 KB. */
export function validatePicture(part: UploadedPart): { width: number; height: number } {
  if (!EVIDENCE_FIELDS[part.fieldname])
    throw new BadRequestError(`Unexpected file field ${part.fieldname}`);
  if (part.buffer.length === 0) throw new BadRequestError(`${part.fieldname} is empty`);
  if (part.buffer.length > EVIDENCE_MAX_BYTES)
    throw new BadRequestError(`${part.fieldname} is larger than 250 KB`);
  const size = jpegDimensions(part.buffer);
  if (!size) throw new BadRequestError(`${part.fieldname} is not a JPEG picture`);
  if (size.width > EVIDENCE_MAX_WIDTH)
    throw new BadRequestError(`${part.fieldname} is wider than 1280 px`);
  return size;
}

async function findIncident(ref: string) {
  const where = /^\d+$/.test(ref) ? { id: Number(ref) } : { incidentNumber: ref };
  const incident = await prisma.securityIncident.findFirst({
    where: { ...where, deletedAt: null },
    select: { id: true, incidentNumber: true },
  });
  if (!incident) throw new NotFoundError('Incident not found');
  return incident;
}

export class IncidentEvidenceService {
  constructor(private readonly store: EvidenceStore = evidenceStore()) {}

  /** Stores the pictures (replacing ones with the same name: uploads are retried). */
  async upload(ref: string, parts: UploadedPart[], rawMeta: unknown): Promise<{ stored: number }> {
    const meta = parseMeta(rawMeta);
    if (parts.length === 0 && !meta) throw new BadRequestError('Send at least one picture');
    const seen = new Set<string>();
    const sizes = parts.map((p) => {
      if (seen.has(p.fieldname)) throw new BadRequestError(`${p.fieldname} sent twice`);
      seen.add(p.fieldname);
      return validatePicture(p);
    });
    const incident = await findIncident(ref);

    for (const [i, part] of parts.entries()) {
      const field = EVIDENCE_FIELDS[part.fieldname]!;
      const key = `incidents/${incident.incidentNumber}/${field.kind.toLowerCase()}-${field.position}.jpg`;
      const stored = await this.store.put(key, part.buffer, 'image/jpeg');
      const data = {
        label: field.label,
        contentType: 'image/jpeg',
        sizeBytes: part.buffer.length,
        width: sizes[i]!.width,
        height: sizes[i]!.height,
        sha256: crypto.createHash('sha256').update(part.buffer).digest('hex'),
        storage: stored.storage,
        storageKey: stored.storageKey,
        data: stored.data ? new Uint8Array(stored.data) : null,
      };
      await prisma.incidentEvidence.upsert({
        where: {
          incidentId_kind_position: {
            incidentId: incident.id,
            kind: field.kind,
            position: field.position,
          },
        },
        create: { incidentId: incident.id, kind: field.kind, position: field.position, ...data },
        update: { ...data, createdAt: new Date() },
      });
    }
    if (meta) {
      await prisma.securityIncident.update({
        where: { id: incident.id },
        data: { evidenceMeta: meta as Prisma.InputJsonValue },
      });
    }
    logger.info('Incident evidence stored', {
      incident: incident.incidentNumber,
      pictures: parts.length,
    });
    return { stored: parts.length };
  }

  /**
   * Evidence stored on the website for this incident, or null when there is
   * none (the caller then falls back to the perception PC's own files).
   */
  async summary(
    incident: { id: number; incidentNumber: string; cameraId?: string | null },
    includeTechnical: boolean,
  ): Promise<IncidentEvidence | null> {
    const [rows, row] = await Promise.all([
      prisma.incidentEvidence.findMany({
        where: { incidentId: incident.id },
        select: { id: true, kind: true, position: true, label: true },
        orderBy: [{ kind: 'asc' }, { position: 'asc' }],
      }),
      prisma.securityIncident.findUnique({
        where: { id: incident.id },
        select: { evidenceMeta: true },
      }),
    ]);
    const meta = row?.evidenceMeta ? (metaSchema.safeParse(row.evidenceMeta).data ?? null) : null;
    if (rows.length === 0 && !meta) return null;
    const detail = (meta?.detail ?? {}) as Record<string, unknown>;
    const result: IncidentEvidence = {
      available: true,
      incidentId: incident.incidentNumber,
      cameraId: incident.cameraId ?? null,
      eventType: meta?.eventType ?? '',
      tier: meta?.tier ?? '',
      confidenceScore: null,
      confidenceBasis: meta?.confidenceBasis ?? null,
      validationVersion: meta?.validationVersion ?? null,
      recommendedAction: meta?.recommendedAction ?? null,
      explanation: meta ? explain(meta.eventType, detail as never) : [],
      files: rows.map((r) => ({
        file: `db:${r.id}`,
        kind: r.kind === 'GRADCAM' ? 'gradcam' : 'keyframe',
        ...(r.label && { label: r.label }),
      })),
    };
    if (includeTechnical && meta) result.technical = detail as never;
    return result;
  }

  async file(incidentId: number, evidenceId: number): Promise<Buffer> {
    const row = await prisma.incidentEvidence.findFirst({
      where: { id: evidenceId, incidentId },
      select: { storage: true, storageKey: true, data: true },
    });
    if (!row) throw new NotFoundError('Evidence file not found');
    return this.store.get(row);
  }

  /**
   * Deletes pictures older than EVIDENCE_RETENTION_DAYS, and those of false
   * alarms after 7 days. dryRun only counts.
   */
  async applyRetention(
    now: Date = new Date(),
    { dryRun = false, retentionDays = env.EVIDENCE_RETENTION_DAYS } = {},
  ): Promise<{ expired: number; falseAlarm: number }> {
    const expiredBefore = new Date(now.getTime() - retentionDays * DAY_MS);
    const falseAlarmBefore = new Date(now.getTime() - FALSE_ALARM_RETENTION_DAYS * DAY_MS);
    const select = { id: true, storage: true, storageKey: true } as const;
    const [expired, falseAlarm] = await Promise.all([
      prisma.incidentEvidence.findMany({ where: { createdAt: { lt: expiredBefore } }, select }),
      prisma.incidentEvidence.findMany({
        where: {
          createdAt: { lt: falseAlarmBefore, gte: expiredBefore },
          incident: { falseAlarm: true },
        },
        select,
      }),
    ]);
    if (!dryRun) {
      for (const row of [...expired, ...falseAlarm]) {
        try {
          await this.store.delete(row);
        } catch (err) {
          logger.warn('Evidence picture could not be deleted from storage', { id: row.id, err });
          continue; // keep the row so the next run tries again
        }
        await prisma.incidentEvidence.delete({ where: { id: row.id } });
      }
      if (expired.length + falseAlarm.length > 0) {
        logger.info('Evidence retention', {
          expired: expired.length,
          falseAlarm: falseAlarm.length,
        });
      }
    }
    return { expired: expired.length, falseAlarm: falseAlarm.length };
  }

  /** How much evidence is stored, for the health check. */
  async usage(): Promise<{ driver: string; files: number; bytes: number; databaseBytes: number }> {
    const [all, inDb] = await Promise.all([
      prisma.incidentEvidence.aggregate({ _count: { _all: true }, _sum: { sizeBytes: true } }),
      prisma.incidentEvidence.aggregate({ where: { storage: 'db' }, _sum: { sizeBytes: true } }),
    ]);
    return {
      driver: this.store.driver,
      files: all._count._all,
      bytes: all._sum.sizeBytes ?? 0,
      databaseBytes: inDb._sum.sizeBytes ?? 0,
    };
  }
}
