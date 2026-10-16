# 4. Module description

## 4.1 ERP modules (backend + dashboard)

| Module | API prefix | Purpose |
|---|---|---|
| Auth | `/api/v1/auth` | Login, refresh, logout, password change/reset; JWT access tokens and HttpOnly refresh cookies; bcrypt password hashes |
| Departments, Employees, Workforce | `/departments`, `/employees`, `/workforce` | Employee lifecycle, shifts, attendance (clock-in/out, bulk mark, trends) |
| Inventory | `/inventory` | Materials, stock transactions, scrap |
| Orders | `/orders` | Suppliers, clients, client orders, purchase orders |
| Production | `/production` | Work orders, recorded output, KPIs and trends |
| Security | `/security` | Incidents, incident history, alerts, KPIs, live SSE stream, AI summary, escalation, **evidence** |
| Reports, Audit | `/reports`, `/audit` | Module reports; audit trail of every successful write |
| Smart Analytics | `/analytics` | Demand forecasting (Holt / Croston–SBA), dynamic reorder point, ABC-XYZ, stock anomalies, OEE-style index + SPC, supplier scorecard, Plant Health Index |

**Roles:** ADMIN, MANAGER, HR, PRODUCTION, STORE, SALES, SUPPLIER, CLIENT,
and the service role PERCEPTION_SERVICE. Each route declares the roles it
accepts. For example, Store users get HTTP 403 on security data, and only
ADMIN receives raw model output in the evidence view.

## 4.2 Perception modules

For each model: what it detects, the model type, why it was chosen over plain
YOLO, and its evaluated score (from [../RESULTS.md](../RESULTS.md)).

### People detection and tracking: YOLOv8n + ByteTrack
- **Detects:** people and selected objects in each frame (COCO-pretrained YOLOv8n,
  confidence ≥ 0.35), and keeps a stable ID per person (ByteTrack).
- **Role:** the first stage. Everything person-related builds on the tracks,
  stored for 30 s in a temporal buffer.
- **Score:** pretrained model, not re-evaluated in this project.

### Rule engine: crowd (`temporal/rule_engine.py`)
- **Detects:** 4 or more people grouped for 5 s, on the whole frame (or in an
  optional crowd zone).
- **Why rules:** these are defined by geometry and time, not appearance. Rules
  are exact, explainable and need no training data.
- **Safeguards:** only recently seen tracks count, so ghost tracks are
  ignored, and confidence is the mean detector confidence of the group.

### Fight: R3D-18 + interaction check (`temporal/rgb_action_recognition.py`, `temporal/interaction.py`)
- **Detects:** fighting, punching or shoving.
- **Model:** R3D-18 3D CNN on 16-frame RGB clips sampled at 10 frames per
  second of real time, Kinetics-pretrained and fine-tuned. A clip is scored
  every 4 frames, and an alert needs 2 of 3 consecutive clips ≥ 0.55. A motion
  gate runs the classifier only when people are close and moving.
- **Why not YOLO:** a fight is defined by motion across frames; any single
  frame looks like people standing together. A 3D CNN learns spatio-temporal
  patterns directly.
- **Interaction check:** the classifier is trained on other footage and can
  score ordinary activity high. A fight incident therefore also needs two
  distinct tracked people, close (≤ 1.2 body heights) for ≥ 1 s of the last
  3 s, with agitated box motion (≥ 0.1 body heights).
- **Score:** v2 on 344 test videos with the live 2-of-3 rule: precision 0.94,
  recall 0.97, **F1 0.96**, AUC 0.99. v1 (trained with frame-stride sampling)
  reached F1 0.85.
- **Explainability:** Grad-CAM heatmaps (3 per confirmed fight).

### Fall: YOLOv8-Pose + temporal CNN + BiGRU (`fall_gru/`, `temporal/fall_gru_recognition.py`)
- **Detects:** a person falling to the ground, and escalates to CRITICAL if the
  person is still down after 20 s.
- **Model:** per frame, 15 box and skeleton features (torso tilt, hip/head
  position, extents, velocities). A temporal CNN + bidirectional GRU scores
  4-second windows, and 2 of the last 3 evaluations must exceed the threshold.
- **Why not YOLO or a box rule:** the deployed aspect-ratio rule waited for
  5 s of stillness and missed falls towards the camera. The speed and
  direction of the collapse is what separates a fall from lying down.
- **Score:** 5-fold cross-validation grouped by event on 160 videos: precision
  0.86, recall 0.94, **F1 0.90**, AUC 0.96. The original box rule reached F1 0.11
  as deployed and 0.81 in a generous version. A Random Forest on 16
  biomechanical features reached the same F1 (0.90, AUC 0.95) and is kept as
  the `mode: model` alternative.

### Fire and smoke: YOLOv8n fine-tuned + dynamics check + learned verifier (`temporal/fire_smoke_recognition.py`, `fire_verifier/`)
- **Detects:** visible flames and smoke.
- **Model:** YOLOv8n fine-tuned on a two-class fire/smoke image dataset
  **[verify dataset name]**, with persistence of 3 of 5 evaluated frames. Two
  further stages follow:
  1. A **static-region check**: change inside the box must be ≥ 2× the scene's
     median change (flames flicker, smoke grows), which rejects posters, lamps
     and exposure changes.
  2. A **learned verifier**: gradient boosting on 19 colour, texture,
     flicker and motion features over 1-second windows, which must accept 2
     windows.
- **Why not YOLO alone:** YOLO's false alarms on FIRESENSE came from an orange
  bag, red toys and party lights, which look like fire in one frame.
- **Score:** leave-one-video-out on FIRESENSE:
  - fire: YOLO alone F1 0.87 (2 false alarms) → with the verifier **F1 0.95, 0 false alarms**, same recall (0.91);
  - smoke: unchanged at F1 0.92.

### Unusual activity: optical flow + autoencoder (`anomaly/`, `temporal/scene_anomaly.py`)
- **Detects:** motion unlike the camera's normal activity, for events nobody
  labelled (collapses, running, falling objects).
- **Model:** 38 features per 2-second window from Farnebäck optical flow and
  MOG2 background subtraction, fed to a 38→16→4→16→38 denoising autoencoder
  written in NumPy. An alert is raised when reconstruction error exceeds the
  threshold in 2 of 3 windows.
- **Why:** it needs only normal footage, so it can catch unlabelled events. It
  is a safety net, capped at MEDIUM severity.
- **Calibration:** for the first 5 minutes on each camera it only observes. The
  camera threshold becomes the 99th percentile of that camera's normal error.
- **Score:** trained on normal videos only, tested on 23 unseen normal + 79
  fall videos: precision 0.96, recall 0.67, **F1 0.79**, AUC 0.84 (v1 with a
  leaky split: F1 0.52).
- **Explainability:** each alert lists the feature groups that caused the
  error, for example "downward (collapsing) motion".

### Event confirmation, severity, de-duplication
- **Confirmation** (`confirmation/event_confirmation.py`): each event type
  needs N positive windows out of the last M to become PROBABLE or CONFIRMED.
  Only CONFIRMED incidents reach the ERP. A PROBABLE fight or crowd stays an
  operator signal.
- **Severity** (`severity/severity_rules.py`): a base level per type, plus
  explainable modifiers, plus hard caps:
  - fall still down → CRITICAL; fight ≥ 5 s or score ≥ 0.85 → +1;
  - fire and smoke together → +1;
  - anomaly capped at MEDIUM.
- **De-duplication** (`confirmation/incident_dedup.py`): while an event keeps
  being detected (per camera and event type), repeats
  update the open incident through the escalate endpoint. A new incident is
  created only after 45–120 s of quiet, depending on the type.

### Evidence and reporting
- **Evidence** (`evidence/clip_extractor.py`): a 15-second full-resolution
  ring buffer. On confirmation it saves a 5-second before-clip, 3 keyframes,
  and a 5-second after-clip.
- **Reporter** (`reporting/incident_report.py`): validates each record
  against a Pydantic schema and saves it locally first (`incidents.jsonl`).
  It then posts to the ERP from a background thread, using an outbox that
  retries if the ERP is down. Every record stores `confidence_basis` (how its
  confidence was computed) and `validation_version`.
- **LLM summary** (`llm/summarizer.py`): the LLM receives only the plain
  facts (location, event, urgency, built-in description). Its two-sentence
  summary is rejected if it drops the location, uses technical jargon, or
  contains a number not in the facts; the built-in description is used
  instead. The LLM cannot change the type, severity or confidence.
