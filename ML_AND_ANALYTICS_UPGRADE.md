# DVS Industries: Multi-Model Safety AI and Smart Analytics

This document describes the machine-learning and analytics features added on top of the
ERP + CCTV perception system, how to run and retrain them, and their measured results.

**Model files.** Small trained models are in the repo (`fall_gru_v1.pt`, `fall_rf_v1.joblib`,
`fire_smoke_verifier_v1.pkl`, `scene_anomaly_ae_v2.npz`). The large weights are not, because
GitHub rejects files over 100 MB: `fight_r3d18_v2.pt` (133 MB), `fight_r3d18_v1.pt`,
`fire_smoke_yolov8n_v1.pt`, `yolov8n.pt` and `yolov8n-pose.pt`. Copy them into
`perception-service/models/` (YOLO base weights into `perception-service/`), or share them via
Google Drive or GitHub Releases.

---

## 1. Perception service: one pipeline, several model families

YOLO is only the first stage. Each abnormal-incident type uses the model family that suits it:

| Incident | Model(s) | Type | Status |
|---|---|---|---|
| People / objects | YOLOv8n + ByteTrack | CNN detector + tracker | existing |
| Fight / violence | **R3D-18** (3D CNN on 16-frame RGB clips, v2 retrained with real-time clip sampling); fallback **pose-LSTM** | spatio-temporal deep learning | **retrained (v2)** |
| Fire / smoke | YOLOv8n (fine-tuned) **+ learned verifier** (`fire_verifier/`, gradient-boosted features) or the training-free **colour / luminous-core / flicker verifier** (`temporal/fire_verifier.py`) | CNN + ML / classical computer vision | **new, trained** |
| Fall | **YOLOv8-Pose + box features → temporal CNN + BiGRU** (`fall_gru/`, primary). Alternative: **16 biomechanical features → Random Forest** (`fall_rf/`) | pose estimation + recurrent deep learning / classical ML | **new, trained** |
| Explainability | **Grad-CAM** heatmaps on the R3D-18 fight model, saved with each fight incident | explainable AI | **new** |
| Unknown / unlabelled abnormal events | **Optical flow + background subtraction → denoising autoencoder** | unsupervised deep learning | **new, trained** |
| Intrusion, loitering, crowd | geometric rule engine on tracks | rules | existing |
| Incident summaries | LLM summarizer | generative AI | existing |

```
camera ─► YOLOv8 + ByteTrack ─► temporal buffer ─┬─► rule engine (intrusion, loitering, crowd)
                                                  ├─► R3D-18 / pose-LSTM ............ fight
                                                  ├─► YOLOv8-Pose ─► GRU (or RF) .... fall        (new)
         frame ───────────────────────────────────┼─► YOLOv8 fire/smoke ─► learned verifier  fire_smoke (new)
         frame ─► optical flow + MOG2 ─► autoencoder ──────────────────────── anomaly   (new)
                                                  ▼
                           event confirmation (N-of-M) ─► severity ─► evidence clips ─► ERP dashboard + LLM summary
```

### 1.0 Fight detection v2: train/serve alignment (`rgb_fight_model/`)

**Problem found.** v1 was trained on 16 frames taken every 2nd frame of each video. Source videos
run at 11–37 fps, so a training clip covered anywhere from 0.8 s to 2.7 s. The live pipeline feeds
16 frames at 10 fps (1.6 s), so the model saw motion at a different speed than in training.

**Fix.** v2 samples every training clip at 10 frames per second of *real time* (1.5 s), whatever
the source frame rate, and the live detector rebuilds clips from frame timestamps at the same rate.
Training also adds a cosine learning-rate schedule, CCTV-style lighting / IR augmentation and
3-clip validation scoring. Same train/validation/test split as v1.

**Results** (`models/fight_r3d18_v2.runtime.json`). Both models scored on the same 344 test videos
with the *live* decision rule (5 clips per video in time order, alert when 2 of 3 consecutive clips
reach the threshold; each model's threshold chosen on the validation split):

| Fight model | Precision | Recall | F1 | AUC | Fights caught | False alarms |
|---|---|---|---|---|---|---|
| v1 | 0.93 | 0.79 | 0.85 | 0.91 | 135 / 172 | 10 |
| **v2 (live default)** | **0.94** | **0.97** | **0.96** | **0.99** | **167 / 172** | 10 |

At the same false-alarm count v2 catches 32 more fights. Live thresholds: confirmed 0.55, review 0.45.

```bash
python -m rgb_fight_model.train --manifest data/rgb_fight_manifest.csv --data-root data/fight_videos \
       --output models/fight_r3d18_v2.pt --workers 0 --clip-fps 10 --eval-clips 3
python -m rgb_fight_model.calibrate_runtime --manifest data/rgb_fight_manifest.csv --data-root data/fight_videos \
       --checkpoint models/fight_r3d18_v2.pt --compare models/fight_r3d18_v1.pt
```

### 1.1 Unsupervised scene-anomaly detector (`perception-service/anomaly/`)

**Idea.** Train only on *normal* footage. A denoising autoencoder learns to reconstruct normal
motion patterns; a 2-second window it cannot reconstruct is unlike anything seen in normal
operation and is flagged as an anomaly. No labelled incidents are needed, so it can catch events
nobody labelled: collapses, running, stampede, falling objects, machine malfunction.

**Features (38 per 2-s window, OpenCV + NumPy only).**
- Dense optical flow (Farnebäck): speed (in frame-widths/second, so FPS- and resolution-independent),
  moving area, share of motion going down / up / sideways, coherence, motion centroid height,
  motion energy in the top / middle / bottom third of the frame.
- Background subtraction (MOG2): foreground area, height and aspect ratio of the largest silhouette.
- Temporal structure: downward travel of the motion centroid, silhouette height drop and widening,
  "burst followed by stillness", peak acceleration.

**Model.** 38 → 16 → 4 → 16 → 38 denoising autoencoder written in NumPy (forward pass, backprop and
Adam are all visible in `anomaly/autoencoder.py`; a numerical gradient check is in the tests).
The threshold is the 95th percentile of reconstruction error on *validation normal* videos.
Each alert explains which feature groups caused the error.

**Results** (`models/scene_anomaly_ae_v2.metrics.json`, `.evaluation.png`; live default).
The 81 `not_fall` videos are split **by event**: files such as `01.mp4` and `01 (2).mp4` are the
same scene from different cameras and always stay in the same split. 47 videos train the model,
11 set the threshold, and 23 unseen normal videos + all 79 fall videos test it. The fall videos
are never shown to the model.

| Threshold (validation-normal percentile) | Precision | Recall | Specificity | F1 |
|---|---|---|---|---|
| p90 (`threshold_scale` ≈ 0.75) | 0.92 | 0.76 | 0.78 | 0.83 |
| **p95 (default)** | **0.96** | **0.67** | **0.91** | **0.79** |
| p97.5 | 0.94 | 0.38 | 0.91 | 0.54 |
| p99 | 0.90 | 0.24 | 0.91 | 0.38 |

Video-level ROC-AUC = **0.84**. On fall videos the reconstruction error is dominated by
*downward (collapsing) motion* (2.7× normal), *motion burst followed by stillness* and
*unusual motion direction*.

*Earlier v1* (`scene_anomaly_ae_v1.*`) split normal videos by file, so other camera angles of
test scenes could appear in training, and it was tested on 40 fall videos: F1 0.52, AUC 0.74.
v2 removes that leakage and is evaluated on twice as many abnormal videos.

**Honest limitation.** The `not_fall` videos are mostly exercise, bending and squatting, i.e. vigorous
"normal" motion, so falls are not extreme motion outliers there. In a factory, normal footage
(walking, machine work) is calmer, and the detector should be retrained on 20–60 minutes of each
camera's own normal footage. The supervised models remain the primary detectors; this one is a
safety net for events nobody labelled.

```bash
cd perception-service
python -m anomaly.train_autoencoder --normal data/fall_videos/not_fall --abnormal data/fall_videos/fall \
       --output models/scene_anomaly_ae_v2.npz
# for a real camera: --normal <folder of that camera's normal recordings>
```

### 1.2 Fall detection

**Primary: pose-sequence temporal CNN + BiGRU (`fall_gru/`, runtime `temporal/fall_gru_recognition.py`, `mode: gru`).**
Per frame: box features (aspect, height, centre, bottom) + skeleton features (torso tilt, hip/head
position in the box, body extents) + their velocities → 15 features; a GRU scores 4-second windows.
Trained with 5-fold cross-validation **grouped by event** (all camera angles of one fall stay in one
fold), with time-stretch augmentation and pose dropout.

| Detector (same 160 videos, out-of-fold) | Precision | Recall | F1 |
|---|---|---|---|
| **Pose-GRU** (`models/fall_gru_v1.metrics.json`, AUC **0.96**) | **0.86** | **0.94** | **0.90** |
| Original box rule (5 s stillness, as deployed) | 0.56 | 0.06 | 0.11 |
| Box rule relaxed to 1 s, without its 8-px stillness check (generous) | 0.80 | 0.82 | 0.81 |
| Ablation: same GRU, box features only (AUC 0.92) | 0.87 | 0.91 | 0.89 |

The deployed rule scores so low mainly because most clips end before 5 s of lying still; the relaxed
rule is the fair comparison. The ablation shows the skeleton features mainly improve ranking
(AUC 0.92 → 0.96). Files named `01`, `01 (2)` … are the same event from different cameras, so they
are kept in one fold; with only 48 events, cross-validation is more reliable than a single test split.

```bash
python -m fall_gru.extract --input data/fall_videos --output data/fall_gru_features
python -m fall_gru.train --features data/fall_gru_features --output models/fall_gru_v1.pt
python -m fall_gru.train --box-only --output models/fall_gru_boxonly.pt   # ablation
```

**Alternative: biomechanical features + Random Forest (`fall_rf/`, `mode: model`).**

**Why.** The old rule (`aspect ratio < 0.8 → > 1.2`, then 5 s of stillness) misses falls towards the
camera, and the 5-second wait means most short clips never trigger it.

**Features (16, from YOLOv8-Pose keypoints over 2 s).** Torso angle from vertical (end / max / change /
angular speed), hip and head drop (in body heights) and their downward speeds, head height above the
feet, bounding-box aspect change, stillness after the drop, centre acceleration, keypoint visibility,
vertical-to-horizontal keypoint spread. These describe the *physics* of a fall, so they transfer
across cameras, clothing and lighting.

**Training** (`fall_rf/train.py`). Results (`models/fall_rf_v1.metrics.json`, `.evaluation.png`) on the
same 160 videos, 5-fold cross-validation grouped by event:

| Model on 16 biomechanical features | Precision | Recall | F1 | Video AUC |
|---|---|---|---|---|
| **Random Forest** (saved) | 0.86 | 0.94 | **0.90** | 0.95 |
| Gradient Boosting | 0.86 | 0.92 | 0.89 | 0.95 |
| Logistic Regression | 0.86 | 0.87 | 0.87 | 0.94 |
| Physics score (no training) | 0.86 | 0.78 | 0.82 | – |

**Deep learning vs classical ML.** The GRU on raw per-frame features (F1 0.90, AUC 0.96) and the
Random Forest on hand-designed biomechanical features (F1 0.90, AUC 0.95) reach the same F1. The
GRU learns its features; the Random Forest needs expert features but is faster and explains each
alert in plain language. The GRU is the live default; `mode: model` switches to the Random Forest.

**Note on the box-rule baselines.** The two scripts implement the original rule slightly
differently. `fall_rf` reproduces it exactly, including its "lying still" check (box centre moves
≤ 8 px), and it almost never fires on these clips (F1 0.00 with 5 s, 0.07 with 1 s). `fall_gru`
omits the 8-px check, so its "relaxed" rule (F1 0.81) is a generous version of the rule. Either way,
the learned models are clearly better.
- 5-fold cross-validation **grouped by video** (no window of a test video is ever in training).
- Compares Random Forest, Gradient Boosting and Logistic Regression on identical folds.
- Compares against two training-free baselines on the same videos: the original bounding-box rule and
  the physics score.
- Weak labelling: fall-video windows are positives only if they show the drop *and* the person ending
  on the ground. Deliberate lying down, sitting and bending in `not_fall` are hard negatives, which
  forces the model to learn the *speed* of a fall.
- Saves the best model, a metrics JSON and a comparison / feature-importance plot.

**Re-run (about 10–20 min on a GPU):**
```bash
cd perception-service
pip install -r requirements.txt
python -m fall_rf.extract_features --input data/fall_videos --output data/fall_rf_features
python -m fall_rf.train --manifest data/fall_rf_features/manifest.csv --output models/fall_rf_v1.joblib
```
Then set `fall_detection.mode: model`. If its checkpoint is missing, the detector uses the physics
score.

**Runtime** (`temporal/pose_fall_recognition.py`). Pose runs every 3rd cycle while nothing looks
unusual (so a pre-fall history exists), and every cycle for 4 s after a cheap gate fires on the
ByteTrack box (sudden height loss, widening box, fast downward motion). 2-of-3 positive windows →
PROBABLE; still on the ground after 3 s → CONFIRMED. The incident includes plain-language reasons
("torso rotated 78° towards horizontal", "hips dropped at 1.3 body-heights/s").

### 1.3 Fire verification

**Learned verifier (`fire_verifier/`, `models/fire_smoke_verifier_v1.metrics.json`).** Colour,
texture and box-dynamics features over 1-second windows of YOLO detections, evaluated
leave-one-video-out on FIRESENSE: fire **F1 0.87 → 0.95** (false alarms 2 → 0, recall unchanged);
smoke unchanged at F1 0.92.

**Live use.** `fire_smoke_detection.verifier.mode: learned` (default) gates each persistent YOLO alarm:
the learned verifier must accept 2 windows before the alarm is raised (`fire_verifier/runtime.py`).
Note: this 2-window rule was chosen after a first run in which accepting any single window left both
false alarms in place. It mirrors YOLO's own 3-of-5 persistence, and the margin is wide (real fire and
smoke videos had ≥ 5 accepted windows, the two false alarms exactly 1), but it was not fixed in advance.

**Training-free alternative (`temporal/fire_verifier.py`, `verifier.mode: rules`).**

In the existing FIRESENSE evaluation, YOLO's false and near-false alarms came from an **orange
shopping bag**, **red toys** and **pink / white party lights**. Inside each YOLO fire box the
verifier measures:

1. Fire colour: RGB + YCbCr flame rule (Chen 2004, Çelik 2009).
2. Luminous core: share of flame pixels that are both very bright and yellow-orange. Flames emit
   light; a bag only reflects it.
3. Flicker: change in flame shape between frames after compensating for movement. Rigid objects
   keep their shape.

`fused = yolo_conf × (0.4 + 0.6 × verification)`. Real FIRESENSE fire scores a median 0.91–1.00;
the bag, toys and bokeh score about 0.40–0.45, enough to push a 0.70 YOLO detection below the 0.5
alert threshold. Measure the before/after effect on your GPU:

```bash
python evaluate_fire_smoke_videos.py --root data/fire_smoke_videos/firesense --model models/fire_smoke_yolov8n_v1.pt \
       --output output/fire_eval_verified --verify
```
Compare `summary.json` with `models/fire_smoke_video_eval_baseline.summary.json` (fire: P 0.83, R 0.91).

### 1.4 Explainability: Grad-CAM for the fight model (`explain/gradcam.py`)

Grad-CAM weights the R3D-18's last convolutional block by how much each channel raises the "fight"
score, giving a space-time heatmap of where the model looked. Each confirmed fight saves 3 overlaid
keyframes in `output/evidence/gradcam/` and lists them in the incident (`gradcam_heatmaps`).

```bash
python -m explain.gradcam data/fight_videos/fight/fi029.mp4 --checkpoint models/fight_r3d18_v1.pt --out output/gradcam
```

Example finding (v1 vs v2 on the same clips):
- Real fight: v1 scored 0.89 and v2 0.98; both put the heat on the people struggling.
- Non-fight car-park clip: v1 (0.86) spread the heat over parked cars and frame edges, reacting to
  background clutter. v2 (0.84) focuses on the people, and its mistake is a person running fast, an
  understandable confusion with fighting. Grad-CAM shows the retrained model attends to the right
  thing even where it is still wrong.

### 1.5 Tests (no camera, GPU or YOLO needed)
```bash
python -m pytest test_learned_models.py   # GRU fall features/detector, learned fire verifier runtime
python test_scene_anomaly.py   # gradient check, training, save/load, features, runtime episode handling
python test_fall_model.py      # fall_rf: features, physics score, runtime PROBABLE->CONFIRMED, training pipeline
python test_fire_verifier.py   # real flame kept; orange object and bokeh suppressed
```

---

## 2. ERP: Smart Analytics module

New API `/api/v1/analytics/*` and a **Smart Analytics** page in the admin dashboard.
All maths is in dependency-free modules under `backend/src/analytics/` and unit-tested
(`src/__tests__/services/analytics.engine.test.ts`).

### 2.1 Inventory intelligence: `GET /api/v1/analytics/inventory`

| Feature | Method |
|---|---|
| Demand forecast per material | **Holt's linear exponential smoothing** (α, β fitted by grid search) for regular demand; **Croston–SBA** for intermittent demand. Chosen automatically with the Syntetos–Boylan ADI > 1.32 rule. |
| Robust to one-off spikes | Demand is capped at median + 3.5·MAD/0.6745 before fitting, so an abnormal issue does not bend the forecast. |
| Honest accuracy | Models are refitted without the last 14 days and their 14-day demand total is compared with what actually happened. |
| Safety stock | z(service level) × σ(daily forecast error) × √lead time |
| Dynamic reorder point | forecast demand × lead time + safety stock. Lead time comes from the supplier record, otherwise the default. Open purchase orders count towards the stock position. |
| Economic Order Quantity | √(2 · annual demand · order cost / holding cost) |
| Stock-out prediction | Date when cumulative forecast demand exceeds stock. **CRITICAL** = runs out *before* a new order could arrive. |
| ABC × XYZ | ABC = Pareto on annual consumption value (80/15/5 %); XYZ = coefficient of variation of weekly demand. Each cell has a recommended policy. |
| Theft / leakage detection | Robust modified z-score (Iglewicz–Hoaglin, \|z\| > 3.5) on every OUT, SCRAP and negative ADJUSTMENT against that material's own history. |
| Insights | Ranked plain-language actions ("Raise a PO for 1187 kg Steel Sheet today: stock-out 16 Oct, lead time 12 days"). |

`GET /api/v1/analytics/inventory/:materialId/forecast` returns daily history, the forecast with an 80%
prediction interval, and projected stock vs reorder point and safety stock.

Query parameters: `historyDays` (30–365), `horizonDays`, `serviceLevel` (0.5–0.995), `defaultLeadTimeDays`,
`orderCost`, `holdingRate`.

### 2.2 Production performance: `GET /api/v1/analytics/production`

- **OEE-style index** = Quality × Target attainment × Schedule adherence. Classic OEE needs machine
  run-time, which the ERP does not record, so this is an explicitly labelled proxy.
- **Department ranking**, plus the weakest factor of the lowest-ranked department.
- **Statistical Process Control**: a p-chart of the daily defect proportion with 3σ limits that widen
  on low-volume days, plus the **Western Electric run-of-7 rule**, which detects a quality drift even
  when no single day breaks the limits.
- Weekly first-pass-yield trend; optional `?department=` filter.

### 2.3 Supplier scorecard: `GET /api/v1/analytics/suppliers`

Scores every supplier from its purchase-order history (`?historyDays=`, default 180):

| Measure | Definition |
|---|---|
| On-time delivery | delivered POs that arrived by the promised date (1-day grace) ÷ delivered POs with a promised date |
| Average delay | mean lateness of the late deliveries, in days |
| Lead time and drift | mean actual lead time (order → delivery) vs the lead time the supplier promised |
| Lead-time variability | coefficient of variation of actual lead time. Unpredictable suppliers force extra safety stock. |
| Fulfilment | delivered ÷ (delivered + cancelled) |
| Overdue open POs | open orders whose promised date has passed |
| **Score / grade** | 40% on-time + 25% lead-time consistency + 20% fulfilment + 15% buyer rating; A ≥ 85, B ≥ 70, C ≥ 55, else D. Missing parts are left out and the weights rescaled; suppliers with fewer than 3 deliveries are shown as *New* rather than graded. |

Insights flag overdue POs, poor on-time performance, lead-time drift ("real lead time 14 days vs
7 promised: update it so reorder points are right") and erratic suppliers. The maths is in
`backend/src/analytics/supplierMath.ts` and tested in `supplier.scorecard.test.ts`. The page has a
**Supplier Scorecard** tab. SUPPLIER accounts can never call this endpoint, because it compares competitors.

### 2.4 Plant Health Index: `GET /api/v1/analytics/plant-health`

A 0–100 score with grade A–D built from five pillars: inventory availability (20%), OEE-style
production (25%), first-pass yield (20%), severity-weighted safety incidents from the AI security
module (25%) and attendance (10%). Missing pillars are left out and the remaining weights rescaled.
It also reports the **correlation between safety incidents and quality per department**, linking
the CCTV AI module to production KPIs.

### 2.5 Access
| Endpoint | Roles |
|---|---|
| inventory, forecast | ADMIN, MANAGER, STORE |
| production | ADMIN, MANAGER, PRODUCTION |
| suppliers | ADMIN, MANAGER, STORE |
| plant-health | ADMIN, MANAGER |

---

## 3. Points worth making in a viva

1. **Multi-model by design**: detection (YOLO), tracking (ByteTrack), 3D-CNN video classification
   (R3D-18), recurrent sequence models (LSTM for fights, GRU for falls), pose estimation + ensemble trees, unsupervised
   deep learning (autoencoder), classical CV (verifier), time-series forecasting (Holt / Croston),
   robust statistics (MAD), SPC (p-chart) and an LLM. Each is chosen for its task.
2. **Evaluated honestly**: splits are by video, thresholds come from validation data only, results
   are compared against baselines and reported with trade-off tables, and limitations are stated.
3. **Explainable**: every alert and recommendation says *why* (feature groups, biomechanical reasons,
   robust z-scores, forecast method, and service-level z-value).
4. **Safety-aware policy**: unsupervised anomalies are capped at MEDIUM severity, and purchase orders
   are recommended but never auto-raised. A human stays in the loop.
