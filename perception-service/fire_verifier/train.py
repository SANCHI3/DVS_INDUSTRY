"""Train the fire/smoke verifier and compare YOLO-only vs YOLO + verifier.

    python -m fire_verifier.train --root data/fire_smoke_videos/firesense \
        --yolo models/fire_smoke_yolov8n_v1.pt --output models/fire_smoke_verifier_v1.pkl

Videos are sampled exactly like evaluate_fire_smoke_videos.py (5 fps, 3-of-5
persistence at confidence 0.5), so the YOLO-only numbers reproduce the
existing baseline. Every 1-second window with a plausible detection
(conf >= 0.25) becomes a training sample labelled with its video's label.
Evaluation is leave-one-video-out at a fixed 0.5 verifier threshold; an alert
needs --required-verified (2) verified windows, mirroring YOLO's own 3-of-5
persistence so a single stray window cannot raise an alarm.
"""
from __future__ import annotations

import argparse
import json
import pickle
from collections import deque
from pathlib import Path

import cv2
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier

from fire_verifier.features import FEATURE_NAMES, best_boxes, stack_window, window_features

VIDEO_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv", ".webm", ".m4v"}


def list_videos(root: Path):
    out = []
    for target in ("fire", "smoke"):
        for polarity, label in (("pos", 1), ("neg", 0)):
            folder = root / target / polarity
            for path in sorted(folder.glob("*")):
                if path.suffix.lower() in VIDEO_EXTENSIONS:
                    out.append({"path": path, "target": target, "label": label})
    return out


def extract(model, video, sample_fps, window, required, conf_hit, conf_floor, imgsz, device):
    """Per-window features + whether YOLO-only would have triggered."""
    cap = cv2.VideoCapture(str(video["path"]))
    step = max((cap.get(cv2.CAP_PROP_FPS) or 25.0) / sample_fps, 1.0)
    history: deque = deque(maxlen=window)
    hits: deque = deque(maxlen=window)
    rows, triggers = [], []
    index, next_pick = 0, 0.0
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if index >= next_pick:
                next_pick += step
                result = model.predict(source=frame, conf=0.01, imgsz=imgsz, device=device, verbose=False)[0]
                best = best_boxes(result, model.names)
                scale = 480.0 / max(frame.shape[1], 1)
                small = cv2.resize(frame, (480, int(frame.shape[0] * scale))) if scale < 1 else frame
                if scale < 1:
                    best = {k: (tuple(c * scale for c in v[0]), v[1]) if v else None for k, v in best.items()}
                history.append({"frame": small, **best})
                det = best[video["target"]]
                hits.append(det is not None and det[1] >= conf_hit)
                if len(history) == window:
                    frames, boxes, confs = stack_window(list(history), video["target"])
                    if max(confs) >= conf_floor:
                        feats = window_features(frames, boxes, confs, video["target"] == "fire")
                        if feats is not None:
                            rows.append(feats)
                            triggers.append(sum(hits) >= required)
            index += 1
    finally:
        cap.release()
    return np.asarray(rows, np.float32).reshape(-1, len(FEATURE_NAMES)), np.asarray(triggers, bool)


def make_model():
    return HistGradientBoostingClassifier(max_depth=3, learning_rate=0.08, max_iter=250,
                                          l2_regularization=1.0, class_weight="balanced",
                                          random_state=0)


def summarize(labels, preds):
    labels, preds = np.asarray(labels), np.asarray(preds)
    tp = int(np.sum(preds & (labels == 1))); fp = int(np.sum(preds & (labels == 0)))
    fn = int(np.sum(~preds & (labels == 1))); tn = int(np.sum(~preds & (labels == 0)))
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    return {"videos": len(labels), "TP": tp, "FP": fp, "FN": fn, "TN": tn,
            "precision": round(precision, 4), "recall": round(recall, 4),
            "specificity": round(tn / (tn + fp), 4) if tn + fp else 0.0,
            "f1": round(2 * precision * recall / (precision + recall), 4) if precision + recall else 0.0}


def main():
    parser = argparse.ArgumentParser(description="Train the fire/smoke verifier")
    parser.add_argument("--root", default="data/fire_smoke_videos/firesense")
    parser.add_argument("--yolo", default="models/fire_smoke_yolov8n_v1.pt")
    parser.add_argument("--output", default="models/fire_smoke_verifier_v1.pkl")
    parser.add_argument("--cache", default="data/fire_verifier_features.npz")
    parser.add_argument("--sample-fps", type=float, default=5.0)
    parser.add_argument("--window", type=int, default=5)
    parser.add_argument("--required", type=int, default=3)
    parser.add_argument("--conf-hit", type=float, default=0.5)
    parser.add_argument("--conf-floor", type=float, default=0.25)
    parser.add_argument("--threshold", type=float, default=0.5)
    parser.add_argument("--required-verified", type=int, default=2,
                        help="verified windows needed per alert (persistence, like YOLO's 3-of-5)")
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--device", default="0")
    args = parser.parse_args()

    videos = list_videos(Path(args.root))
    cache = Path(args.cache)
    if cache.exists():
        data = np.load(cache, allow_pickle=True)
        per_video = list(data["per_video"])
        print(f"loaded cached features for {len(per_video)} videos", flush=True)
    else:
        from ultralytics import YOLO
        model = YOLO(args.yolo)
        per_video = []
        for i, video in enumerate(videos, 1):
            x, trig = extract(model, video, args.sample_fps, args.window, args.required,
                              args.conf_hit, args.conf_floor, args.imgsz, args.device)
            per_video.append({"x": x, "trigger": trig})
            print(f"[{i}/{len(videos)}] {video['target']}/{video['label']} {video['path'].name}: "
                  f"{len(x)} windows, yolo_trigger={bool(trig.any())}", flush=True)
        cache.parent.mkdir(parents=True, exist_ok=True)
        np.savez(cache, per_video=np.array(per_video, dtype=object))

    labels = np.array([v["label"] for v in videos])
    targets = np.array([v["target"] for v in videos])

    # Leave-one-video-out
    yolo_only, verified = [], []
    for i in range(len(videos)):
        train = [j for j in range(len(videos)) if j != i and len(per_video[j]["x"])]
        x = np.concatenate([per_video[j]["x"] for j in train])
        y = np.concatenate([np.full(len(per_video[j]["x"]), labels[j]) for j in train])
        w = np.concatenate([np.full(len(per_video[j]["x"]), 1.0 / len(per_video[j]["x"])) for j in train])
        trig = per_video[i]["trigger"]
        yolo_only.append(bool(trig.any()))
        if not trig.any():
            verified.append(False)
            continue
        clf = make_model().fit(x, y, sample_weight=w)
        probs = clf.predict_proba(per_video[i]["x"][trig])[:, 1]
        verified.append(int((probs >= args.threshold).sum()) >= args.required_verified)

    yolo_only, verified = np.array(yolo_only), np.array(verified)
    report = {"config": vars(args), "evaluation": "leave-one-video-out", "features": FEATURE_NAMES}
    for target in ("fire", "smoke"):
        m = targets == target
        report[target] = {"yolo_only": summarize(labels[m], yolo_only[m]),
                          "yolo_plus_verifier": summarize(labels[m], verified[m])}

    # Final verifier on all videos
    usable = [j for j in range(len(videos)) if len(per_video[j]["x"])]
    x = np.concatenate([per_video[j]["x"] for j in usable])
    y = np.concatenate([np.full(len(per_video[j]["x"]), labels[j]) for j in usable])
    w = np.concatenate([np.full(len(per_video[j]["x"]), 1.0 / len(per_video[j]["x"])) for j in usable])
    final = make_model().fit(x, y, sample_weight=w)
    output = Path(args.output); output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("wb") as handle:
        pickle.dump({"model": final, "features": FEATURE_NAMES, "threshold": args.threshold,
                     "required_verified": args.required_verified, "window": args.window}, handle)
    output.with_suffix(".metrics.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({t: report[t] for t in ("fire", "smoke")}, indent=2))


if __name__ == "__main__":
    main()
