from __future__ import annotations

import argparse
import csv
import json
import math
import sys
import time
from collections import defaultdict, deque
from pathlib import Path

import cv2
from ultralytics import YOLO

VIDEO_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv", ".mpeg", ".mpg"}


def safe_div(a: int, b: int) -> float:
    return a / b if b else 0.0


def infer_expected(path: Path, root: Path) -> tuple[str, int]:
    parts = [p.lower() for p in path.relative_to(root).parts]
    if len(parts) < 3 or parts[0] not in {"fire", "smoke"} or parts[1] not in {"pos", "neg"}:
        raise ValueError("expected path fire/pos, fire/neg, smoke/pos, or smoke/neg")
    return parts[0], int(parts[1] == "pos")


def max_hits_in_window(hits: list[bool], window: int) -> int:
    if not hits:
        return 0
    q: deque[bool] = deque(maxlen=window)
    best = 0
    for hit in hits:
        q.append(hit)
        best = max(best, sum(q))
    return best


def first_confirmation_index(hits: list[bool], window: int, required: int) -> int | None:
    q: deque[bool] = deque(maxlen=window)
    for index, hit in enumerate(hits):
        q.append(hit)
        if len(q) >= required and sum(q) >= required:
            return index
    return None


def evaluate_video(
    model: YOLO,
    path: Path,
    root: Path,
    sample_fps: float,
    thresholds: dict[str, float],
    window: int,
    required: int,
    device: str,
    imgsz: int,
) -> dict:
    target, expected_positive = infer_expected(path, root)
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        return {
            "video": str(path.relative_to(root)), "target": target,
            "expected_positive": expected_positive, "status": "open_failed",
        }

    native_fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
    total_native_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    if not math.isfinite(native_fps) or native_fps <= 0:
        native_fps = 25.0
    frame_step = max(native_fps / sample_fps, 1.0)
    next_sample = 0.0
    frame_index = 0
    sampled = 0
    scores: list[float] = []
    start = time.time()

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if frame_index + 1e-9 >= next_sample:
                result = model.predict(
                    source=frame,
                    conf=0.01,
                    imgsz=imgsz,
                    device=device,
                    verbose=False,
                )[0]
                best = {"smoke": 0.0, "fire": 0.0}
                if result.boxes is not None:
                    for cls_id, conf in zip(result.boxes.cls.tolist(), result.boxes.conf.tolist()):
                        class_name = model.names[int(cls_id)]
                        if class_name in best:
                            best[class_name] = max(best[class_name], float(conf))
                scores.append(best[target])
                sampled += 1
                next_sample += frame_step
            frame_index += 1
    finally:
        cap.release()

    threshold = thresholds[target]
    hits = [score >= threshold for score in scores]
    confirmation_index = first_confirmation_index(hits, window, required)
    max_window_hits = max_hits_in_window(hits, window)
    duration_s = frame_index / native_fps if native_fps else 0.0
    processing_s = time.time() - start
    status = "ok" if sampled else "decode_failed"

    return {
        "video": str(path.relative_to(root)),
        "target": target,
        "expected_positive": expected_positive,
        "status": status,
        "native_fps": round(native_fps, 3),
        "native_frames_read": frame_index,
        "reported_native_frames": total_native_frames,
        "duration_s": round(duration_s, 3),
        "sampled_frames": sampled,
        "threshold": threshold,
        "window": window,
        "required": required,
        "max_confidence": round(max(scores, default=0.0), 6),
        "hit_frames": sum(hits),
        "max_hits_in_window": max_window_hits,
        "confirmed": int(confirmation_index is not None),
        "first_confirmation_s": (
            round(confirmation_index / sample_fps, 3) if confirmation_index is not None else ""
        ),
        "processing_s": round(processing_s, 3),
    }


def metrics(rows: list[dict], target: str) -> dict:
    valid = [r for r in rows if r.get("target") == target and r.get("status") == "ok"]
    tp = sum(r["expected_positive"] == 1 and r["confirmed"] == 1 for r in valid)
    fp = sum(r["expected_positive"] == 0 and r["confirmed"] == 1 for r in valid)
    fn = sum(r["expected_positive"] == 1 and r["confirmed"] == 0 for r in valid)
    tn = sum(r["expected_positive"] == 0 and r["confirmed"] == 0 for r in valid)
    precision = safe_div(tp, tp + fp)
    recall = safe_div(tp, tp + fn)
    specificity = safe_div(tn, tn + fp)
    accuracy = safe_div(tp + tn, tp + fp + fn + tn)
    f1 = safe_div(2 * precision * recall, precision + recall)
    return {
        "target": target, "videos": len(valid), "TP": tp, "FP": fp, "FN": fn, "TN": tn,
        "precision": round(precision, 4), "recall": round(recall, 4),
        "specificity": round(specificity, 4), "accuracy": round(accuracy, 4), "f1": round(f1, 4),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Video-level fire/smoke temporal evaluator")
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--output", default=Path("output/fire_smoke_video_eval"), type=Path)
    parser.add_argument("--sample-fps", default=5.0, type=float)
    parser.add_argument("--fire-threshold", default=0.50, type=float)
    parser.add_argument("--smoke-threshold", default=0.50, type=float)
    parser.add_argument("--window", default=5, type=int)
    parser.add_argument("--required", default=3, type=int)
    parser.add_argument("--device", default="0")
    parser.add_argument("--imgsz", default=640, type=int)
    args = parser.parse_args()

    if not args.root.exists():
        parser.error(f"dataset root not found: {args.root}")
    if not args.model.exists():
        parser.error(f"model not found: {args.model}")
    if args.sample_fps <= 0 or args.window <= 0 or not (1 <= args.required <= args.window):
        parser.error("sample-fps/window/required values are invalid")

    videos = sorted(p for p in args.root.rglob("*") if p.is_file() and p.suffix.lower() in VIDEO_EXTENSIONS)
    if not videos:
        parser.error(f"no videos found under: {args.root}")

    args.output.mkdir(parents=True, exist_ok=True)
    model = YOLO(str(args.model))
    thresholds = {"fire": args.fire_threshold, "smoke": args.smoke_threshold}
    rows: list[dict] = []
    print(f"Found {len(videos)} videos. Sampling {args.sample_fps:g} FPS; persistence {args.required}/{args.window}.")

    for i, video in enumerate(videos, 1):
        try:
            row = evaluate_video(model, video, args.root, args.sample_fps, thresholds,
                                 args.window, args.required, args.device, args.imgsz)
        except Exception as exc:
            try:
                target, expected = infer_expected(video, args.root)
            except Exception:
                target, expected = "unknown", -1
            row = {"video": str(video.relative_to(args.root)), "target": target,
                   "expected_positive": expected, "status": f"error: {type(exc).__name__}: {exc}"}
        rows.append(row)
        print(f"[{i:02d}/{len(videos)}] {row['video']} status={row['status']} "
              f"max={row.get('max_confidence', '')} confirmed={row.get('confirmed', '')}", flush=True)

    fieldnames = [
        "video", "target", "expected_positive", "status", "native_fps", "native_frames_read",
        "reported_native_frames", "duration_s", "sampled_frames", "threshold", "window", "required",
        "max_confidence", "hit_frames", "max_hits_in_window", "confirmed", "first_confirmation_s",
        "processing_s",
    ]
    csv_path = args.output / "per_video_results.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)

    summary = {
        "configuration": {
            "model": str(args.model), "root": str(args.root), "sample_fps": args.sample_fps,
            "fire_threshold": args.fire_threshold, "smoke_threshold": args.smoke_threshold,
            "window": args.window, "required": args.required, "imgsz": args.imgsz,
        },
        "fire": metrics(rows, "fire"),
        "smoke": metrics(rows, "smoke"),
        "failed_videos": [r["video"] for r in rows if r.get("status") != "ok"],
    }
    json_path = args.output / "summary.json"
    json_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))
    print(f"Saved: {csv_path}")
    print(f"Saved: {json_path}")
    return 0


if __name__ == "__main__":
    from env_loader import load_env

    load_env()
    sys.exit(main())
