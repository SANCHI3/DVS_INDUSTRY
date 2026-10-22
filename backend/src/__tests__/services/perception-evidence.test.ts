import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env';

vi.mock('../../config/env', () => ({
  env: { PERCEPTION_OUTPUT_DIR: '' },
}));
import {
  getIncidentEvidence,
  resolveEvidenceFile,
  toOutputRelative,
} from '../../services/perceptionEvidence.service';

const ID = 'INC-20261015-ABC123';
let root: string;
let out: string;

const line = (o: unknown) => JSON.stringify(o) + '\n';

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-test-'));
  out = path.join(root, 'output');
  fs.mkdirSync(path.join(out, 'evidence', 'CAM-01'), { recursive: true });
  fs.mkdirSync(path.join(out, 'evidence', 'gradcam'), { recursive: true });
  fs.writeFileSync(path.join(out, 'evidence', 'CAM-01', `${ID}_frame0.jpg`), 'jpg');
  fs.writeFileSync(path.join(out, 'evidence', 'gradcam', 'g1.jpg'), 'jpg');
  fs.writeFileSync(path.join(root, 'secret.txt'), 'not evidence');
  fs.writeFileSync(
    path.join(out, 'incidents.jsonl'),
    line({ incident_id: 'INC-OTHER', event_type: 'fall', detail: {} }) +
      line({
        incident_id: ID,
        camera_id: 'CAM-01',
        event_type: 'fight',
        confidence_tier: 'PROBABLE',
        confidence_score: 0.9,
        recommended_action: 'Send security.',
        detail: {
          score: 0.97,
          confidence_basis: 'mean R3D-18 fight probability',
          validation_version: 2,
          interaction: {
            reason: 'two people close together with agitated motion',
            close_seconds: 1.2,
          },
          gradcam_heatmaps: [
            'output/evidence/gradcam/g1.jpg',
            'output/evidence/gradcam/missing.jpg',
          ],
        },
        evidence: { keyframes: [] },
      }) +
      '{"half-written',
  );
  fs.writeFileSync(
    path.join(out, 'incident_updates.jsonl'),
    line({ incident_id: ID, confidence_tier: 'CONFIRMED', confidence_score: 0.95 }),
  );
  fs.writeFileSync(
    path.join(out, 'evidence_updates.jsonl'),
    line({
      incident_id: ID,
      keyframes: [`output/evidence\\CAM-01\\${ID}_frame0.jpg`, '../secret.txt'],
    }),
  );
  Object.assign(env, { PERCEPTION_OUTPUT_DIR: out });
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('perception evidence', () => {
  it('maps written paths into the output dir and rejects paths outside it', () => {
    expect(toOutputRelative('output/evidence\\CAM-01\\a.jpg', out)).toBe('evidence/CAM-01/a.jpg');
    expect(toOutputRelative(path.join(out, 'evidence', 'x.jpg'), out)).toBe('evidence/x.jpg');
    expect(toOutputRelative('../secret.txt', out)).toBeNull();
    expect(toOutputRelative(path.join(root, 'secret.txt'), out)).toBeNull();
  });

  it('joins the incident with its updates and existing evidence files', async () => {
    const result = await getIncidentEvidence(ID, false);
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.tier).toBe('CONFIRMED');
    expect(result.confidenceScore).toBe(0.95);
    expect(result.confidenceBasis).toBe('mean R3D-18 fight probability');
    expect(result.files).toEqual([
      { file: `evidence/CAM-01/${ID}_frame0.jpg`, kind: 'keyframe' },
      { file: 'evidence/gradcam/g1.jpg', kind: 'gradcam' },
    ]);
    expect(result.explanation).toContainEqual({
      label: 'Why it is a fight',
      value: 'two people close together with agitated motion',
    });
    expect(result.technical).toBeUndefined();
  });

  it('includes raw model output only when asked (administrators)', async () => {
    const result = await getIncidentEvidence(ID, true);
    expect(result.available && result.technical?.['score']).toBe(0.97);
    expect(result.available && result.technical?.['gradcam_heatmaps']).toBeUndefined();
  });

  it('serves only files that belong to the incident', async () => {
    expect(await resolveEvidenceFile(ID, 'evidence/gradcam/g1.jpg')).toBe(
      path.join(out, 'evidence/gradcam/g1.jpg'),
    );
    expect(await resolveEvidenceFile(ID, '../secret.txt')).toBeNull();
    expect(await resolveEvidenceFile('INC-OTHER', 'evidence/gradcam/g1.jpg')).toBeNull();
  });

  it('reports unknown incidents without failing', async () => {
    expect((await getIncidentEvidence('INC-NONE', false)).available).toBe(false);
  });
});
