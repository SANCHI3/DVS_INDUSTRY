# 7. Limitations and future scope

## 7.1 Limitations

1. **Domain gap.** All models were trained and tested on public datasets
   (movies, street CCTV, staged falls, FIRESENSE), not on the factory's own
   cameras. On the real test camera the fight classifier scored ordinary
   activity high. The interaction check now blocks those cases, but the
   classifier itself was not retrained.
2. **False-alarm rate not measured on site.** The per-hour rate on the
   deployment camera is still unknown. The ablation (chapter 6.8) used 472
   held-out and public clips from many other cameras as a proxy. On those
   clips the full system still raised 135 false alarms per hour on normal
   activity, and 45 per hour on fire look-alike scenes.
3. **The fight interaction check costs more than it saves on public clips.**
   With it, fight recall on the held-out test split falls from 0.75 to 0.47.
   It removes 6 false alarms and misses 48 more fights. Closeness of a pair
   does not separate fight from normal clips (51% of each), and agitation
   separates them only weakly (AUC 0.55, chapter 6.7). Tracking cannot see
   the interaction when grappling people are merged into one box or lose
   their tracks. The check was designed for one room's failure (people
   standing close and talking) and has not been validated on that room's
   footage.
4. **Anomaly calibration can silence the detector.** Calibrated on short
   clips from other cameras, the threshold rose 8.7×. The detector then
   raised no unusual-activity alert at all, also not on genuine fire and
   smoke clips. Calibration on a single fixed camera, as designed, may
   behave differently; this is unmeasured.
5. **Region dynamics is untested by data.** No FIRESENSE look-alike
   triggered the fire detector, so the ablation could not show an effect
   either way. It is supported only by the unit-test scenarios.
6. **The fall detector dominates false alarms.** It produced 22 of the 36
   false alarms on normal clips. No verification stage targets it, and its
   recall (0.75) was measured on clips it was trained on.
7. **Persistence trades recall for quiet.** Requiring N of M windows removes
   83 false alarms per hour on normal clips. It also costs 0.16 fall recall,
   and fire and smoke lose detections too (8 vs 10 of 11 fires, 8 vs 11 of
   13 smoke), though those two intervals reach 0.
8. **Small evaluation sets for some tasks.** Fire (27 videos) and smoke (22)
   are small. The fall model used 160 videos from 48 events, so
   cross-validation was used instead of a single test split.
9. **Unusual-activity detector.** It is silent for the first 5 minutes on each
   camera while calibrating, and an incident during calibration raises the
   threshold. Recall is moderate (0.67). A version trained on 6 minutes of the
   factory's own footage (v3) raised more false alerts than v2 in
   cross-validation, so it needs 20–60 minutes of footage per camera before
   it can replace v2 (results chapter, section 7 of RESULTS.md).
10. **Single-process event bus.** The SSE stream uses an in-process bus, so
   running several backend workers (PM2 cluster) needs a shared bus such as
   Redis or PostgreSQL LISTEN/NOTIFY.
11. **Evidence storage is local.** Evidence lives on the perception machine's
   disk. The dashboard reads it through the backend only when both run on
   the same machine or share a folder (`PERCEPTION_OUTPUT_DIR`). Clips are
   saved as MPEG-4 Part 2, which browsers do not play inline, so they are
   offered as downloads.
12. **CPU-only operation.** It runs at about 6 frames/s instead of 10, and
   time-based detectors (fall) can miss short events. A native crash was seen
   intermittently in CPU-only runs (2 of 6), so the start script restarts the
   service.
13. **Pose-LSTM experiment.** An earlier pose-sequence LSTM fight model was
   evaluated (its metrics are reported for comparison), but it was not
   deployed and its code has been removed in favour of R3D-18.
14. **Dataset provenance.** The sources of some training datasets are
    inferred from file naming and must be confirmed (chapter 2).
15. **Statistics are incomplete.** Fight, fall and fire/smoke-with-verifier
    metrics store only aggregate counts, so they have no confidence interval,
    and fight v1 vs v2 could not be tested for significance (McNemar).
16. **Single runs.** Each ablation configuration was run once. The pipeline
    is timing-dependent, so a re-run can differ by an alert or a detection.

## 7.2 Future scope

- **Site adaptation:** fine-tune the fight and fall models and retrain the
  autoencoder on 20–60 minutes of each camera's own footage; tune the
  interaction thresholds from logged values.
- **Measure on site:** record 15–30 minutes of normal activity, staged
  events and look-alikes from the deployment camera into
  `perception-service/field_data/` and re-run `python -m evaluation.ablation run`.
  It switches to those recordings automatically.
- **Rethink the fight check:** use the interaction evidence as a severity or
  review signal rather than a hard gate, or require it only when the R3D
  score is marginal. Re-tune the agitation threshold on field data; on the
  public clips 0.2 separated better than 0.1 (chapter 6.7).
- **Guard calibration:** cap the camera scale and check calibrated recall on
  known events before accepting a calibration.
- **Fall false alarms:** add a verification stage for falls, for example
  requiring the person to stay down, as the serious-fall escalation already
  tracks.
- **Per-video predictions:** save per-video scores in every evaluation
  script, so every metric can get a confidence interval and paired tests.
- **Multi-camera scale:** a shared event bus, a camera registry with health
  status (online/offline), and GPU batching across cameras.
- **Evidence:** H.264 clips for in-browser playback, central evidence storage
  with retention rules, and a review workflow ("true alarm / false alarm")
  whose labels feed retraining.
- **More incident types:** PPE (helmet, vest) detection; smoking;
  vehicle–person proximity.
- **Privacy:** face blurring in saved evidence and role-limited access to
  clips.
- **Notifications:** SMS / e-mail / push for CRITICAL incidents outside the
  dashboard.
