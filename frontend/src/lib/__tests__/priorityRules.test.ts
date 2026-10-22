import { describe, expect, it } from 'vitest';
import { needsAttention } from '../priorityRules';
import type { SecurityIncidentDto } from '../services/security.service';

const incident = (overrides: Partial<SecurityIncidentDto> = {}): SecurityIncidentDto => ({
  id: 1,
  incidentNumber: 'INC-TEST-1',
  title: 'fight',
  description: 'test',
  aiSummary: null,
  type: 'FIGHT',
  confidenceScore: 0.5,
  severity: 'MEDIUM',
  status: 'OPEN',
  location: 'Test Room',
  departmentName: null,
  reportedByName: 'Perception Service',
  assignedToId: null,
  assignedToName: null,
  occurredAt: '2026-10-12T10:00:00Z',
  resolvedAt: null,
  closedAt: null,
  rootCause: null,
  correctiveAction: null,
  createdAt: '2026-10-12T10:00:00Z',
  _count: { updates: 0, alerts: 0 },
  ...overrides,
});

describe('needsAttention — new incidents', () => {
  it('alerts at or above 90% confidence', () => {
    expect(needsAttention({ type: 'incident.created', incident: incident({ confidenceScore: 0.9 }) })).not.toBeNull();
    expect(needsAttention({ type: 'incident.created', incident: incident({ confidenceScore: 1 }) })).not.toBeNull();
  });

  it('stays quiet below 90% for ordinary event types', () => {
    expect(needsAttention({ type: 'incident.created', incident: incident({ confidenceScore: 0.89 }) })).toBeNull();
  });

  it('always alerts for CRITICAL severity and for fire/smoke', () => {
    expect(needsAttention({ type: 'incident.created', incident: incident({ severity: 'CRITICAL' }) })).not.toBeNull();
    expect(
      needsAttention({ type: 'incident.created', incident: incident({ type: 'FIRE_SMOKE', confidenceScore: 0.6 }) }),
    ).not.toBeNull();
  });

  it('never alerts for resolved or closed incidents', () => {
    expect(
      needsAttention({ type: 'incident.created', incident: incident({ confidenceScore: 1, status: 'CLOSED' }) }),
    ).toBeNull();
  });
});

describe('needsAttention — updated incidents', () => {
  it('alerts when an incident becomes CRITICAL (serious fall)', () => {
    const event = {
      type: 'incident.updated' as const,
      incident: incident({ type: 'FALL', severity: 'CRITICAL' }),
      previousSeverity: 'MEDIUM' as const,
    };
    expect(needsAttention(event)).not.toBeNull();
  });

  it('alerts when confidence crosses 90%', () => {
    const event = {
      type: 'incident.updated' as const,
      incident: incident({ confidenceScore: 0.97 }),
      previousSeverity: 'MEDIUM' as const,
      previousConfidence: 0.82,
    };
    expect(needsAttention(event)).not.toBeNull();
  });

  it('does not re-alert for updates that were already above the line', () => {
    const stillCritical = {
      type: 'incident.updated' as const,
      incident: incident({ severity: 'CRITICAL' }),
      previousSeverity: 'CRITICAL' as const,
    };
    const alreadyConfident = {
      type: 'incident.updated' as const,
      incident: incident({ confidenceScore: 0.99 }),
      previousSeverity: 'MEDIUM' as const,
      previousConfidence: 0.95,
    };
    expect(needsAttention(stillCritical)).toBeNull();
    expect(needsAttention(alreadyConfident)).toBeNull();
  });

  it('ignores deletions', () => {
    expect(needsAttention({ type: 'incident.deleted', incidentId: 1 })).toBeNull();
  });
});

describe('needsAttention — fights sent for review', () => {
  const review = incident({ confidenceScore: null, severity: 'MEDIUM' });

  it('does not pop up a fight that only needs checking', () => {
    expect(needsAttention({ type: 'incident.created', incident: review })).toBeNull();
  });

  it('pops up once the fight is confirmed and its confidence arrives', () => {
    expect(
      needsAttention({
        type: 'incident.updated',
        incident: { ...review, confidenceScore: 0.94 },
        previousSeverity: 'MEDIUM',
        previousConfidence: null,
      }),
    ).not.toBeNull();
  });
});

