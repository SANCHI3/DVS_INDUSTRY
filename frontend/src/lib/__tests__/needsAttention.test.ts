import { describe, expect, it } from 'vitest';
import { detectionCountsByType, sortNeedsAttention, upsertUnresolved } from '../needsAttention';
import type { SecurityIncidentDto } from '../services/security.service';

const incident = (id: number, severity: SecurityIncidentDto['severity'], status: SecurityIncidentDto['status'], occurredAt: string) =>
  ({ id, severity, status, occurredAt }) as SecurityIncidentDto;

describe('needs attention', () => {
  it('sorts unresolved incidents by severity, then newest first', () => {
    const sorted = sortNeedsAttention([
      incident(1, 'LOW', 'OPEN', '2026-10-17T10:00:00Z'),
      incident(2, 'CRITICAL', 'INVESTIGATING', '2026-10-17T08:00:00Z'),
      incident(3, 'HIGH', 'OPEN', '2026-10-17T09:00:00Z'),
      incident(4, 'CRITICAL', 'OPEN', '2026-10-17T09:30:00Z'),
      incident(5, 'HIGH', 'OPEN', '2026-10-17T11:00:00Z'),
      incident(6, 'MEDIUM', 'OPEN', '2026-10-17T07:00:00Z'),
    ]);
    expect(sorted.map((item) => item.id)).toEqual([4, 2, 5, 3, 6, 1]);
  });

  it('leaves out resolved and closed incidents', () => {
    const sorted = sortNeedsAttention([
      incident(1, 'CRITICAL', 'RESOLVED', '2026-10-17T10:00:00Z'),
      incident(2, 'CRITICAL', 'CLOSED', '2026-10-17T10:00:00Z'),
      incident(3, 'LOW', 'OPEN', '2026-10-17T10:00:00Z'),
    ]);
    expect(sorted.map((item) => item.id)).toEqual([3]);
  });

  it('keeps a live change while unresolved and drops it once resolved', () => {
    const list = [incident(1, 'HIGH', 'OPEN', '2026-10-17T10:00:00Z')];
    const investigating = upsertUnresolved(list, incident(1, 'HIGH', 'INVESTIGATING', '2026-10-17T10:00:00Z'));
    expect(investigating).toHaveLength(1);
    expect(investigating[0].status).toBe('INVESTIGATING');
    expect(upsertUnresolved(investigating, incident(1, 'HIGH', 'RESOLVED', '2026-10-17T10:00:00Z'))).toEqual([]);
    expect(upsertUnresolved([], incident(2, 'LOW', 'OPEN', '2026-10-17T10:00:00Z'))).toHaveLength(1);
  });

  it('counts today only for the current detection types, fire and smoke together', () => {
    expect(detectionCountsByType([
      { type: 'FIRE', count: 1 },
      { type: 'SMOKE', count: 2 },
      { type: 'FALL', count: 4 },
      { type: 'OTHER', count: 3 },
      { type: 'LOITERING', count: 7 },
      { type: 'INTRUSION', count: 5 },
    ])).toEqual([
      { label: 'Fight', count: 0 },
      { label: 'Fall', count: 4 },
      { label: 'Fire / smoke', count: 3 },
      { label: 'Crowd', count: 0 },
      { label: 'Unusual activity', count: 3 },
    ]);
  });
});
