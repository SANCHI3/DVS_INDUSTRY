# False-positive fixes (validation version 2)

The Incident Center was filling with incidents during normal activity in the
test room: "Lingering" at 76–77 %, "Unusual activity" at 94 %, "Smoke has been
seen" at 80 %, and fights. All of them were created on 15 Oct 2026 between
11:27 and 11:37, so they were **new detections, not old database records**.
This document traces each one through the pipeline, gives the root cause, and
describes the fix.

```
StreamReader → YOLOv8 → ByteTrack → TemporalBuffer
   → RuleEngine (crowd, fall)
   → RgbFightDetector · FireSmokeDetector · GruFallDetector · SceneAnomalyDetector
   → EventConfirmation (N-of-M tiers) → severity → IncidentDeduper
   → IncidentReporter (incidents.jsonl; CONFIRMED only → backend → SSE → dashboard)
   → LLM summary (text only, validated, template fallback)
```

The LLM was **not** the cause. It only rewrites the plain description, it is
rejected if it adds numbers, jargon or drops the location, and it can't
set the event type, severity or confidence (`IncidentAnalysis` has no such
fields; this is covered by a test now).

## Root causes and fixes

### Lingering

Lingering and restricted-area detection have since been removed: no floor
plan or zone data is available for the plant. Old lingering records stay in
the dashboard as history.

### Fight

| Root cause | Fix |
|---|---|
| The motion gate paired ghost tracks too: after an ID switch, one person's old and new IDs became a "pair". | Gate uses active tracks only and treats near-identical boxes (IoU ≥ 0.7) as one person. |
| Gate speed came from the last two samples, so box jitter alone (≥ 30 px/s at 10 fps) opened it. | Speed is measured over ~0.5 s. |
| A fight incident was created from the R3D-18 clip score alone. On this camera the model (trained on other footage) scores ordinary activity high. | `InteractionValidator` (`temporal/interaction.py`) must also pass. It needs two distinct people, close together (centre distance ≤ 1.2 × body height) for ≥ 1 s of the last 3 s, with agitated motion (≥ 0.1 body heights of erratic box movement and shape change). Walking past, standing and talking don't qualify. Grappling people merged into one box stay valid for 2 s. Rejections are logged with the evidence. |
| Confidence = the latest single clip score. | Mean score of the high-scoring clips in the persistence window. Interaction evidence is stored in the incident. |

### Fire / smoke

| Root cause | Fix |
|---|---|
| A static look-alike (orange object, lamp, grey wall, window) is detected the same way frame after frame. Frame persistence alone turned that into an alarm. | `RegionDynamics` (`temporal/fire_dynamics.py`) compares change inside the detected box with the median change in the rest of the frame. Flames must flicker, or smoke must have grown compared with the scene 8–30 s earlier, by ≥ 2× the background. Global changes (auto-exposure, lights dimming) affect inside and outside equally and are rejected. The check uses the frames already evaluated, so it adds no delay. |
| The learned verifier kept its last 10 verdicts forever. Two approvals from an earlier episode let any later burst of YOLO detections straight through. | `LearnedFireVerifier.reset(class)` is called when YOLO persistence for that class ends. |
| Confidence = peak single-frame score in the window. | Mean YOLO score over the positive frames (the peak is kept as `fire_peak_score` / `smoke_peak_score`). |

Responsiveness is unchanged. A flickering flame still raises an alarm after
3 of 5 evaluations (about 1 s) and is CONFIRMED after 3 s, or at once with
smoke. Smoke that appears in a scene the camera has already watched passes
through the growth check without waiting.

### Unusual activity (scene anomaly)

| Root cause | Fix |
|---|---|
| The autoencoder's threshold came from its training footage (a different site and viewpoint). Normal movement in the test room was permanently above it, which gave an "Unusual activity" incident after every cooldown. | Per-camera calibration: for the first `calibration.seconds` (300 s) the detector records error ratios **without alerting**. The camera threshold is then the 99th percentile (never below the model's own). It is saved to `output/calibration/scene_anomaly_<camera>.json`, keyed to the checkpoint, and reused on restart. |
| Confidence = `1 − e^(−ratio)` (≥ 63 % for anything over threshold, 94 % at 2.8×). | Anomaly score `ratio/(ratio+1)` relative to the camera's threshold: 0.5 = edge of normal, 0.67 = 2×, 0.75 = 3×. It's stored as a score, not a probability (`confidence_basis`). |

## Integrity of what is reported

- Every incident's `detail` now has `confidence_basis` (how the number was
  obtained) and `validation_version: 2`. The bbox fall rule's fixed 0.7 is
  replaced by measured detector confidence.
- Event types map as before (`anomaly` → `OTHER`, title `anomaly`).
- Duplicates: one ongoing event is one incident (`IncidentDeduper`, per
  camera and event type).

## Old vs new records (nothing is deleted)

- Dashboard database: from `backend/`, run
  `npm run audit:incidents -- --cutoff <time the fixed service was started>`.
  This is read-only (SELECT only). It groups perception-service incidents by
  day, type and location, splits them before/after the cutoff, and flags
  confidence values that match the old formulas.
- Local log: from `perception-service/`, run
  `python scripts/audit_incident_log.py`. Records without `validation_version`
  are from before this fix.

Review or close the old records from the dashboard. They are kept as history.

## Logs

Rejected candidates are logged (rate-limited, every 10 s per source) with the
measured evidence. For example:

```
[CAM-01] fight rejected despite model score 0.91: motion is not agitated (agitation 0.03 < 0.1 body heights) ...
[CAM-01] fire/smoke smoke rejected: region is static (changes no more than the rest of the scene) {...}
[CAM-01] scene-anomaly calibrated on 148 windows: p99 ratio 3.41 -> camera threshold 3.41x model threshold
```

Diagnostics at shutdown now include `alarms_rejected_static_region`,
`rejected_no_interaction`, `calibration_windows` and `camera_scale`.

## Tests

`python test_false_positives.py` runs 18 scenarios without a camera, GPU, torch
or ultralytics:

- **Normal activity:**
  - people standing or talking close together
  - walking past each other
  - one person with two IDs
  - a ghost track
  - agitated people far apart
  - a static orange object
  - auto-exposure change
  - someone walking elsewhere in the scene
  - an uncalibrated busy camera
  - a high fight-model score without interaction
- **Genuine events:**
  - an agitated close pair, including through `RgbFightDetector`
  - a flickering flame (confirmed, mean confidence)
  - slowly growing smoke
  - abnormal motion after calibration
- **Reporting:**
  - LLM output can't change the type or confidence, or add facts

## Remaining limitations

- **Anomaly detection is silent for the first 5 minutes** on each camera (or
  after `recalibrate: true`). Calibrate while the scene is normal. If an
  incident happens during calibration it raises the threshold.
- **The fight model still has a domain gap.** The interaction check removes
  the cases where the tracks show no fight, but the R3D-18 clip classifier
  itself was not retrained (no weights changed). The thresholds in
  `fight_detection.interaction` come from synthetic box tracks. Tune them from
  the logged `agitation` values on real footage if needed.
- **The fire region check** can't reject a static look-alike that something
  moves in front of, such as a person walking across an orange object. The
  learned verifier remains the second stage for that.
- **Not verified on the live database.** The audit scripts were written but not
  run against the database, because this work was done without access to the
  machine running the backend. The screenshot timestamps show the false
  incidents were newly generated.
- **Tests that need torch, ultralytics, supervision or fastapi** were not run in
  this environment (`test_learned_models`, `test_rgb_sampling`,
  `test_cctv_input`, `test_incident_api`).
  Run them locally.
