/**
 * Incident pictures from the factory PC: upload checks, storage drivers,
 * the "View evidence" summary and the retention job.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeJpeg } from '../helpers/jpeg';

vi.mock('../../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../config/env', () => ({
  env: { EVIDENCE_RETENTION_DAYS: 30, EVIDENCE_S3_REGION: 'auto' },
}));
vi.mock('../../lib/prismaClient', () => ({
  prisma: {
    securityIncident: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    incidentEvidence: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
      aggregate: vi.fn(),
    },
  },
}));

import { prisma } from '../../lib/prismaClient';
import {
  IncidentEvidenceService,
  parseMeta,
  validatePicture,
} from '../../services/incidentEvidence.service';
import { DbEvidenceStore, S3EvidenceStore, s3ConfigFromEnv } from '../../services/evidenceStore';
import { S3Client, signV4 } from '../../utils/s3';

const fn = (f: unknown) => f as ReturnType<typeof vi.fn>;
const NOW = new Date('2026-11-20T10:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

beforeEach(() => vi.clearAllMocks());

describe('S3 signing (AWS Signature V4)', () => {
  it('matches the AWS documentation example (GET Object)', () => {
    const auth = signV4({
      method: 'GET',
      host: 'examplebucket.s3.amazonaws.com',
      path: '/test.txt',
      headers: {
        range: 'bytes=0-9',
        'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        'x-amz-date': '20130524T000000Z',
      },
      region: 'us-east-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    });
    expect(auth).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });

  it('puts, gets and deletes objects with path-style URLs (R2)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer),
    });
    const client = new S3Client(
      {
        endpoint: 'https://acct.r2.cloudflarestorage.com',
        bucket: 'dvs-evidence',
        region: 'auto',
        accessKeyId: 'AK',
        secretAccessKey: 'SK',
      },
      fetchImpl as unknown as typeof fetch,
    );
    await client.put('incidents/INC-1/keyframe-0.jpg', Buffer.from('jpeg'), 'image/jpeg');
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(
      'https://acct.r2.cloudflarestorage.com/dvs-evidence/incidents/INC-1/keyframe-0.jpg',
    );
    expect(init.method).toBe('PUT');
    expect(init.headers.Authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AK\/\d{8}\/auto\/s3\/aws4_request/,
    );
    expect(await client.get('incidents/INC-1/keyframe-0.jpg')).toEqual(Buffer.from([1, 2, 3]));
    fetchImpl.mockResolvedValueOnce({ ok: false, status: 404 });
    await expect(client.delete('gone.jpg')).resolves.toBeUndefined(); // already gone is fine
  });

  it('uses the bucket only when all four settings are present', () => {
    expect(s3ConfigFromEnv({ EVIDENCE_S3_REGION: 'auto' } as never)).toBeNull();
    expect(
      s3ConfigFromEnv({
        EVIDENCE_S3_ENDPOINT: 'https://x.r2.cloudflarestorage.com',
        EVIDENCE_S3_BUCKET: 'b',
        EVIDENCE_S3_ACCESS_KEY_ID: 'a',
        EVIDENCE_S3_SECRET_ACCESS_KEY: 's',
        EVIDENCE_S3_REGION: 'auto',
      } as never),
    ).toMatchObject({ bucket: 'b', region: 'auto' });
  });
});

describe('upload checks', () => {
  it('accepts a JPEG up to 1280 px and 250 KB', () => {
    expect(
      validatePicture({ fieldname: 'keyframe_at', buffer: fakeJpeg(1280, 720, 20_000) }),
    ).toEqual({
      width: 1280,
      height: 720,
    });
  });

  it.each([
    ['keyframe_at', Buffer.from('<svg/>'), 'not a JPEG'],
    ['keyframe_at', fakeJpeg(1920, 1080), 'wider than 1280'],
    ['keyframe_at', fakeJpeg(1280, 720, 251 * 1024), 'larger than 250 KB'],
    ['video', fakeJpeg(640, 360), 'Unexpected file field'],
  ])('rejects %s %#', (fieldname, buffer, message) => {
    expect(() => validatePicture({ fieldname, buffer })).toThrow(message);
  });

  it('reads the detector details and refuses anything else', () => {
    expect(
      parseMeta(JSON.stringify({ eventType: 'fire_smoke', detail: { fire_score: 0.8 } })),
    ).toMatchObject({
      eventType: 'fire_smoke',
    });
    expect(parseMeta(undefined)).toBeNull();
    expect(() => parseMeta('{not json')).toThrow('not valid JSON');
    expect(() => parseMeta(JSON.stringify({ detail: {} }))).toThrow('wrong shape');
  });
});

describe('upload', () => {
  it('stores pictures under the incident number and replaces on retry', async () => {
    fn(prisma.securityIncident.findFirst).mockResolvedValue({
      id: 7,
      incidentNumber: 'INC-20261104-ABC123',
    });
    const svc = new IncidentEvidenceService(new DbEvidenceStore());
    const result = await svc.upload(
      'INC-20261104-ABC123',
      [
        { fieldname: 'keyframe_before', buffer: fakeJpeg(704, 576) },
        { fieldname: 'gradcam_0', buffer: fakeJpeg(112, 112) },
      ],
      JSON.stringify({ eventType: 'fight', tier: 'CONFIRMED', detail: { score: 0.93 } }),
    );
    expect(result).toEqual({ stored: 2 });
    expect(prisma.securityIncident.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { incidentNumber: 'INC-20261104-ABC123', deletedAt: null },
      }),
    );
    const first = fn(prisma.incidentEvidence.upsert).mock.calls[0]![0];
    expect(first.where).toEqual({
      incidentId_kind_position: { incidentId: 7, kind: 'KEYFRAME', position: 0 },
    });
    expect(first.create).toMatchObject({ label: 'before', width: 704, storage: 'db' });
    expect(prisma.securityIncident.update).toHaveBeenCalled();
  });

  it('puts pictures in the bucket when S3 is configured', async () => {
    fn(prisma.securityIncident.findFirst).mockResolvedValue({ id: 7, incidentNumber: 'INC-9' });
    const client = { put: vi.fn(), get: vi.fn(), delete: vi.fn() };
    const svc = new IncidentEvidenceService(new S3EvidenceStore(client as unknown as S3Client));
    await svc.upload('7', [{ fieldname: 'keyframe_at', buffer: fakeJpeg(640, 360) }], undefined);
    expect(client.put).toHaveBeenCalledWith(
      'incidents/INC-9/keyframe-1.jpg',
      expect.any(Buffer),
      'image/jpeg',
    );
    expect(fn(prisma.incidentEvidence.upsert).mock.calls[0]![0].create).toMatchObject({
      storage: 's3',
      storageKey: 'incidents/INC-9/keyframe-1.jpg',
      data: null,
    });
  });

  it('refuses the same picture twice in one upload, and unknown incidents', async () => {
    const svc = new IncidentEvidenceService(new DbEvidenceStore());
    const pic = { fieldname: 'keyframe_at', buffer: fakeJpeg(640, 360) };
    await expect(svc.upload('7', [pic, pic], undefined)).rejects.toThrow('sent twice');
    fn(prisma.securityIncident.findFirst).mockResolvedValue(null);
    await expect(svc.upload('INC-404', [pic], undefined)).rejects.toThrow('Incident not found');
  });
});

describe('View evidence', () => {
  it('lists the stored pictures with their labels and the explanation', async () => {
    fn(prisma.incidentEvidence.findMany).mockResolvedValue([
      { id: 11, kind: 'KEYFRAME', position: 0, label: 'before' },
      { id: 12, kind: 'GRADCAM', position: 0, label: null },
    ]);
    fn(prisma.securityIncident.findUnique).mockResolvedValue({
      evidenceMeta: { eventType: 'fall', tier: 'CONFIRMED', detail: { score: 0.9 } },
    });
    const summary = await new IncidentEvidenceService(new DbEvidenceStore()).summary(
      { id: 7, incidentNumber: 'INC-1', cameraId: 'dvr-ch3' },
      false,
    );
    expect(summary).toMatchObject({
      available: true,
      cameraId: 'dvr-ch3',
      files: [
        { file: 'db:11', kind: 'keyframe', label: 'before' },
        { file: 'db:12', kind: 'gradcam' },
      ],
      explanation: [{ label: 'Fall model probability', value: '90%' }],
    });
    expect(summary).not.toHaveProperty('technical');
  });

  it('answers null straight away for incidents without stored evidence', async () => {
    fn(prisma.incidentEvidence.findMany).mockResolvedValue([]);
    fn(prisma.securityIncident.findUnique).mockResolvedValue({ evidenceMeta: null });
    expect(
      await new IncidentEvidenceService(new DbEvidenceStore()).summary(
        { id: 1, incidentNumber: 'INC-0001' },
        true,
      ),
    ).toBeNull();
  });

  it('serves a file only for its own incident', async () => {
    fn(prisma.incidentEvidence.findFirst).mockResolvedValue(null);
    await expect(new IncidentEvidenceService(new DbEvidenceStore()).file(7, 99)).rejects.toThrow(
      'not found',
    );
    expect(prisma.incidentEvidence.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 99, incidentId: 7 } }),
    );
  });
});

describe('retention', () => {
  it('finds pictures older than the limit and false alarms after 7 days', async () => {
    fn(prisma.incidentEvidence.findMany)
      .mockResolvedValueOnce([{ id: 1, storage: 'db', storageKey: null }])
      .mockResolvedValueOnce([{ id: 2, storage: 'db', storageKey: null }]);
    const result = await new IncidentEvidenceService(new DbEvidenceStore()).applyRetention(NOW);
    expect(result).toEqual({ expired: 1, falseAlarm: 1 });
    const [expiredQuery, falseQuery] = fn(prisma.incidentEvidence.findMany).mock.calls.map(
      (c) => c[0].where,
    );
    expect(expiredQuery).toEqual({ createdAt: { lt: daysAgo(30) } });
    expect(falseQuery).toEqual({
      createdAt: { lt: daysAgo(7), gte: daysAgo(30) },
      incident: { falseAlarm: true },
    });
    expect(prisma.incidentEvidence.delete).toHaveBeenCalledTimes(2);
  });

  it('only counts in a dry run', async () => {
    fn(prisma.incidentEvidence.findMany).mockResolvedValue([
      { id: 1, storage: 'db', storageKey: null },
    ]);
    await new IncidentEvidenceService(new DbEvidenceStore()).applyRetention(NOW, { dryRun: true });
    expect(prisma.incidentEvidence.delete).not.toHaveBeenCalled();
  });

  it('keeps the row when the bucket delete fails, so the next run retries', async () => {
    fn(prisma.incidentEvidence.findMany)
      .mockResolvedValueOnce([
        { id: 1, storage: 's3', storageKey: 'incidents/INC-1/keyframe-0.jpg' },
      ])
      .mockResolvedValueOnce([]);
    const client = {
      put: vi.fn(),
      get: vi.fn(),
      delete: vi.fn().mockRejectedValue(new Error('HTTP 500')),
    };
    await new IncidentEvidenceService(
      new S3EvidenceStore(client as unknown as S3Client),
    ).applyRetention(NOW);
    expect(prisma.incidentEvidence.delete).not.toHaveBeenCalled();
  });

  it('reports how much evidence the database holds', async () => {
    fn(prisma.incidentEvidence.aggregate)
      .mockResolvedValueOnce({ _count: { _all: 4 }, _sum: { sizeBytes: 400_000 } })
      .mockResolvedValueOnce({ _sum: { sizeBytes: 400_000 } });
    expect(await new IncidentEvidenceService(new DbEvidenceStore()).usage()).toEqual({
      driver: 'db',
      files: 4,
      bytes: 400_000,
      databaseBytes: 400_000,
    });
  });
});
