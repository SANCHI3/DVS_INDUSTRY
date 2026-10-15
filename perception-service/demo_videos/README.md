# Demo videos

`python main.py --demo` plays every video in this folder (`.mp4 .avi .mov .mkv
.webm .m4v`) in name order, in a loop, through the full pipeline. No camera
is needed. Incidents go to the dashboard exactly as they would from a camera.

## Getting the clips

If the training datasets are in `perception-service/data/`, run:

```bash
python scripts/prepare_demo_videos.py
```

It copies these four clips. Each was run through the pipeline on its own and
produced the result shown:

| File | Source (under `data/`) | Result when played alone |
|---|---|---|
| `01_normal_activity.mp4` | `fall_videos/not_fall/01.mp4` (8 s) | no incident |
| `02_fight.mp4` | `fight_videos/fight/V_377.mp4` (11 s, fight-model test split) | 1 CONFIRMED fight |
| `03_fire.avi` | `fire_smoke_videos/firesense/fire/pos/posVideo9.878.avi` (22 s) | 1 fire incident (PROBABLE, then CONFIRMED; the dashboard receives one) |
| `04_fall.mp4` | `fall_videos/fall/01.mp4` (5 s) | 1 CONFIRMED fall |

The videos themselves are not committed, because the datasets' redistribution
terms vary. Only this README is tracked.

## Using your own clips

Any short clips work. Name them so they sort in the order you want:

- **Normal activity:** 10–30 s of people walking or working.
- **Fight:** 5–15 s with two or more people grappling or punching, close
  together. A fight incident also needs the interaction check: two people
  close for at least 1 s and moving in an agitated way.
- **Fire:** 10–30 s of a visible, flickering flame. The fire must stay in view
  for about 3 s to be CONFIRMED.
- **Fall:** 5–10 s of one person, whole body visible, falling to the floor.

## What to expect

- Incidents appear on the Security page within a few seconds of the event in
  the clip, together with the popup alert.
- **One event = one incident.** When the playlist loops, repeats of the same
  event type within its dedup window (`incident_dedup` in
  `config/thresholds.yaml`, 45–60 s) update the open incident instead of
  creating a new one. Restart the service to trigger fresh incidents.
- **Unusual-activity alerts are silent for the first 5 minutes.** The scene
  anomaly detector calibrates first. In demo mode its calibration is stored
  separately (`output/calibration/demo/`), so the demo clips never change the
  real camera's calibration.
- Clips from different datasets have different resolutions and frame rates.
  The pipeline resizes everything to 640×480 and samples at 10 fps.
