CROWD DETECTION PATCH
=====================

Changes
- Counts only recently updated, mature person tracks.
- Requires a spatial cluster instead of counting everyone in the frame.
- Enforces sustained_seconds using elapsed time.
- Supports optional crowd zones in cameras.yaml.
- Uses exit grace to tolerate short YOLO/ByteTrack flicker.
- Emits one camera-level candidate compatible with existing confirmation.

Install (PowerShell, from project root)
1. Back up the three replaced files:
   Copy-Item temporal\rule_engine.py temporal\rule_engine.before-crowd.py
   Copy-Item config\thresholds.yaml config\thresholds.before-crowd.yaml
2. Expand the ZIP into the project root:
   Expand-Archive .\crowd-gathering-patch.zip -DestinationPath . -Force
3. Run tests:
   py -3.12 -u test_crowd_logic.py
   py -3.12 -u test_rules_logic.py

Optional zone in config/cameras.yaml
------------------------------------
Add crowd_enabled: true to an existing polygon, or define a zone with
type: crowd. If no crowd zone exists, the full frame is evaluated.

Important
- person_count_threshold: 4 is a starter value, not a universal definition.
- Test against ordinary walking, queues, workers passing through, and actual
  gatherings before changing alert severity.
- The patch does not alter fight or fire/smoke model files.
