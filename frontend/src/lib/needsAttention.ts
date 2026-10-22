/**
 * "Needs Attention" on the AI Security page: unresolved incidents, most
 * urgent first, plus today's per-type counts for the detection summary.
 */
import type { IncidentSeverity, IncidentType, SecurityIncidentDto } from './services/security.service';

const SEVERITY_RANK: Record<IncidentSeverity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

export function isUnresolved(incident: Pick<SecurityIncidentDto, 'status'>): boolean {
  return incident.status === 'OPEN' || incident.status === 'INVESTIGATING';
}

/** Unresolved incidents sorted by severity (CRITICAL first), then newest first. */
export function sortNeedsAttention<T extends Pick<SecurityIncidentDto, 'status' | 'severity' | 'occurredAt'>>(incidents: T[]): T[] {
  return incidents
    .filter(isUnresolved)
    .sort((a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
      || new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
}

/** Apply a live or local change: keep the incident while it is unresolved, drop it once it is not. */
export function upsertUnresolved(current: SecurityIncidentDto[], changed: SecurityIncidentDto): SecurityIncidentDto[] {
  const rest = current.filter((incident) => incident.id !== changed.id);
  return isUnresolved(changed) ? [changed, ...rest] : rest;
}

/** The detections the CCTV AI raises today; FIRE, SMOKE and FIRE_SMOKE are one row. */
const DETECTION_TYPES: Array<{ label: string; types: IncidentType[] }> = [
  { label: 'Fight', types: ['FIGHT'] },
  { label: 'Fall', types: ['FALL'] },
  { label: 'Fire / smoke', types: ['FIRE', 'SMOKE', 'FIRE_SMOKE'] },
  { label: 'Crowd', types: ['CROWD'] },
  { label: 'Unusual activity', types: ['OTHER'] },
];

export function detectionCountsByType(byType: Array<{ type: IncidentType; count: number }>): Array<{ label: string; count: number }> {
  return DETECTION_TYPES.map(({ label, types }) => ({
    label,
    count: byType.filter((item) => types.includes(item.type)).reduce((sum, item) => sum + item.count, 0),
  }));
}
