Fire/Smoke Video Evaluator

Purpose
- Evaluates the trained YOLO fire/smoke model on the FIRESENSE-style folder structure.
- Samples each video at 5 FPS.
- Uses class-specific confidence thresholds.
- Confirms an event when at least 3 of the latest 5 sampled frames are positive.
- Produces video-level TP, FP, FN, TN, precision, recall, specificity, accuracy, and F1.

Expected dataset structure
  data/fire_smoke_videos/firesense/fire/pos/*.avi
  data/fire_smoke_videos/firesense/fire/neg/*.avi
  data/fire_smoke_videos/firesense/smoke/pos/*.avi
  data/fire_smoke_videos/firesense/smoke/neg/*.avi

Copy evaluate_fire_smoke_videos.py to the perception-service project root, then run:

py -3.12 -u evaluate_fire_smoke_videos.py `
  --root data/fire_smoke_videos/firesense `
  --model models/fire_smoke_yolov8n_v1.pt `
  --output output/fire_smoke_video_eval_v1 `
  --sample-fps 5 `
  --fire-threshold 0.50 `
  --smoke-threshold 0.50 `
  --window 5 `
  --required 3 `
  --device 0 2>&1 | Tee-Object fire_smoke_video_eval_v1.log

Outputs
  output/fire_smoke_video_eval_v1/per_video_results.csv
  output/fire_smoke_video_eval_v1/summary.json

If a video cannot be decoded, it is recorded in failed_videos instead of silently counted as a negative.
