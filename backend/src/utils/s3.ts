import crypto from 'crypto';

/**
 * A minimal S3-compatible client (PUT / GET / DELETE one object) with AWS
 * Signature V4, path-style URLs: enough for Cloudflare R2, Backblaze B2 or
 * AWS S3 without pulling in the AWS SDK.
 */
export interface S3Config {
  endpoint: string; // e.g. https://<account>.r2.cloudflarestorage.com
  bucket: string;
  region: string; // "auto" for R2
  accessKeyId: string;
  secretAccessKey: string;
}

const sha256Hex = (data: string | Buffer) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string) =>
  crypto.createHmac('sha256', key).update(data).digest();

/** RFC 3986 encoding, keeping "/" in object keys. */
export function encodeKey(key: string): string {
  return key
    .split('/')
    .map((part) =>
      encodeURIComponent(part).replace(
        /[!'()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join('/');
}

export interface SignInput {
  method: string;
  host: string;
  path: string; // already encoded
  query?: string; // canonical query string
  headers: Record<string, string>; // must include x-amz-date and x-amz-content-sha256
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  service?: string;
}

/** The Authorization header for a request (AWS Signature Version 4). */
export function signV4(input: SignInput): string {
  const service = input.service ?? 's3';
  const amzDate = input.headers['x-amz-date']!;
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = { host: input.host };
  for (const [k, v] of Object.entries(input.headers)) headers[k.toLowerCase()] = v.trim();
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    input.method,
    input.path,
    input.query ?? '',
    canonicalHeaders,
    signedHeaders,
    headers['x-amz-content-sha256'],
  ].join('\n');
  const scope = `${day}/${input.region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const kDate = hmac(`AWS4${input.secretAccessKey}`, day);
  const kSigning = hmac(hmac(hmac(kDate, input.region), service), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  return `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function amzDateOf(now: Date): string {
  return now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

export class S3Client {
  constructor(
    private readonly cfg: S3Config,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async send(
    method: 'PUT' | 'GET' | 'DELETE',
    key: string,
    body?: Buffer,
    contentType?: string,
  ) {
    const url = new URL(this.cfg.endpoint);
    const path = `${url.pathname.replace(/\/$/, '')}/${encodeKey(this.cfg.bucket)}/${encodeKey(key)}`;
    const payloadHash = sha256Hex(body ?? '');
    const headers: Record<string, string> = {
      'x-amz-date': amzDateOf(new Date()),
      'x-amz-content-sha256': payloadHash,
      ...(contentType && { 'content-type': contentType }),
    };
    const authorization = signV4({
      method,
      host: url.host,
      path,
      headers,
      region: this.cfg.region,
      accessKeyId: this.cfg.accessKeyId,
      secretAccessKey: this.cfg.secretAccessKey,
    });
    const res = await this.fetchImpl(`${url.protocol}//${url.host}${path}`, {
      method,
      headers: { ...headers, Authorization: authorization },
      ...(body && { body: new Uint8Array(body) }),
    });
    if (!res.ok && !(method === 'DELETE' && res.status === 404)) {
      throw new Error(`Evidence storage ${method} failed with HTTP ${res.status}`);
    }
    return res;
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    await this.send('PUT', key, data, contentType);
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.send('GET', key);
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    await this.send('DELETE', key);
  }
}
