# DVS Industries: Multi-Model Safety AI and Smart Analytics

This document describes the machine-learning and analytics features added on top of the
ERP + CCTV perception system, how to run and retrain them, and their measured results.

---

## 1. Perception service: one pipeline, several model families

YOLO is only the first stage. Each abnormal-incident type uses the model family that suits it:

| Incident | Model(s) | Type | Status |
|---|---|---|---|
| People / objects | YOLOv8n + ByteTrack | CNN detector + tracker | existing |
| Fight / violence | **R3D-18** (3D CNN on 16-frame RGB clips); fallback **pose-LSTM** | spatio-temporal deep learning | existing, trained |
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

**Results** (`models/scene_anomaly_ae_v1.metrics.json`, `.evaluation.png`). Trained on 49 of the
81 `not_fall` videos, threshold set on 12 more, then tested on 20 unseen normal videos + 40 fall videos.
These fall videos were never shown to the model.

| Threshold (validation-normal percentile) | Precision | Recall | Specificity | F1 |
|---|---|---|---|---|
| p90 (`threshold_scale: 0.7`) | 0.86 | 0.60 | 0.80 | 0.71 |
| **p95 (default)** | **0.83** | **0.38** | **0.85** | **0.52** |
| p99 | 0.80 | 0.10 | 0.95 | 0.18 |

Video-level ROC-AUC = **0.74**. Explainability: on fall videos the error is dominated by
*motion burst followed by stillness* (5.2× normal), then widespread / fast motion.

**Honest limitation.** The `not_fall` videos are mostly exercise, bending and squatting, i.e. vigorous
"normal" motion, so falls are not extreme motion outliers there. In a factory, normal footage
(walking, machine work) is calmer, and the detector should be retrained on 20–60 minutes of each
camera's own normal footage. The supervised models remain the primary detectors; this one is a
safety net for events nobody labelled.

```bash
cd perception-service
python -m anomaly.train_autoencoder --normal data/fall_videos/not_fall --abnormal data/fall_videos/fall \
       --output models/scene_anomaly_ae_v1.npz
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
| Box rule relaxed to 1 s | 0.80 | 0.82 | 0.81 |
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

**Training** (`fall_rf/train.py`). Not yet run on the real videos, so it has no measured results.
- 5-fold cross-validation **grouped by video** (no window of a test video is ever in training).
- Compares Random Forest, Gradient Boosting and Logistic Regression on identical folds.
- Compares against two training-free baselines on the same videos: the original bounding-box rule and
  the physics score.
- Weak labelling: fall-video windows are positives only if they show the drop *and* the person ending
  on the ground. Deliberate lying down, sitting and bending in `not_fall` are hard negatives, which
  forces the model to learn the *speed* of a fall.
- Saves the best model, a metrics JSON and a comparison / feature-importance plot.

**Run on your laptop (needs ultralytics + scikit-learn; about 10–20 min on a GPU):**
```bash
cd perception-service
pip install -r requirements.txt
python -m fall_rf.extract_features --input data/fall_videos --output data/fall_rf_features
python -m fall_rf.train --manifest data/fall_rf_features/manifest.csv --output models/fall_rf_v1.joblib
```
Then set `fall_detection.mode: model`. If its checkpoint is missing, the detector uses the physics
score. Training both gives a deep-learning vs classical-ML comparison on the same videos.

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

Example finding: on a real fight (score 0.89) the heat sits on the people struggling; on a non-fight
car-park clip that still scored 0.86 the heat spreads over parked cars and frame edges, which shows the
model reacting to background clutter. This is exactly the weakness explainability is meant to expose.

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

### 2.3 Plant Health Index: `GET /api/v1/analytics/plant-health`

A 0–100 score with grade A–D built from five pillars: inventory availability (20%), OEE-style
production (25%), first-pass yield (20%), severity-weighted safety incidents from the AI security
module (25%) and attendance (10%). Missing pillars are left out and the remaining weights rescaled.
It also reports the **correlation between safety incidents and quality per department**, linking
the CCTV AI module to production KPIs.

### 2.4 Access
| Endpoint | Roles |
|---|---|
| inventory, forecast | ADMIN, MANAGER, STORE |
| production | ADMIN, MANAGER, PRODUCTION |
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
