# CCTV Perception Pipeline (Phase 1–2 Prototype)

Implements the fast + gated path of the architecture: **ingestion → YOLO
detection → ByteTrack tracking → temporal buffer → rule engine (+ gated
fight detection) → event confirmation → severity scoring → evidence
extraction → incident report (JSON lines)**.

This is essentially the full perception service end-to-end, minus PPE
detection and the real backend connection — see design doc Phase 1-4.

## What's implemented
- Decoupled capture/processing (`ingestion/stream_reader.py`) so live feeds
  don't lag when inference is slower than camera FPS. Cleanly exits when a
  video-file source ends (distinct from a live-RTSP disconnect, which retries).
- YOLOv8 detection filtered to relevant classes (`detection/yolo_detector.py`).
- ByteTrack identity tracking (`tracking/byte_tracker.py`).
- Rolling per-track temporal history (`temporal/temporal_buffer.py`).
- Rule engine for **intrusion, loitering, crowd gathering, and fall**
  (`temporal/rule_engine.py`) — the four event types that have reliable
  geometric/kinematic signatures (see design doc §3/§5).
- Event confirmation tiering: CONFIRMED / PROBABLE / LOW_CONFIDENCE, so a
  single noisy frame never becomes an incident (`confirmation/event_confirmation.py`).
- Deterministic severity scoring with hard caps for policy-sensitive event
  types (`severity/severity_rules.py`).
- **Evidence extraction** (`evidence/clip_extractor.py`): a rolling raw-frame
  buffer (full resolution, separate from the downscaled inference frame) that
  saves a "before" clip + keyframes the instant an event confirms, and a
  matching "after" clip a few seconds later once the post-capture window
  completes.
- **Fight/violence detection** (`temporal/action_recognition.py` +
  `temporal/motion_gate.py` + `detection/pose_estimator.py` +
  `temporal/fight_features.py`) — the one event type genuinely gated behind
  a learned/learnable model rather than pure rules:
  - A cheap **motion-of-interest gate** runs every cycle on data already in
    the temporal buffer (proximity + combined speed) and decides whether
    it's worth paying for pose estimation at all — the expensive model
    never runs continuously.
  - When the gate fires, **YOLOv8-Pose** extracts keypoints for the
    candidate pair, which get normalized into a per-frame feature vector
    and accumulated into a short rolling pose-sequence per pair.
  - That sequence is scored by either a **heuristic** (default — hand-crafted
    jerkiness + proximity scoring, works out of the box, no training data
    needed) or a **trained PoseSequenceLSTM** (`training/train_fight_lstm.py`,
    switch on via `fight_detection.mode: "model"` once you've trained a
    checkpoint on your own recorded footage).
  - **Be honest about this one**: the heuristic is a rough proxy, not a
    validated classifier — expect real false positives/negatives. See
    design doc §0/§23 on why fight detection is explicitly the least
    reliable event type here, and why it's capped by confirmation
    persistence rather than trusted on a single reading.
- Template-based incident description generation + JSON-lines "incident
  report" persistence, standing in for the future backend API
  (`reporting/`). Evidence paths are attached via `update_evidence()`,
  which appends to `output/evidence_updates.jsonl` — a stand-in for a
  future `PATCH /api/incidents/{id}/evidence` call.

## Setup
```bash
pip install -r requirements.txt --break-system-packages   # drop the flag outside a managed env
```
First run will auto-download `yolov8n.pt` (~6MB) via Ultralytics.

## Configure
Edit `config/cameras.yaml`:
- Set `source` to `"0"` for a webcam, an RTSP URL, or a video file path.
- Adjust the `zones` polygons to match your actual camera framing (pixel
  coordinates at the configured `process_width`/`process_height`).

Edit `config/thresholds.yaml` to tune detection confidence, rule
thresholds, and confirmation persistence requirements.

## Run
```bash
# webcam, with a live annotated window
python main.py --camera CAM-01

# headless (no display), against a test video, for 30 seconds
python main.py --camera CAM-01 --source path/to/video.mp4 --no-display --max-seconds 30
```
Confirmed/Probable incidents are appended to `output/incidents.jsonl`, one
JSON object per line, and printed to the console.

## Verify the logic without a camera
```bash
python test_rules_logic.py       # rule engine + confirmation + severity, synthetic tracks
python test_evidence.py          # evidence buffer clip/keyframe extraction, synthetic frames
python test_fight_detection.py   # motion gate, feature vectors, heuristic scoring, full wiring
```
All three feed synthetic data directly into the relevant modules, so they
run without YOLO, real footage, or a GPU -- useful for quickly checking
your threshold changes didn't break anything.

## Train the real fight model

The synthetic checkpoint is only a wiring test. For real training, place labelled videos in:

```text
data/fight_videos/fight/
data/fight_videos/not_fight/
```

Include hard negatives such as running, hugging, dancing, playing, pushing, crowded movement and normal interaction. Then run:

```bash
python -m fight_model.extract_features --input data/fight_videos --output data/fight_features --camera-id CAM-01
python fight_model/train.py --manifest data/fight_features/manifest.csv --output models/fight_lstm.pt --epochs 40
```

After reviewing real validation/test metrics, update `config/thresholds.yaml`:

```yaml
fight_detection:
  mode: model
  model_checkpoint: "models/fight_lstm.pt"
```

Do not enable model mode with `fight_lstm_demo.pt`; that checkpoint learned synthetic patterns only.

## Next steps (see main design doc)
1. **Loitering zone_id cleanup**: currently `zone_entry_times` isn't pruned
   when a track goes stale — fine for a demo, worth hardening before longer
   runs.
2. Wire `reporting/incident_report.py`'s `save()`/`update_evidence()` to
   call the Spring Boot backend once it exists, instead of writing local
   JSON lines.
3. PPE detection: fine-tune YOLO on a helmet/vest dataset and add a
   `_check_ppe_violation` rule (needs a "required zone" + "no helmet class
   detected on this person's crop" check).
4. Evidence retention/cleanup policy — the current buffer only ever grows
   `output/evidence/`; add a cron/scheduled cleanup once storage policy is
   decided (see design doc §10 on why raw video shouldn't live in MongoDB).
5. Collect footage and train the fight-detection LSTM (see above) — this
   is the highest-value next step for demo accuracy.

## Added models (see ../ML_AND_ANALYTICS_UPGRADE.md)
- `fall_gru/` + `temporal/fall_gru_recognition.py`: pose-sequence temporal CNN + BiGRU fall model
  (`models/fall_gru_v1.pt`, default; CV F1 0.90, AUC 0.96).
- `fall_rf/` + `temporal/pose_fall_recognition.py`: biomechanical features + Random Forest (alternative).
- `fire_verifier/`: learned fire/smoke verifier (`models/fire_smoke_verifier_v1.pkl`, default;
  fire false alarms 2 -> 0). `temporal/fire_verifier.py`: rule-based alternative.
- `anomaly/` + `temporal/scene_anomaly.py`: unsupervised optical-flow autoencoder (`models/scene_anomaly_ae_v1.npz`).
- `explain/gradcam.py`: Grad-CAM heatmaps for the R3D-18 fight model, saved with fight incidents.
- Tests: `test_learned_models.py`, `test_scene_anomaly.py`, `test_fall_model.py`, `test_fire_verifier.py`.
