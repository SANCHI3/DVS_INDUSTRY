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
- Rule engine for **crowd gathering and fall** (`temporal/rule_engine.py`)
  — event types with reliable geometric/kinematic signatures (see design
  doc §3/§5).
- Event confirmation tiering: CONFIRMED / PROBABLE / LOW_CONFIDENCE, so a
  single noisy frame never becomes an incident (`confirmation/event_confirmation.py`).
- Deterministic severity scoring with hard caps for policy-sensitive event
  types (`severity/severity_rules.py`).
- **Evidence extraction** (`evidence/clip_extractor.py`): a rolling raw-frame
  buffer (full resolution, separate from the downscaled inference frame) that
  saves a "before" clip + keyframes the instant an event confirms, and a
  matching "after" clip a few seconds later once the post-capture window
  completes.
- **Fight/violence detection** (`temporal/rgb_action_recognition.py` +
  `temporal/motion_gate.py` + `temporal/interaction.py`):
  - A cheap **motion-of-interest gate** runs every cycle on the tracks already
    in the temporal buffer (two people close together and moving) and decides
    whether the expensive video model is worth running at all.
  - When it is, the **R3D-18** 3D CNN (`rgb_fight_model/`) scores 1.5-second
    clips; 2 of the last 3 clips must score high.
  - A track-based **interaction check** then decides the tier: two distinct
    people close and moving in an agitated way → CONFIRMED fight; otherwise
    the fight is sent for operator review as PROBABLE ("Possible fight —
    please check", no pop-up). `fight_detection.interaction.mode`:
    `review` (default), `veto` or `off`.
    Grad-CAM heatmaps (`explain/gradcam.py`) are saved with each fight.
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
- Optional: add a `type: crowd` zone to check crowding in one area only
  (pixel coordinates at the configured `process_width`/`process_height`);
  without zones, crowding is checked on the whole frame.

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

### Demo mode (no camera)
```bash
python scripts/prepare_demo_videos.py   # copies 4 verified clips from data/ (or add your own)
python main.py --demo                   # loops demo_videos/ through the full pipeline
```
See [demo_videos/README.md](demo_videos/README.md). `../start-demo.ps1` /
`../start-demo.sh` also check prerequisites and start the backend and frontend.

Other options: `--output-dir DIR` (keeps test runs out of `output/`),
`--stats-json FILE` (FPS, per-stage timing and incident counts on exit) and
`--no-throttle` (benchmarking only).

**Missing optional parts do not stop the service.** If there is no CUDA GPU,
everything runs on the CPU. If there is no `LLM_API_KEY`, alerts use the
built-in description. If a model file is missing or is a Git LFS pointer, that
one detector is disabled with a message saying how to fix it, and the others
keep running.

## Verify the logic without a camera
```bash
python test_rules_logic.py       # rule engine + confirmation + severity, synthetic tracks
python test_evidence.py          # evidence buffer clip/keyframe extraction, synthetic frames
python test_false_positives.py   # normal activity vs genuine events (fight, fire/smoke, anomaly)
```
All three feed synthetic data directly into the relevant modules, so they
run without YOLO, real footage, or a GPU -- useful for quickly checking
your threshold changes didn't break anything.

## Train the fight model

Training, calibration and evaluation of the R3D-18 fight model are described in
[rgb_fight_model/README.md](rgb_fight_model/README.md).

## Next steps
1. Retrain the models on the factory's own CCTV footage (site adaptation).
2. PPE detection: fine-tune YOLO on a helmet/vest dataset.
3. Evidence retention/cleanup policy: `output/evidence/` only ever grows; add
   a scheduled cleanup once a storage policy is decided.
