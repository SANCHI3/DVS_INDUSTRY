# 6. Testing and results

All model numbers below are copied from [../RESULTS.md](../RESULTS.md),
which `perception-service/evaluation/run_all.py` generates from the metrics
files saved at training time (`perception-service/models/*.json`). The script
also checks that every stored precision and recall matches its stored
confusion counts.

## 6.1 Automated tests

| Suite | Command | Result (15 Oct 2026) |
|---|---|---|
| Backend (Vitest + Supertest) | `cd backend && npm test` | 157 tests in 15 files, all passing; typecheck, ESLint and Prettier clean |
| Frontend (Vitest) | `cd frontend && npm test && npm run build` | 19 tests in 3 files, all passing; production build succeeds |
| Perception (pytest) | `cd perception-service && python -m pytest -q` | 122 tests, all passing (re-run 16 Oct 2026) |

The perception tests run without a camera or GPU. They cover:

- the rule engine and confirmation tiers;
- evidence extraction;
- fight gating and the interaction check;
- fall features and runtime;
- the fire verifiers;
- autoencoder gradients, training and save/load;
- incident schema validation, reporter outbox, dashboard client and de-duplication;
- LLM output validation;
- demo playlist and fail-soft model loading;
- the results collector, bootstrap intervals, McNemar test and ablation summaries.

`test_false_positives.py` alone runs 18 scenarios: normal activity that must
*not* alert (people talking close together, one person with two track IDs, a static orange object,
auto-exposure change, a high fight-model score without interaction) and
genuine events that must still alert.

CI (GitHub Actions) runs the three suites on every push.

## 6.2 End-to-end test

Demo mode was run against the live backend and database on 15 Oct 2026. Each
demo clip produced exactly one database incident of the right type:

- the fight clip gave one CONFIRMED FIGHT;
- the fire clip gave one incident, created at PROBABLE and escalated to
  CONFIRMED (one database row);
- the normal-activity clip gave none.

The browser received `incident.created` and then `incident.updated` (when the
LLM summary was attached) over SSE. When the playlist looped, repeats of the
same event within the de-duplication window were suppressed.

## 6.3 Model results (held-out data)

| Task | Deployed model | Precision | Recall | F1 | AUC | False alarms | Test size | Baseline (F1, false alarms) |
|---|---|---|---|---|---|---|---|---|
| Fight | R3D-18 v2, live 2-of-3 rule | 0.94 | 0.97 | **0.96** | 0.99 | 10 | 344 videos | R3D-18 v1: 0.85, 10 |
| Fall | Pose + BiGRU | 0.86 | 0.94 | **0.90** | 0.96 | 12 | 160 videos (CV) | box rule relaxed: 0.81, 16; as deployed: 0.11, 4 |
| Fire | YOLOv8n + learned verifier | 1.00 | 0.91 | **0.95** | – | 0 | 27 videos | YOLO only: 0.87, 2 |
| Smoke | YOLOv8n + learned verifier | 1.00 | 0.85 | **0.92** | – | 0 | 22 videos | YOLO only: 0.92, 0 |
| Unusual activity | Autoencoder v2 | 0.96 | 0.67 | **0.79** | 0.84 | 2 | 102 videos | autoencoder v1: 0.52, 3 |

Protocols differ per task (chapter 5.4), so compare rows only within a task.
"False alarms" = false positives on that test set.

![Deployed model per task](../figures/model_scores.png)

*Figure 6.1: Precision, recall and F1 of the deployed model per task.*

![Baseline vs final](../figures/baseline_vs_final.png)

*Figure 6.2: F1 and false alarms, baseline vs deployed model.*

![Confusion matrices](../figures/confusion_matrices.png)

*Figure 6.3: Confusion matrices (rows = true class).*

**Observations**

- **Fight:** v2 catches 167 of 172 test fights against v1's 135, at the same
  10 false alarms. The gain comes from training on clips sampled at the same
  real-time rate as the live pipeline (v1 trained on a fixed frame stride
  across videos of 11–37 fps).
- **Fall:** the learned model clearly beats the deployed box rule, which
  rarely fired because it waited 5 s for stillness. A Random Forest on 16
  biomechanical features reached the same F1 (0.90). `ML_AND_ANALYTICS_UPGRADE.md`
  reports a box-features-only ablation (AUC 0.92 vs 0.96), but its metrics file
  is not in the repository, so it is not in RESULTS.md.
- **Fire:** the verifier removes both YOLO false alarms without losing recall.
  YOLO's false and near-false alarms on FIRESENSE came from look-alikes such
  as an orange shopping bag, red toys and party lights. Stricter YOLO thresholds alone were
  tried and rejected: fire recall fell to 0.45.
- **Unusual activity:** high precision, moderate recall, without any labelled
  incident in training. v1's apparently weaker result was measured with a
  split that let camera angles of one event leak across train and test; v2
  fixes the split.

Full table (21 rows, including alternatives and rejected variants):
[../RESULTS.md](../RESULTS.md) section 1.

## 6.4 Speed

Measured with `python -m evaluation.benchmark`. Each device ran 100 s of the
demo playlist, paced at 10 processed frames/s as in live use, on a laptop
with an Intel CPU and an NVIDIA RTX 3050 laptop GPU.

| Stage (average ms added per frame) | GPU | CPU |
|---|---|---|
| YOLOv8n detection | 19.8 | 61.7 |
| ByteTrack | 0.4 | 0.3 |
| Rules | 0.1 | 0.1 |
| Fight (R3D-18 + interaction) | 7.2 | 19.0 |
| Fire/smoke (YOLOv8n + verifier) | 11.0 | 28.6 |
| Fall (YOLOv8-Pose + BiGRU) | 8.1 | 40.6 |
| Unusual activity | 2.9 | 2.1 |
| **Whole frame** | **51.9** | **153.8** |
| Frames/s achieved (target 10) | 9.2 | 6.1 |
| Capacity, frames/s | 19.3 | 6.5 |

The GPU sustains near real time with about 2× headroom. CPU-only operation
works but runs at about 6 frames/s. The earlier measurement in
`docs/REALTIME_SECURITY_ALERTS.md` reports a median of 0.43 s from detection to
ERP record (57 live incidents) and 11 ms from ERP to browser (n = 20). Those
figures come from that document and were not re-measured for this report.

## 6.5 False-positive fixes (before / after)

On 15 Oct 2026 the dashboard filled with false incidents during normal
activity in the test room: "lingering" at 76–77 %, "unusual activity" at
94 %, "smoke" at 80 %, and fights. Each was traced to a root cause in the
pipeline (details in `perception-service/docs/FALSE_POSITIVE_FIXES.md`):

| Incident type | Root cause (before) | Fix (after) |
|---|---|---|
| Lingering | Ghost tracks kept for 15 s after a person left; a made-up confidence formula; placeholder zone covering 31 % of the view | Lingering and restricted-area detection removed (no floor plan or zone data available) |
| Fight | Motion gate paired a person's old and new track IDs; speed from 2 samples (jitter opened the gate); incident from the clip score alone | Interaction check (two distinct people, close ≥ 1 s, agitated); speed over 0.5 s; duplicates by IoU ≥ 0.7 |
| Fire / smoke | Static look-alikes persisted frame after frame; verifier kept old approvals forever | Static-region check (in-box change ≥ 2× the scene); verifier reset when persistence ends; confidence = mean, not peak |
| Unusual activity | Threshold from training footage of another site: normal movement here was always above it | 5-minute per-camera calibration (99th percentile) without alerting; score `ratio/(ratio+1)`, labelled as a score, not a probability |

All records now carry `validation_version: 2` and a `confidence_basis`.

**What is measured and what is not.** The 18 regression scenarios pass, and
the demo clips raise their incidents. The fixes were also compared stage by
stage on 472 held-out and public clips (section 6.8). A rate of false alarms
per hour on the **deployment camera's** own normal footage has still **not**
been measured, because no long recording from that camera is available.
`python -m evaluation.false_alarms --video <recording>` and
`python -m evaluation.ablation run` (which switches to
`perception-service/field_data/` when that folder exists) are ready for it.

## 6.6 Confidence intervals

`run_all.py` now adds bootstrap 95% confidence intervals (1,000 resamples
over test videos, fixed seed, `evaluation/stats.py`) to every row whose
per-video predictions are stored in the repository. The recomputed confusion
counts and AUC equal the stored ones.

| Task | Model | n | Precision | Recall | F1 | AUC |
|---|---|---|---|---|---|---|
| Unusual activity | Autoencoder v2 (deployed) | 102 | 0.96 [0.91, 1.00] | 0.67 [0.57, 0.77] | 0.79 [0.71, 0.86] | 0.84 [0.72, 0.93] |
| Unusual activity | Autoencoder v1 | 60 | 0.83 [0.65, 1.00] | 0.38 [0.24, 0.52] | 0.52 [0.37, 0.65] | 0.74 [0.60, 0.87] |
| Fire | YOLOv8n only (baseline) | 27 | 0.83 [0.60, 1.00] | 0.91 [0.71, 1.00] | 0.87 [0.70, 1.00] | – |
| Smoke | YOLOv8n only | 22 | 1.00 [1.00, 1.00] | 0.85 [0.64, 1.00] | 0.92 [0.78, 1.00] | – |

What the intervals show:

- The fire and smoke sets are small. Fire recall could be anywhere from 0.71
  to 1.00 at this sample size. The verifier's improvement (2 → 0 false alarms
  on 27 videos) is real on this set, but it is too small to call significant.
- The autoencoder v2's recall interval (0.57–0.77) does not overlap v1's
  (0.24–0.52). The two were tested on different splits, though, so this is
  not a paired comparison.

**Not computed.** The fight, fall and fire/smoke-with-verifier rows store
only aggregate confusion counts, not per-video predictions, so they have no
interval. Approximating one from the counts would assume independence the
protocol does not guarantee. For the same reason a McNemar test of fight v1
vs v2 could not be run. Re-scoring the 344 test videos with
`calibrate_runtime.py` and saving per-video scores would allow it. This is
inference only, with no retraining.

## 6.7 Fight interaction-check thresholds

`python -m evaluation.interaction_separation` measures, on the fight
dataset's held-out test split (172 fight, 172 not-fight; a proxy, because no
field recordings were available), the two quantities the interaction check
thresholds: how long a pair of people stays close (close_seconds) and how
agitated the more active person moves (RESULTS.md section 5,
`docs/figures/interaction_separation.png`).

| Agitation threshold | Fight clips passing | Normal clips passing | Youden J |
|---|---|---|---|
| 0.1 (configured) | 0.51 [0.44, 0.57] | 0.42 [0.34, 0.50] | 0.08 [−0.02, 0.19] |
| 0.2 (best J on these clips) | 0.47 [0.39, 0.54] | 0.29 [0.22, 0.36] | 0.17 [0.08, 0.28] |

**This is a weak result for the check, and it is reported as such.**

- Closeness alone does not separate the classes: 51% of fight clips and
  51% of normal clips have a pair close for 1 s or more.
- Agitation of a close pair separates them only slightly: ROC AUC 0.55
  [0.50, 0.61].
- About half of the fight clips never show two tracked people close
  together for 1 s. In crowded or low-resolution clips, grappling people are
  often merged into one box or lose their tracks, so the check cannot see
  the interaction.
- Raising the threshold to 0.2 improves J. On these clips the 95% interval of
  the gain, [0.04, 0.15], excludes 0. The configured 0.1 was kept because the
  0.2 value was chosen on the same clips, the clips come from other cameras,
  and the ablation runs at 0.1. It should be re-tuned on field recordings.

The thresholds were set for a narrower failure: people standing, walking or
talking near each other in one room. The configuration comment gives
standing and walking as about 0.01–0.05 body heights. The not-fight clips
here come from many other cameras and scenes, so they test a harder
question than the one the check was designed for.

## 6.8 Ablation of the verification stages

**Question.** Do the verification stages reduce false alarms per hour while
keeping recall on genuine events, and what does each one contribute?

**Protocol.** `python -m evaluation.ablation run` plays each clip separately
through the unchanged live pipeline (`main.run`), in real time, headless,
with fresh state per clip. Seven configurations were run:

- (a) the code before the fixes, commit `85315cc~1`;
- (b) the full system with the fight interaction check as a **veto** (the
  design evaluated in the first version of this chapter);
- (c)–(f) the full system with one stage switched off by an existing
  `thresholds.yaml` flag: (c) interaction check, (d) region dynamics,
  (e) anomaly calibration, (f) every N-of-M persistence rule set to 1 of 1;
- (g) the full system with the interaction check as a **review signal**, the
  configuration now deployed (`fight_detection.interaction.mode: review`).

(b)–(f) pin the veto, so (g) − (b) measures exactly the change from veto to
review. (a) runs fixed old code and was not re-run; (b)–(g) ran on the current
code, which includes the later fall-plausibility fixes, so their numbers
differ from the first version of this section.

**Footage: a proxy, not the deployment camera.** The planned field recordings
were not available, so 472 clips already in the project were used:

| Set | Clips | Minutes | Note |
|---|---|---|---|
| Normal | 172 | 16.0 | fight-dataset test split, not-fight (no model trained on it) |
| Look-alikes | 25 | 14.8 | FIRESENSE fire/smoke negatives |
| Fight | 172 | 15.2 | fight-dataset test split (held out) |
| Fall | 79 | 9.0 | in-sample: the deployed fall model was trained on them |
| Fire / smoke | 11 / 13 | 5.6 / 8.8 | FIRESENSE positives (verifier trained on FIRESENSE) |

Anomaly calibration was computed once, from 172 disjoint normal clips
(51 windows), giving a camera threshold of 8.7× the model's.

**Results** (RESULTS.md section 4; brackets are 95% bootstrap intervals;
Δ = paired difference against (b) on the same clips). Alarms are dashboard
alerts; fights sent for review in (g) are counted separately below.

| Configuration | FA/h normal | FA/h look-alikes | Fight recall | Fall recall | Fire recall | Smoke recall |
|---|---|---|---|---|---|---|
| (a) pre-fix code | 157.9 | 109.5 | 0.78 | 0.75 | 0.73 | 0.62 |
| (b) full system, veto | 56.4 | 16.2 | **0.48** | 0.63 | 0.73 | 0.54 |
| (c) − interaction check | 82.7 | 24.3 | 0.73 | 0.63 | 0.73 | 0.62 |
| (d) − region dynamics | 67.7 | 12.2 | 0.48 | 0.63 | 0.73 | 0.62 |
| (e) − anomaly calibration | 71.4 | 73.0 | 0.47 | 0.62 | 0.73 | 0.62 |
| (f) single-frame (1/1) | 109.0 | 24.3 | 0.48 | 0.78 | 0.91 | 0.85 |
| (g) review mode (deployed) | 71.4 | 16.2 | 0.48 (**0.75** incl. review) | 0.63 | 0.73 | 0.62 |

![Ablation](../figures/ablation.png)

*Figure 6.4: False alarms per hour and recall per configuration (proxy clips).*

**What each stage did:**

- **Persistence** has the largest effect in both directions. Without it,
  false alarms rise by 52.6/h on normal clips [+22.4, +96.2]. It also costs
  recall: falls 0.78 → 0.63 (Δ 0.15 [0.08, 0.24]) and smoke 0.85 → 0.54
  (Δ 0.31 [0.08, 0.54]); fire also loses detections, though that interval
  reaches 0.
- **Anomaly calibration** removes 56.8 look-alike alarms per hour [35.3,
  96.3], every one of them "unusual activity". But with the threshold raised
  8.7×, the detector also raised **no** unusual-activity alert while the
  genuine fire and smoke clips played (7 and 11 without calibration). On
  these clips calibration effectively switched the detector off.
- **Interaction check as a veto** removes 26.3 false alarms per hour on
  normal clips [+9.4, +51.3] (fight alarms 15 → 9), but loses 0.24 fight
  recall [0.17, 0.32]: 42 more of the 172 fights missed (0.73 → 0.48).
- **Region dynamics** had no measurable effect. No FIRESENSE look-alike
  triggered the fire detector even without it, so this proxy cannot test the
  check. It needs static look-alikes (orange cloth, lamps) from the target
  camera.
- **Overall (a → b):** false alarms fall by 101.5/h on normal clips
  [66.5, 148.9] and by 93.2/h on look-alikes [58.8, 143.4]. Fight recall
  falls from 0.78 to 0.48 and fall recall from 0.75 to 0.63 (Δ 0.11
  [0.05, 0.19]).

**Why the interaction check was changed from a veto to a review signal.**
In the first version of this ablation the veto cut fight recall from 0.78 to
0.47 while its false-alarm reduction on normal clips was not significant
(Δ 3.8/h, interval including 0), and section 6.7 shows why: the check finds
a close pair in only half of the fight clips (ROC AUC 0.55). A safety system
should not silently discard a fight the video model is confident about
because the tracker could not see two people close together. So the check no
longer decides whether a fight is reported, only how:

- the R3D-18 model and its 2-of-3 rule are unchanged;
- if the interaction check passes, the fight is CONFIRMED as before
  (pop-up, HIGH severity possible);
- if it fails, the fight is still reported, as PROBABLE: "Possible fight —
  please check" on the dashboard, at base severity and without a pop-up. If
  the same fight later passes the check, the incident is escalated to
  CONFIRMED and the pop-up appears.

**What review mode gives on the same clips** ((g) vs (b)):

| | (b) veto | (g) review | Δ (g − b) |
|---|---|---|---|
| Fight recall, pop-up alerts | 0.48 | 0.48 | +0.00 [−0.02, +0.02] |
| Fight recall incl. review items | 0.48 | **0.75** | **+0.27 [+0.20, +0.34]** |
| Review items on normal clips | – | 3 (11.3/h) | – |
| Review items on look-alikes | – | 2 (8.1/h) | – |
| Alerts on look-alikes | 16.2/h | 16.2/h | +0.0 |

Review mode recovers the fights the veto dropped (129 of 172 reach an
operator instead of 83) at the cost of 3 "please check" items on 16 minutes
of normal clips and 2 on the look-alikes, none of them a pop-up.

The alerts on normal clips differ by +15.0/h [+3.1, +33.0]: 19 vs 15. This is
run-to-run timing noise, not an effect of review mode. The four extra alarms
are two fights, one fall and one crowd alarm. Review mode cannot change fall
or crowd alarms, and both extra fights were CONFIRMED with the interaction
check *passing*, which the veto treats identically; in the (b) run the same
two clips simply never reached the second high R3D-18 score the 2-of-3 rule
needs (each run samples slightly different frames). The bootstrap interval
resamples clips, not runs, so it does not include this variation.

**Where the system fails.**

- **The research claim holds in part on these clips.** False alarms fall by
  about two thirds, but fight recall without the review queue (0.48) is
  lower than before the fixes (0.78); with it, 0.75 of fights reach an
  operator.
- **The fight model is now the largest source of false alarms** on the
  normal clips: 9 of 15 alarms in (b), 11 of 19 in (g). Falls are second
  (5–6).
- **No configuration reaches a usable rate.** The full system still raises
  56–71 false alarms per hour on clips from other cameras. On the deployment
  camera this rate is unknown.

**Caveats.**

- One run per configuration; the pipeline is timing-dependent, so a re-run
  can differ by an alert or a detection (see the (g) vs (b) alarms above).
- The first run of (g) took place while the PC was busy with other work: its
  fall clips played at about 2× real time and it lost 7 fall detections
  (recall 0.54). It was discarded and (g) was re-run from scratch on an idle
  machine, where fall recall matched (b) exactly (0.63).
- Fall and fire/smoke recall is in-sample for the fall model and the fire
  verifier.
- Wall time includes each clip's detector start-up; the longest look-alike
  clip (189 s) took 263 s, so its time-based rules saw it slightly slowed.
