import { env } from '../config/env';
import { S3Client, type S3Config } from '../utils/s3';

/**
 * Where incident pictures live. "db" keeps them in the IncidentEvidence row
 * (default; fine for Neon's free tier with the retention job), "s3" in an
 * S3-compatible bucket when EVIDENCE_S3_* are set.
 */
export interface StoredRef {
  storage: 'db' | 's3';
  storageKey: string | null;
  data: Buffer | null;
}

export interface EvidenceStore {
  readonly driver: 'db' | 's3';
  put(key: string, data: Buffer, contentType: string): Promise<StoredRef>;
  get(ref: {
    storage: string;
    storageKey: string | null;
    data: Uint8Array | null;
  }): Promise<Buffer>;
  delete(ref: { storage: string; storageKey: string | null }): Promise<void>;
}

export class DbEvidenceStore implements EvidenceStore {
  readonly driver = 'db' as const;

  put(_key: string, data: Buffer): Promise<StoredRef> {
    return Promise.resolve({ storage: 'db', storageKey: null, data });
  }

  get(ref: { data: Uint8Array | null }): Promise<Buffer> {
    if (!ref.data) return Promise.reject(new Error('Evidence picture is missing'));
    return Promise.resolve(Buffer.from(ref.data));
  }

  delete(): Promise<void> {
    // The row itself holds the picture
    return Promise.resolve();
  }
}

export class S3EvidenceStore implements EvidenceStore {
  readonly driver = 's3' as const;
  private readonly fallback = new DbEvidenceStore();

  constructor(private readonly client: S3Client) {}

  async put(key: string, data: Buffer, contentType: string): Promise<StoredRef> {
    await this.client.put(key, data, contentType);
    return { storage: 's3', storageKey: key, data: null };
  }

  async get(ref: {
    storage: string;
    storageKey: string | null;
    data: Uint8Array | null;
  }): Promise<Buffer> {
    // Pictures stored before the bucket was configured are still in the database
    if (ref.storage !== 's3' || !ref.storageKey) return this.fallback.get(ref);
    return this.client.get(ref.storageKey);
  }

  async delete(ref: { storage: string; storageKey: string | null }): Promise<void> {
    if (ref.storage === 's3' && ref.storageKey) await this.client.delete(ref.storageKey);
  }
}

export function s3ConfigFromEnv(e = env): S3Config | null {
  if (
    !e.EVIDENCE_S3_ENDPOINT ||
    !e.EVIDENCE_S3_BUCKET ||
    !e.EVIDENCE_S3_ACCESS_KEY_ID ||
    !e.EVIDENCE_S3_SECRET_ACCESS_KEY
  ) {
    return null;
  }
  return {
    endpoint: e.EVIDENCE_S3_ENDPOINT,
    bucket: e.EVIDENCE_S3_BUCKET,
    region: e.EVIDENCE_S3_REGION,
    accessKeyId: e.EVIDENCE_S3_ACCESS_KEY_ID,
    secretAccessKey: e.EVIDENCE_S3_SECRET_ACCESS_KEY,
  };
}

let store: EvidenceStore | null = null;

export function evidenceStore(): EvidenceStore {
  if (!store) {
    const cfg = s3ConfigFromEnv();
    store = cfg ? new S3EvidenceStore(new S3Client(cfg)) : new DbEvidenceStore();
  }
  return store;
}
