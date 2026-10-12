/**
 * Live security incident stream (Server-Sent Events from
 * GET /api/v1/security/stream).
 *
 * One shared connection per tab, opened while at least one subscriber exists.
 * fetch() is used instead of EventSource so the JWT goes in the Authorization
 * header (EventSource cannot set headers). The connection reconnects with
 * backoff; a 401 first refreshes the access token through the axios client.
 */

import api, { API_BASE, getAccessToken } from './api';
import type { IncidentSeverity, SecurityIncidentDto } from './services/security.service';

export type SecurityStreamEvent =
  | { type: 'incident.created'; incident: SecurityIncidentDto }
  | {
      type: 'incident.updated';
      incident: SecurityIncidentDto;
      previousSeverity?: IncidentSeverity;
      previousConfidence?: number | null;
    }
  | { type: 'incident.deleted'; incidentId: number };

export type StreamStatus = 'connecting' | 'live' | 'offline' | 'forbidden';

type EventListener = (event: SecurityStreamEvent) => void;
type StatusListener = (status: StreamStatus) => void;

const eventListeners = new Set<EventListener>();
const statusListeners = new Set<StatusListener>();
let status: StreamStatus = 'offline';
let controller: AbortController | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 1000;
const MAX_RETRY_DELAY = 15_000;
/** Backoff only resets after a connection proved stable, so a stream that
 *  keeps dropping right after connecting cannot turn into a reconnect storm. */
const STABLE_CONNECTION_MS = 30_000;

function setStatus(next: StreamStatus): void {
  status = next;
  statusListeners.forEach((listener) => listener(next));
}

/**
 * Decode one SSE frame (the text between blank lines). Returns null for
 * heartbeat comments, retry hints and malformed frames, which are ignored
 * rather than dropping the connection.
 */
export function parseSseFrame(block: string): SecurityStreamEvent | null {
  const data = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!data) return null;
  try {
    return JSON.parse(data) as SecurityStreamEvent;
  } catch {
    return null;
  }
}

/** Split buffered stream text into complete frames; returns the unfinished rest. */
export function splitSseFrames(buffer: string): { frames: string[]; rest: string } {
  const parts = buffer.replace(/\r\n/g, '\n').split('\n\n');
  return { frames: parts.slice(0, -1), rest: parts[parts.length - 1] ?? '' };
}

function dispatchBlock(block: string): void {
  const event = parseSseFrame(block);
  if (event) eventListeners.forEach((listener) => listener(event));
}

function scheduleReconnect(delayOverride?: number): void {
  if (eventListeners.size === 0 && statusListeners.size === 0) return;
  retryTimer = setTimeout(connect, delayOverride ?? retryDelay);
  retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY);
}

/** Seconds until the backend rate-limit window resets (RateLimit-Reset / Retry-After). */
function rateLimitWaitMs(res: Response): number {
  const seconds = Number(res.headers.get('Retry-After') ?? res.headers.get('RateLimit-Reset') ?? 60);
  return Math.min(Math.max(Number.isFinite(seconds) ? seconds : 60, 5), 900) * 1000;
}

class RateLimited extends Error {
  constructor(readonly waitMs: number) {
    super('rate limited');
  }
}

async function connect(): Promise<void> {
  retryTimer = null;
  const abort = new AbortController();
  controller = abort;
  setStatus('connecting');
  try {
    const res = await fetch(`${API_BASE}/security/stream`, {
      headers: { Authorization: `Bearer ${getAccessToken() ?? ''}`, Accept: 'text/event-stream' },
      credentials: 'include',
      signal: abort.signal,
    });
    if (res.status === 401) {
      // Any authorised call through axios performs the silent refresh.
      await api.get('/auth/me').catch(() => undefined);
      throw new Error('unauthorised');
    }
    if (res.status === 403) {
      setStatus('forbidden'); // this role cannot read security data; don't retry
      return;
    }
    if (res.status === 429) throw new RateLimited(rateLimitWaitMs(res));
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    setStatus('live');
    const connectedAt = Date.now();
    const stableTimer = setTimeout(() => { retryDelay = 1000; }, STABLE_CONNECTION_MS);
    abort.signal.addEventListener('abort', () => clearTimeout(stableTimer));
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const { frames, rest } = splitSseFrames(buffer + decoder.decode(value, { stream: true }));
      frames.forEach(dispatchBlock);
      buffer = rest;
    }
    clearTimeout(stableTimer);
    if (Date.now() - connectedAt >= STABLE_CONNECTION_MS) retryDelay = 1000;
    throw new Error('stream closed');
  } catch (err) {
    if (abort.signal.aborted) return;
    setStatus('offline');
    scheduleReconnect(err instanceof RateLimited ? err.waitMs : undefined);
  }
}

function ensureConnected(): void {
  if (controller === null && retryTimer === null) void connect();
}

function disconnectIfIdle(): void {
  if (eventListeners.size > 0 || statusListeners.size > 0) return;
  controller?.abort();
  controller = null;
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
  setStatus('offline');
}

export function subscribeSecurityStream(listener: EventListener): () => void {
  eventListeners.add(listener);
  ensureConnected();
  return () => {
    eventListeners.delete(listener);
    disconnectIfIdle();
  };
}

export function subscribeStreamStatus(listener: StatusListener): () => void {
  statusListeners.add(listener);
  listener(status);
  ensureConnected();
  return () => {
    statusListeners.delete(listener);
    disconnectIfIdle();
  };
}
