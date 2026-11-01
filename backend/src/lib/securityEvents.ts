import { EventEmitter } from 'events';
import type { SecurityIncidentDto } from '../interfaces';

/**
 * Pub/sub for security incident changes, consumed by the Server-Sent Events
 * stream (GET /api/v1/security/stream) so dashboards see new and escalated
 * incidents the moment they are written.
 *
 * With one backend process, events stay in memory. Under PM2 cluster mode
 * every worker has its own memory, so a browser connected to worker B would
 * miss an incident written by worker A. There, `startSecurityEventBus` relays
 * events through Postgres NOTIFY: every worker LISTENs on one channel and
 * forwards what arrives (its own events included) to its SSE clients.
 */
export type SecurityEvent =
  | { type: 'incident.created'; incident: SecurityIncidentDto }
  | {
      type: 'incident.updated';
      incident: SecurityIncidentDto;
      previousSeverity?: string;
      previousConfidence?: number | null;
    }
  | { type: 'incident.deleted'; incidentId: number };

export const SECURITY_EVENTS_CHANNEL = 'dvs_security_events';
// Postgres rejects NOTIFY payloads of 8000 bytes or more
const MAX_PAYLOAD_BYTES = 7_500;
const LONG_TEXT_LIMIT = 500;

const emitter = new EventEmitter();
// One listener per connected dashboard tab.
emitter.setMaxListeners(0);

/** Sends one NOTIFY, e.g. via Prisma: SELECT pg_notify($1, $2). */
export type NotifyFn = (channel: string, payload: string) => Promise<unknown>;

/** The subset of a `pg` Client the bus uses (a fake in tests). */
export interface ListenClient {
  connect(): Promise<unknown>;
  query(sql: string): Promise<unknown>;
  onNotification(
    listener: (message: { channel: string; payload?: string | undefined }) => void,
  ): void;
  onError(listener: (error: Error) => void): void;
  end(): Promise<void>;
}

interface Bus {
  notify: NotifyFn;
  listening: boolean;
  onError: (error: unknown) => void;
}

let bus: Bus | null = null;

function deliver(event: SecurityEvent): void {
  emitter.emit('event', event);
}

/** JSON that fits a NOTIFY; long free text is shortened if it would not. */
export function serialiseSecurityEvent(event: SecurityEvent): string {
  const full = JSON.stringify(event);
  if (Buffer.byteLength(full) < MAX_PAYLOAD_BYTES || event.type === 'incident.deleted') return full;
  const shorten = (text: string | null) =>
    text !== null && text.length > LONG_TEXT_LIMIT ? `${text.slice(0, LONG_TEXT_LIMIT)}…` : text;
  return JSON.stringify({
    ...event,
    incident: {
      ...event.incident,
      description: shorten(event.incident.description) ?? '',
      aiSummary: shorten(event.incident.aiSummary ?? null),
    },
  });
}

export function publishSecurityEvent(event: SecurityEvent): void {
  const active = bus;
  if (active === null || !active.listening) {
    // In-process: one worker, tests, or the shared listener is reconnecting
    deliver(event);
    return;
  }
  // Every worker, this one included, receives it back through LISTEN
  active.notify(SECURITY_EVENTS_CHANNEL, serialiseSecurityEvent(event)).catch((error: unknown) => {
    active.onError(error);
    deliver(event);
  });
}

export function subscribeSecurityEvents(listener: (event: SecurityEvent) => void): () => void {
  emitter.on('event', listener);
  return () => emitter.off('event', listener);
}

/**
 * Relays events between processes through Postgres LISTEN/NOTIFY. The
 * listening client needs a direct (non-pooled) connection: LISTEN does not
 * survive a transaction-mode pooler. Reconnects after errors; returns a stop
 * function for graceful shutdown.
 */
export async function startSecurityEventBus(options: {
  createClient: () => ListenClient;
  notify: NotifyFn;
  onError?: (error: unknown) => void;
  reconnectMs?: number;
}): Promise<() => Promise<void>> {
  const reconnectMs = options.reconnectMs ?? 5_000;
  const report = options.onError ?? (() => {});
  let client: ListenClient | null = null;
  let stopped = false;
  let retry: NodeJS.Timeout | null = null;

  const current: Bus = {
    notify: options.notify,
    listening: false,
    onError: report,
  };
  bus = current;

  const scheduleReconnect = () => {
    if (stopped || retry !== null) return;
    retry = setTimeout(() => {
      retry = null;
      void connect();
    }, reconnectMs);
    retry.unref?.();
  };

  const connect = async (): Promise<void> => {
    const next = options.createClient();
    next.onNotification((message) => {
      if (message.channel !== SECURITY_EVENTS_CHANNEL || message.payload === undefined) return;
      try {
        deliver(JSON.parse(message.payload) as SecurityEvent);
      } catch (error) {
        report(error);
      }
    });
    next.onError((error) => {
      current.listening = false;
      report(error);
      void next.end().catch(() => {});
      scheduleReconnect();
    });
    try {
      await next.connect();
      await next.query(`LISTEN ${SECURITY_EVENTS_CHANNEL}`);
      if (stopped) {
        await next.end();
        return;
      }
      client = next;
      current.listening = true;
    } catch (error) {
      current.listening = false;
      report(error);
      void next.end().catch(() => {});
      scheduleReconnect();
    }
  };

  await connect();

  return async () => {
    stopped = true;
    if (retry !== null) clearTimeout(retry);
    current.listening = false;
    if (bus === current) bus = null;
    await client?.end().catch(() => {});
  };
}

/** True when this process should use the shared bus (several API processes). */
export function sharedBusWanted(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env['SECURITY_EVENT_BUS'] === 'memory') return false;
  if (env['SECURITY_EVENT_BUS'] === 'postgres') return true;
  // PM2 cluster mode numbers its workers
  return env['NODE_APP_INSTANCE'] !== undefined;
}
