/**
 * Which security incidents interrupt the operator with a priority popup.
 * Pure rules, kept separate from the component so they can be unit tested.
 */
import type { SecurityStreamEvent } from './securityStream';
import type { SecurityIncidentDto } from './services/security.service';

/** Incidents at or above this AI confidence interrupt whatever page is open. */
export const PRIORITY_CONFIDENCE = 0.9;

/** Life-safety types always interrupt: the fire model's scores sit well below
 *  0.9 even on real flames, and these only reach the ERP once CONFIRMED. */
const ALWAYS_PRIORITY_TYPES = new Set(['FIRE', 'SMOKE', 'FIRE_SMOKE']);

export function needsAttention(event: SecurityStreamEvent): SecurityIncidentDto | null {
  if (event.type === 'incident.deleted') return null;
  const incident = event.incident;
  if (incident.status === 'RESOLVED' || incident.status === 'CLOSED') return null;
  if (event.type === 'incident.created') {
    const confident = (incident.confidenceScore ?? 0) >= PRIORITY_CONFIDENCE;
    const lifeSafety = ALWAYS_PRIORITY_TYPES.has(incident.type);
    return confident || lifeSafety || incident.severity === 'CRITICAL' ? incident : null;
  }
  // An existing incident that just became critical (e.g. a fall where the
  // person did not get back up), or whose confidence just crossed the
  // priority threshold -- detections usually start uncertain and firm up
  // seconds later, so checking only at creation would miss most of them.
  const becameCritical = incident.severity === 'CRITICAL' && event.previousSeverity !== 'CRITICAL';
  const becameConfident =
    event.previousConfidence !== undefined &&
    (event.previousConfidence ?? 0) < PRIORITY_CONFIDENCE &&
    (incident.confidenceScore ?? 0) >= PRIORITY_CONFIDENCE;
  return becameCritical || becameConfident ? incident : null;
}
