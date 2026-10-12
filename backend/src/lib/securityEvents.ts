import { EventEmitter } from 'events';
import type { SecurityIncidentDto } from '../interfaces';

/**
 * In-process pub/sub for security incident changes, consumed by the
 * Server-Sent Events stream (GET /api/v1/security/stream) so dashboards see
 * new and escalated incidents the moment they are written.
 *
 * Single-process only: with several backend instances this must move to a
 * shared bus (e.g. Postgres LISTEN/NOTIFY or Redis pub/sub).
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

const emitter = new EventEmitter();
// One listener per connected dashboard tab.
emitter.setMaxListeners(0);

export function publishSecurityEvent(event: SecurityEvent): void {
  emitter.emit('event', event);
}

export function subscribeSecurityEvents(listener: (event: SecurityEvent) => void): () => void {
  emitter.on('event', listener);
  return () => emitter.off('event', listener);
}
