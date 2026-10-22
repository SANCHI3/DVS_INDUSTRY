/**
 * Everyday-language labels for incidents, for staff without a technical
 * background (pop-up alerts and the incident table).
 */
import type { IncidentSeverity, SecurityIncidentDto } from './services/security.service';

const EVENT_LABELS: Record<string, string> = {
  FIGHT: 'Possible fight',
  FALL: 'Person has fallen',
  FIRE: 'Fire seen',
  SMOKE: 'Smoke seen',
  FIRE_SMOKE: 'Fire or smoke seen',
  CROWD: 'Crowd gathering',
  LOITERING: 'Someone lingering',
  INTRUSION: 'Person in restricted area',
  THEFT: 'Possible theft',
  OTHER: 'Unusual activity',
};

/** Detections removed from the system (no zone data). Old records keep their
 *  labels above, but these types are left out of current breakdowns. */
const RETIRED_TYPES = new Set(['LOITERING', 'INTRUSION']);

export function isRetiredIncidentType(type: string): boolean {
  return RETIRED_TYPES.has(type);
}

export function eventTypeLabel(type: string): string {
  return EVENT_LABELS[type] ?? type.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * A fight the camera AI sent for operator review: the fight model fired but
 * the camera tracks showed no interaction. It arrives without a confidence
 * score (so it never pops up) and gets one if the fight is later confirmed.
 */
export function isReviewFight(
  incident: Pick<SecurityIncidentDto, 'type'> & Partial<Pick<SecurityIncidentDto, 'confidenceScore' | 'reportedByName'>>,
): boolean {
  return incident.type === 'FIGHT' && incident.confidenceScore === null && incident.reportedByName === 'Perception Service';
}

/** Headline for an alert; a critical fall means the person has not got up. */
export function incidentHeadline(
  incident: Pick<SecurityIncidentDto, 'type' | 'severity'> & Partial<Pick<SecurityIncidentDto, 'confidenceScore' | 'reportedByName'>>,
): string {
  if (incident.type === 'FALL' && incident.severity === 'CRITICAL') return 'Fallen person not getting up';
  if (isReviewFight(incident)) return 'Possible fight — please check';
  return eventTypeLabel(incident.type);
}

/** How sure the AI is, in words, with the percentage for reference. */
export function confidenceLabel(score: number | null): string {
  if (score == null) return 'Unknown';
  const pct = `${Math.round(score * 100)}%`;
  if (score >= 0.9) return `Very likely (${pct})`;
  if (score >= 0.7) return `Likely (${pct})`;
  return `Possible (${pct})`;
}

const PRIORITY_LABELS: Record<IncidentSeverity, string> = {
  CRITICAL: 'Urgent: act now',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
};

export function priorityLabel(severity: IncidentSeverity): string {
  return PRIORITY_LABELS[severity];
}

/**
 * Text for the alert body: the AI summary when present, otherwise the
 * plain description. The description's "What to do: ..." advice is split
 * out so it can be shown on its own line.
 */
export function alertText(incident: Pick<SecurityIncidentDto, 'aiSummary' | 'description'>): {
  summary: string;
  action: string | null;
} {
  const [what, action] = incident.description.split(/\s*What to do:\s*/);
  if (incident.aiSummary) return { summary: incident.aiSummary, action: null };
  return { summary: (what ?? incident.description).trim(), action: action?.trim() || null };
}
