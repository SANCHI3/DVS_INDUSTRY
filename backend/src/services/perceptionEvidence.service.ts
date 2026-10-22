import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { env } from '../config/env';

/**
 * Read-only access to what the perception service writes on disk:
 *
 *   <PERCEPTION_OUTPUT_DIR>/incidents.jsonl          one record per incident (full detail)
 *   <PERCEPTION_OUTPUT_DIR>/incident_updates.jsonl   escalations (tier / detail changes)
 *   <PERCEPTION_OUTPUT_DIR>/evidence_updates.jsonl   keyframe and clip paths
 *
 * The database keeps the incident itself; the AI explanation and evidence
 * stay with the perception service, joined on incidentNumber = incident_id.
 * No schema change is needed and nothing here writes.
 */

type Json = Record<string, unknown>;

export interface EvidenceFile {
  file: string; // path relative to the perception output dir, forward slashes
  kind: 'keyframe' | 'gradcam' | 'clip_before' | 'clip_after';
}

export interface IncidentEvidence {
  available: true;
  incidentId: string;
  cameraId: string | null;
  eventType: string;
  tier: string;
  confidenceScore: number | null;
  confidenceBasis: string | null;
  validationVersion: number | null;
  recommendedAction: string | null;
  explanation: { label: string; value: string }[];
  files: EvidenceFile[];
  /** Raw model output; only returned to administrators. */
  technical?: Json;
}

export type EvidenceResult = IncidentEvidence | { available: false; reason: string };

export function outputDir(): string {
  return path.resolve(env.PERCEPTION_OUTPUT_DIR);
}

async function* jsonLines(file: string): AsyncGenerator<Json> {
  if (!fs.existsSync(file)) return;
  const lines = readline.createInterface({ input: fs.createReadStream(file, 'utf8') });
  for await (const line of lines) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line) as Json;
    } catch {
      // a half-written last line while the perception service is appending
    }
  }
}

/** Map a path written by the perception service to one inside the output dir. */
export function toOutputRelative(written: string, base = outputDir()): string | null {
  const normal = written.replace(/\\/g, '/');
  let absolute: string;
  if (path.isAbsolute(normal)) absolute = path.resolve(normal);
  else if (normal.startsWith('output/'))
    absolute = path.resolve(base, normal.slice('output/'.length));
  else absolute = path.resolve(base, normal);
  const relative = path.relative(base, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join('/');
}

/** Text of a stored string/number field; anything else is treated as missing. */
const str = (v: unknown): string | null =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null;
const pct = (v: unknown) => (typeof v === 'number' ? `${Math.round(v * 100)}%` : null);

/** Plain-language explanation from the stored detector evidence (no new numbers). */
function explain(eventType: string, detail: Json): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const add = (label: string, value: string | null | undefined) => {
    if (value) out.push({ label, value });
  };
  const interaction = detail['interaction'] as Json | undefined;
  if (eventType === 'fight') {
    add('Model score', pct(detail['score']));
    if (interaction) {
      add('Why it is a fight', str(interaction['reason']));
      if (typeof interaction['close_seconds'] === 'number')
        add('Time people were close', `${interaction['close_seconds']} s`);
    }
  }
  if (eventType === 'fire_smoke') {
    const classes = detail['detected_classes'];
    add('Detected', Array.isArray(classes) ? classes.join(' and ') : null);
    add('Fire score (mean)', pct(detail['fire_score']));
    add('Smoke score (mean)', pct(detail['smoke_score']));
    const dynamics = detail['dynamics'] as Record<string, Json> | undefined;
    for (const [cls, d] of Object.entries(dynamics ?? {})) {
      add(`Movement check (${cls})`, str(d?.['reason']));
    }
    const verifier = detail['learned_verifier'] as Record<string, number> | undefined;
    for (const [cls, p] of Object.entries(verifier ?? {})) add(`Verifier (${cls})`, pct(p));
  }
  if (eventType === 'fall') {
    add('Fall model probability', pct(detail['score']));
    const reasons = detail['reasons'];
    if (Array.isArray(reasons)) add('Reasons', reasons.join('; '));
    if (detail['serious'])
      add('Person still down', `${Math.round(Number(detail['down_seconds']))} s`);
  }
  if (eventType === 'anomaly') {
    const factors = detail['top_factors'];
    if (Array.isArray(factors)) {
      add(
        'Most unusual about the motion',
        factors
          .map((f) => `${str((f as Json)['factor'])} (${pct((f as Json)['share'])})`)
          .join(', '),
      );
    }
    if (typeof detail['anomaly_ratio'] === 'number')
      add('Error vs normal level', `${detail['anomaly_ratio']}× this camera's threshold`);
  }
  if (eventType === 'crowd') {
    add('People in the group', str(detail['count']));
    if (typeof detail['sustained_seconds'] === 'number')
      add('For', `${detail['sustained_seconds']} s`);
  }
  // Lingering / restricted-area detection was removed; kept so evidence of
  // incidents recorded before the removal still displays.
  if (eventType === 'loitering' || eventType === 'intrusion') {
    add('Zone', str(detail['zone_name']));
    if (typeof detail['dwell_seconds'] === 'number')
      add('Time in zone', `${Math.round(detail['dwell_seconds'] as number)} s`);
  }
  return out;
}

export async function getIncidentEvidence(
  incidentNumber: string,
  includeTechnical: boolean,
): Promise<EvidenceResult> {
  const dir = outputDir();
  if (!fs.existsSync(path.join(dir, 'incidents.jsonl'))) {
    return {
      available: false,
      reason: 'The perception service output was not found on this server.',
    };
  }
  let report: Json | null = null;
  for await (const row of jsonLines(path.join(dir, 'incidents.jsonl'))) {
    if (row['incident_id'] === incidentNumber) report = row;
  }
  if (!report) {
    return { available: false, reason: 'No camera evidence is stored for this incident.' };
  }

  let detail = { ...((report['detail'] as Json) ?? {}) };
  let tier = str(report['confidence_tier']) ?? '';
  let confidence =
    typeof report['confidence_score'] === 'number' ? report['confidence_score'] : null;
  for await (const u of jsonLines(path.join(dir, 'incident_updates.jsonl'))) {
    if (u['incident_id'] !== incidentNumber) continue;
    if (u['detail']) detail = { ...detail, ...(u['detail'] as Json) };
    tier = str(u['confidence_tier']) ?? tier;
    if (typeof u['confidence_score'] === 'number')
      confidence = Math.max(confidence ?? 0, u['confidence_score']);
  }

  const evidence = { ...((report['evidence'] as Json) ?? {}) };
  for await (const u of jsonLines(path.join(dir, 'evidence_updates.jsonl'))) {
    if (u['incident_id'] === incidentNumber) Object.assign(evidence, u);
  }

  const files: EvidenceFile[] = [];
  const push = (written: unknown, kind: EvidenceFile['kind']) => {
    if (typeof written !== 'string') return;
    const file = toOutputRelative(written, dir);
    if (file && fs.existsSync(path.join(dir, file))) files.push({ file, kind });
  };
  for (const k of (evidence['keyframes'] as unknown[]) ?? []) push(k, 'keyframe');
  for (const g of (detail['gradcam_heatmaps'] as unknown[]) ?? []) push(g, 'gradcam');
  push(evidence['clip_before'], 'clip_before');
  push(evidence['clip_after'], 'clip_after');

  const eventType = str(report['event_type']) ?? '';
  const result: IncidentEvidence = {
    available: true,
    incidentId: incidentNumber,
    cameraId: (report['camera_id'] as string) ?? null,
    eventType,
    tier,
    confidenceScore: confidence,
    confidenceBasis: (detail['confidence_basis'] as string) ?? null,
    validationVersion:
      typeof detail['validation_version'] === 'number' ? detail['validation_version'] : null,
    recommendedAction: (report['recommended_action'] as string) ?? null,
    explanation: explain(eventType, detail),
    files,
  };
  if (includeTechnical) {
    const technical = { ...detail };
    delete technical['gradcam_heatmaps']; // served as files instead of local paths
    result.technical = technical;
  }
  return result;
}

/** Absolute path of an evidence file, only if it belongs to this incident. */
export async function resolveEvidenceFile(
  incidentNumber: string,
  file: string,
): Promise<string | null> {
  const evidence = await getIncidentEvidence(incidentNumber, false);
  if (!evidence.available || !evidence.files.some((f) => f.file === file)) return null;
  return path.join(outputDir(), file);
}
