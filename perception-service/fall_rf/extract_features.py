"""Run YOLOv8-Pose over labelled videos and build the fall-feature manifest.

Expected layout (already present in this repo):

    data/fall_videos/fall/*.mp4
    data/fall_videos/not_fall/*.mp4

Run from the perception-service folder:

    python -m fall_rf.extract_features --input data/fall_videos --output data/fall_features

Outputs
    data/fall_features/poses/<class>__<video>.npz   raw keypoint tracks (cached, re-used on re-runs)
    data/fall_features/manifest.csv                 one row per 2-second window

Weak labelling (no frame-level annotation needed)
    The fall clips are trimmed around the fall but also contain standing /
    walking before it. A window from a fall video is used as a POSITIVE only
    if it shows the person ending up on the ground AND the drop itself
    (torso rotation or hip/head descent). Other windows of fall videos are
    marked use_for_training=0 (ambiguous) but are still scored during
    video-level evaluation. Every window of a not_fall video is a NEGATIVE,
    including deliberate lying down, sitting and bending -- these hard
    negatives force the model to learn the *speed* of a fall, not just the
    final posture.
"""
from __future__ import annotations

import argparse
import csv
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np

from fall_rf.features import FEATURE_NAMES, PoseSample, physics_score, window_features

VIDEO_EXT = {".mp4", ".avi", ".mov", ".mkv", ".mpg", ".mpeg"}


def _iou(a, b) -> float:
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def extract_pose_track(model, path: str, sample_fps: float, device, conf: float = 0.3):
    """Return (times, keypoints[T,17,3], bboxes[T,4], valid[T]) for the main person."""
    import cv2

    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise IOError(f"cannot open {path}")
    native = cap.get(cv2.CAP_PROP_FPS) or 25.0
    step = max(1, int(round(native / sample_fps)))
    times, kps, boxes, valid = [], [], [], []
    prev_box: Optional[Tuple[float, ...]] = None
    index = 0
    while True:
        ok = cap.grab()
        if not ok:
            break
        if index % step == 0:
            ok, frame = cap.retrieve()
            if not ok:
                break
            result = model(frame, verbose=False, device=device, conf=conf)[0]
            chosen = None
            if result.boxes is not None and result.keypoints is not None and len(result.boxes):
                xyxy = result.boxes.xyxy.cpu().numpy()
                confs = result.boxes.conf.cpu().numpy()
                kxy = result.keypoints.xy.cpu().numpy()
                kcf = (result.keypoints.conf.cpu().numpy() if result.keypoints.conf is not None
                       else np.ones(kxy.shape[:2]))
                if prev_box is not None:
                    ious = [_iou(prev_box, b) for b in xyxy]
                    best = int(np.argmax(ious))
                    chosen = best if ious[best] > 0.1 else None
                if chosen is None:  # largest confident person
                    areas = (xyxy[:, 2] - xyxy[:, 0]) * (xyxy[:, 3] - xyxy[:, 1])
                    chosen = int(np.argmax(areas * confs))
                box = tuple(float(v) for v in xyxy[chosen])
                prev_box = box
                kps.append(np.concatenate([kxy[chosen], kcf[chosen].reshape(-1, 1)], axis=1))
                boxes.append(box)
                valid.append(True)
            else:
                kps.append(np.zeros((17, 3)))
                boxes.append((0.0, 0.0, 0.0, 0.0))
                valid.append(False)
            times.append(index / native)
        index += 1
    cap.release()
    return (np.asarray(times, float), np.asarray(kps, float).reshape(-1, 17, 3),
            np.asarray(boxes, float).reshape(-1, 4), np.asarray(valid, bool))


def windows_from_track(times, kps, boxes, valid, window_s: float, stride_s: float):
    """Yield (t_end, feature_vector) for sliding windows over a pose track."""
    if len(times) == 0:
        return
    t = times[0] + window_s
    while t <= times[-1] + 1e-6:
        sel = (times > t - window_s) & (times <= t) & valid
        samples = [PoseSample(float(ti), k, tuple(b)) for ti, k, b in zip(times[sel], kps[sel], boxes[sel])]
        feats = window_features(samples)
        if feats is not None:
            yield float(t), feats
        t += stride_s


def is_fall_window(features: np.ndarray) -> bool:
    f = dict(zip(FEATURE_NAMES, features))
    on_ground = f["torso_angle_end"] > 45.0 or f["head_height_end"] < 0.5
    has_drop = f["torso_angle_change"] > 25.0 or f["hip_drop"] > 0.25 or f["head_drop"] > 0.3
    return bool(on_ground and has_drop)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input", default="data/fall_videos")
    parser.add_argument("--output", default="data/fall_features")
    parser.add_argument("--pose-model", default="yolov8n-pose.pt")
    parser.add_argument("--device", default=None, help="0 for first GPU, cpu for CPU (default: auto)")
    parser.add_argument("--sample-fps", type=float, default=10.0)
    parser.add_argument("--window-seconds", type=float, default=2.0)
    parser.add_argument("--stride-seconds", type=float, default=0.5)
    args = parser.parse_args()

    from ultralytics import YOLO

    model = YOLO(args.pose_model)
    out = Path(args.output)
    (out / "poses").mkdir(parents=True, exist_ok=True)
    classes = {"fall": 1, "not_fall": 0}
    rows: List[dict] = []
    for cls, label in classes.items():
        folder = Path(args.input) / cls
        videos = sorted(p for p in folder.glob("*") if p.suffix.lower() in VIDEO_EXT)
        print(f"{cls}: {len(videos)} videos")
        for i, video in enumerate(videos, 1):
            cache = out / "poses" / f"{cls}__{video.stem}.npz"
            if cache.exists():
                d = np.load(cache)
                times, kps, boxes, valid = d["times"], d["kps"], d["boxes"], d["valid"]
            else:
                times, kps, boxes, valid = extract_pose_track(model, str(video), args.sample_fps, args.device)
                np.savez_compressed(cache, times=times, kps=kps, boxes=boxes, valid=valid)
            n_before = len(rows)
            for w_idx, (t_end, feats) in enumerate(windows_from_track(
                    times, kps, boxes, valid, args.window_seconds, args.stride_seconds)):
                use = 1 if label == 0 else int(is_fall_window(feats))
                rows.append({"video": f"{cls}/{video.name}", "label": label, "window": w_idx,
                             "t_end": round(t_end, 2), "use_for_training": use,
                             "physics_score": round(physics_score(feats), 4),
                             **{n: round(float(v), 5) for n, v in zip(FEATURE_NAMES, feats)}})
            print(f"  [{i}/{len(videos)}] {video.name}: {int(valid.sum())}/{len(valid)} frames with a person, "
                  f"{len(rows) - n_before} windows")

    manifest = out / "manifest.csv"
    with open(manifest, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    pos = sum(1 for r in rows if r["label"] == 1 and r["use_for_training"])
    neg = sum(1 for r in rows if r["label"] == 0)
    print(f"wrote {manifest}: {len(rows)} windows ({pos} positive, {neg} negative, "
          f"{len(rows) - pos - neg} ambiguous fall-video windows)")


if __name__ == "__main__":
    main()
