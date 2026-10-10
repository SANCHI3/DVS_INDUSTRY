# RGB Fight Classifier (R3D-18)

Transfer-learning classifier using torchvision's Kinetics-pretrained R3D-18.
Input clips are 16 RGB frames at 112x112. All train/validation/test splits are
made at video level.

## Train/serve alignment (v2)

The live pipeline processes frames at `perception.detection_fps` (10 by
default). v2 training samples each clip at the same real-time rate
(`--clip-fps 10`, so 16 frames span 1.5 s) whatever the source video's frame
rate. The checkpoint records `clip_fps`, and `RgbFightDetector` then rebuilds
live clips from frame timestamps, so the model sees motion at the same speed
in production as in training, even when processing runs faster or slower.

Older checkpoints without `clip_fps` (e.g. `fight_r3d18_v1.pt`) keep the
legacy behaviour: training used a fixed `--temporal-stride`, and the runtime
uses the last 16 processed frames.

Validation and test score each video as the mean over `--eval-clips` evenly
spaced clips (3 by default), which is more stable than one centre clip.

## 1. Manifest

```powershell
py -3.12 -m rgb_fight_model.make_manifest --input data\fight_videos --output data\rgb_fight_manifest.csv
```

Paths are written relative to the manifest so the project folder can move.
If several files were cut from the same source video, keep them in one split
with `--group-regex`, e.g. `--group-regex "(.+)_clip\d+"`.

An existing manifest with stale absolute paths can still be used with
`--data-root data\fight_videos`; its exact splits are kept.

## 2. Training

Close memory-heavy applications first: decoding plus CUDA needs roughly
4–6 GB of free RAM. Use `--workers 0` on machines with little free memory.

```powershell
py -3.12 -u -m rgb_fight_model.train --manifest data\rgb_fight_manifest.csv --data-root data\fight_videos --output models\fight_r3d18_v2.pt --epochs 15 --batch-size 2 --workers 0 --freeze-backbone-epochs 2 --clip-fps 10 --eval-clips 3 --min-validation-precision 0.85
```

Training uses a cosine learning-rate schedule, per-clip brightness/contrast
and occasional grayscale augmentation (CCTV lighting and IR night mode), and
selects the checkpoint on validation F1 at the precision floor, with ROC-AUC as
tie-breaker. The test split is scored once, with the validation-chosen
threshold. `models\fight_r3d18_v2.metrics.json` records config, history,
validation and test metrics.

The first run downloads pretrained R3D-18 weights. If CUDA runs out of memory,
set `--batch-size 1`.

## 3. Single-video inference

```powershell
py -3.12 -m rgb_fight_model.infer data\fight_videos\fight\fi029.mp4 --checkpoint models\fight_r3d18_v2.pt
```

## 4. Video-level test evaluation

```powershell
py -3.12 -u -m rgb_fight_model.evaluate --manifest data\rgb_fight_manifest.csv --data-root data\fight_videos --checkpoint models\fight_r3d18_v2.pt --split test --output output\rgb_fight_test_scores.csv
```

## 5. Switching the live pipeline

Compare `test` in `fight_r3d18_v2.metrics.json` with `fight_r3d18_v1.metrics.json`
(same split), then set `fight_detection.rgb.checkpoint` in
`config/thresholds.yaml`. Re-check `probable_threshold`/`confirmed_threshold`
against the new checkpoint's validation threshold before deploying.
