# 7. Limitations and future scope

## 7.1 Limitations

1. **Domain gap.** All models were trained and tested on public datasets
   (movies, street CCTV, staged falls, FIRESENSE), not on the factory's own
   cameras. On the real test camera the fight classifier scored ordinary
   activity high. The interaction check now blocks those cases, but the
   classifier itself was not retrained.
2. **False-alarm rate not yet measured on site.** The per-hour measurement on
   normal footage is prepared but not run (chapter 6.5).
3. **Small evaluation sets for some tasks.** Fire (27 videos) and smoke (22)
   are small. The fall model used 160 videos from 48 events, so
   cross-validation was used instead of a single test split.
4. **Placeholder zones.** The restricted zones in `config/cameras.yaml` are
   examples covering whole thirds of the frame. Lingering and intrusion alerts
   are only meaningful after the real areas are drawn.
5. **Unusual-activity detector.** It is silent for the first 5 minutes on each
   camera while calibrating, and an incident during calibration raises the
   threshold. Recall is moderate (0.67).
6. **Single-process event bus.** The SSE stream uses an in-process bus, so
   running several backend workers (PM2 cluster) needs a shared bus such as
   Redis or PostgreSQL LISTEN/NOTIFY.
7. **Evidence storage is local.** Evidence lives on the perception machine's
   disk. The dashboard reads it through the backend only when both run on
   the same machine or share a folder (`PERCEPTION_OUTPUT_DIR`). Clips are
   saved as MPEG-4 Part 2, which browsers do not play inline, so they are
   offered as downloads.
8. **CPU-only operation.** It runs at about 6 frames/s instead of 10, and
   time-based detectors (fall) can miss short events. A native crash was seen
   intermittently in CPU-only runs (2 of 6), so the start script restarts the
   service.
9. **Pose-LSTM fallback.** Its metrics are reported, but its weights are not
   in the repository.
10. **Dataset provenance.** The sources of some training datasets are
    inferred from file naming and must be confirmed (chapter 2).

## 7.2 Future scope

- **Site adaptation:** fine-tune the fight and fall models and retrain the
  autoencoder on 20–60 minutes of each camera's own footage; tune the
  interaction thresholds from logged values.
- **Measure on site:** false alarms per camera-hour and detection latency on
  long real recordings, before and after each change.
- **Multi-camera scale:** a shared event bus, a camera registry with health
  status (online/offline), and GPU batching across cameras.
- **Evidence:** H.264 clips for in-browser playback, central evidence storage
  with retention rules, and a review workflow ("true alarm / false alarm")
  whose labels feed retraining.
- **More incident types:** PPE (helmet, vest) detection, which zones already
  support (`ppe_required`); smoking; vehicle–person proximity.
- **Privacy:** face blurring in saved evidence and role-limited access to
  clips.
- **Notifications:** SMS / e-mail / push for CRITICAL incidents outside the
  dashboard.
