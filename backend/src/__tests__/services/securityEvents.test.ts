/**
 * Live incident events: in-process delivery for one backend process, and the
 * Postgres LISTEN/NOTIFY relay used when several PM2 workers serve dashboards.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  SECURITY_EVENTS_CHANNEL,
  publishSecurityEvent,
  serialiseSecurityEvent,
  sharedBusWanted,
  startSecurityEventBus,
  subscribeSecurityEvents,
  type ListenClient,
  type SecurityEvent,
} from '../../lib/securityEvents';
import type { SecurityIncidentDto } from '../../interfaces';

const incident = (overrides: Partial<SecurityIncidentDto> = {}) =>
  ({
    id: 7,
    incidentNumber: 'INC-7',
    title: 'fall',
    description: 'A person fell near press 3.',
    aiSummary: null,
    type: 'FALL',
    severity: 'HIGH',
    status: 'OPEN',
    ...overrides,
  }) as SecurityIncidentDto;

const created: SecurityEvent = { type: 'incident.created', incident: incident() };

/** A stand-in for Postgres: NOTIFY reaches every client that LISTENs. */
function fakePostgres() {
  const listeners: Array<(m: { channel: string; payload?: string }) => void> = [];
  const errorHandlers: Array<(e: Error) => void> = [];
  const clients: ListenClient[] = [];
  const createClient = (): ListenClient => {
    const client: ListenClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue(undefined),
      onNotification: (l) => listeners.push(l),
      onError: (l) => errorHandlers.push(l),
      end: vi.fn().mockResolvedValue(undefined),
    };
    clients.push(client);
    return client;
  };
  const notify = vi.fn(async (channel: string, payload: string) => {
    for (const l of listeners) l({ channel, payload });
  });
  /** Another worker publishing through the same database. */
  const fromOtherWorker = (event: SecurityEvent) =>
    listeners.forEach((l) =>
      l({ channel: SECURITY_EVENTS_CHANNEL, payload: JSON.stringify(event) }),
    );
  const dropConnection = () => errorHandlers.at(-1)?.(new Error('connection lost'));
  return { createClient, notify, fromOtherWorker, dropConnection, clients };
}

let stop: (() => Promise<void>) | null = null;
afterEach(async () => {
  await stop?.();
  stop = null;
  vi.useRealTimers();
});

describe('security events in one process', () => {
  it('reach every subscriber once', () => {
    const received = vi.fn();
    const unsubscribe = subscribeSecurityEvents(received);
    publishSecurityEvent(created);
    unsubscribe();
    publishSecurityEvent(created);
    expect(received).toHaveBeenCalledTimes(1);
    expect(received).toHaveBeenCalledWith(created);
  });
});

describe('security events across PM2 workers (Postgres LISTEN/NOTIFY)', () => {
  it('LISTENs on the channel and publishes through NOTIFY, delivering once', async () => {
    const pg = fakePostgres();
    stop = await startSecurityEventBus({ createClient: pg.createClient, notify: pg.notify });
    const received = vi.fn();
    const unsubscribe = subscribeSecurityEvents(received);

    publishSecurityEvent(created);
    await vi.waitFor(() => expect(received).toHaveBeenCalledTimes(1));

    expect(pg.clients[0]!.query).toHaveBeenCalledWith(`LISTEN ${SECURITY_EVENTS_CHANNEL}`);
    expect(pg.notify).toHaveBeenCalledWith(SECURITY_EVENTS_CHANNEL, JSON.stringify(created));
    expect(received.mock.calls[0]![0]).toMatchObject({
      type: 'incident.created',
      incident: { id: 7 },
    });
    unsubscribe();
  });

  it("forwards another worker's incident to this worker's dashboards", async () => {
    const pg = fakePostgres();
    stop = await startSecurityEventBus({ createClient: pg.createClient, notify: pg.notify });
    const received = vi.fn();
    const unsubscribe = subscribeSecurityEvents(received);

    pg.fromOtherWorker({ type: 'incident.deleted', incidentId: 42 });

    expect(received).toHaveBeenCalledWith({ type: 'incident.deleted', incidentId: 42 });
    unsubscribe();
  });

  it('falls back to this process while the listener reconnects', async () => {
    vi.useFakeTimers();
    const pg = fakePostgres();
    const onError = vi.fn();
    stop = await startSecurityEventBus({
      createClient: pg.createClient,
      notify: pg.notify,
      onError,
      reconnectMs: 1_000,
    });
    const received = vi.fn();
    const unsubscribe = subscribeSecurityEvents(received);

    pg.dropConnection();
    publishSecurityEvent(created);
    expect(received).toHaveBeenCalledTimes(1);
    expect(pg.notify).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(pg.clients).toHaveLength(2); // reconnected
    unsubscribe();
  });

  it('still delivers locally when NOTIFY itself fails', async () => {
    const pg = fakePostgres();
    pg.notify.mockRejectedValueOnce(new Error('db down'));
    stop = await startSecurityEventBus({ createClient: pg.createClient, notify: pg.notify });
    const received = vi.fn();
    const unsubscribe = subscribeSecurityEvents(received);

    publishSecurityEvent(created);
    await vi.waitFor(() => expect(received).toHaveBeenCalledTimes(1));
    unsubscribe();
  });
});

describe('serialiseSecurityEvent', () => {
  it('keeps payloads under the 8000-byte NOTIFY limit', () => {
    const big: SecurityEvent = {
      type: 'incident.updated',
      incident: incident({ description: 'x'.repeat(20_000), aiSummary: 'y'.repeat(20_000) }),
    };
    const payload = serialiseSecurityEvent(big);
    expect(Buffer.byteLength(payload)).toBeLessThan(8_000);
    expect(JSON.parse(payload).incident.id).toBe(7);
  });
});

describe('sharedBusWanted', () => {
  it('turns on under PM2 cluster mode or when asked, and stays off for one process', () => {
    expect(sharedBusWanted({})).toBe(false);
    expect(sharedBusWanted({ NODE_APP_INSTANCE: '0' })).toBe(true);
    expect(sharedBusWanted({ SECURITY_EVENT_BUS: 'postgres' })).toBe(true);
    expect(sharedBusWanted({ NODE_APP_INSTANCE: '1', SECURITY_EVENT_BUS: 'memory' })).toBe(false);
  });
});
