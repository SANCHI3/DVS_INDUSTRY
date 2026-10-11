"""Extract per-frame pose/box feature sequences from labelled fall videos.

    python -m fall_gru.extract --input data/fall_videos --output data/fall_gru_features

Expects <input>/fall/*.mp4 and <input>/not_fall/*.mp4. Videos are sampled at
--fps (default 10, the live pipeline's detection rate). Files sharing a
numeric prefix ("01.mp4", "01 (2).mp4", ...) are treated as one event filmed
from several angles and share a group id, so splits never leak an event.
"""
from __future__ import annotations

import argparse
import csv
import re
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

from fall_gru.features import build_sequence, frame_features

VIDEO_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv", ".webm", ".m4v"}


def group_of(cls: str, path: Path) -> str:
    match = re.match(r"^\s*(\d+)", path.stem)
    return f"{cls}/{match.group(1) if match else path.stem}"


def iou(a, b) -> float:
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def pick_person(boxes: np.ndarray, previous) -> Optional[int]:
    """Follow the same person: best overlap with the previous box, else the largest."""
    if len(boxes) == 0:
        return None
    if previous is not None:
        overlaps = [iou(previous, b) for b in boxes]
        best = int(np.argmax(overlaps))
        if overlaps[best] > 0.1:
            return best
    areas = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])
    return int(np.argmax(areas))


def extract_video(model, path: Path, fps: float, conf: float) -> np.ndarray:
    cap = cv2.VideoCapture(str(path))
    source_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    step = max(source_fps / fps, 1.0)
    frames, next_pick, index, previous = [], 0.0, 0, None
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if index >= next_pick:
                next_pick += step
                result = model(frame, verbose=False, conf=conf)[0]
                boxes = result.boxes.xyxy.cpu().numpy() if result.boxes is not None else np.zeros((0, 4))
                chosen = pick_person(boxes, previous)
                if chosen is None:
                    frames.append(None)
                else:
                    kps = None
                    if result.keypoints is not None and result.keypoints.data is not None:
                        kps = result.keypoints.data[chosen].cpu().numpy()
                    previous = boxes[chosen]
                    frames.append(frame_features(previous, frame.shape[0], kps))
            index += 1
    finally:
        cap.release()
    return build_sequence(frames, fps)


def main():
    parser = argparse.ArgumentParser(description="Extract fall feature sequences")
    parser.add_argument("--input", default="data/fall_videos")
    parser.add_argument("--output", default="data/fall_gru_features")
    parser.add_argument("--pose-model", default="yolov8n-pose.pt")
    parser.add_argument("--fps", type=float, default=10.0)
    parser.add_argument("--conf", type=float, default=0.3)
    args = parser.parse_args()

    from ultralytics import YOLO

    model = YOLO(args.pose_model)
    root, out = Path(args.input), Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    rows = []
    for cls, label in (("fall", 1), ("not_fall", 0)):
        videos = sorted(p for p in (root / cls).glob("*") if p.suffix.lower() in VIDEO_EXTENSIONS)
        for i, path in enumerate(videos, 1):
            seq = extract_video(model, path, args.fps, args.conf)
            name = f"{cls}__{path.stem.replace(' ', '_').replace('(', '').replace(')', '')}.npy"
            np.save(out / name, seq)
            rows.append({"file": name, "label": label, "group": group_of(cls, path),
                         "frames": len(seq), "source": path.as_posix()})
            print(f"[{cls} {i}/{len(videos)}] {path.name}: {len(seq)} steps, "
                  f"person in {int(seq[:, -1].sum()) if len(seq) else 0}", flush=True)

    with (out / "index.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["file", "label", "group", "frames", "source"])
        writer.writeheader()
        writer.writerows(rows)
    print({"videos": len(rows), "groups": len({r["group"] for r in rows}), "output": str(out)})


if __name__ == "__main__":
    main()
