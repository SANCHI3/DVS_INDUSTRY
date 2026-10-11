"""Calibrate live alert thresholds for an RGB fight checkpoint, and compare models fairly.

    python -m rgb_fight_model.calibrate_runtime --manifest data/rgb_fight_manifest.csv \
        --data-root data/fight_videos --checkpoint models/fight_r3d18_v2.pt \
        --compare models/fight_r3d18_v1.pt

The live detector (temporal/rgb_action_recognition.py) does not average clips:
it scores successive single clips and raises a fight when `required` of the last
`window` clips reach `confirmed_threshold`. This tool simulates exactly that on
each video (K evenly spaced clips, in time order), picks the threshold on the
VALIDATION split (highest F1 subject to a precision floor), and reports it once
on the TEST split.

--compare also scores another checkpoint on the test split with the identical
protocol (same clips, same decision rule, its own validation-chosen threshold),
so two models are compared like for like.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch

from rgb_fight_model.dataset import decode_clip, load_manifest
from rgb_fight_model.infer import RgbFightClassifier
from rgb_fight_model.train import metrics, roc_auc


def clip_scores(classifier: RgbFightClassifier, path: str, clips: int) -> np.ndarray:
    positions = [(k + 0.5) / clips for k in range(clips)]
    batch = torch.stack([
        decode_clip(path, classifier.clip_frames, classifier.temporal_stride,
                    classifier.image_size, training=False, clip_fps=classifier.clip_fps,
                    position=p)
        for p in positions
    ]).to(classifier.device)
    with torch.inference_mode():
        return torch.sigmoid(classifier.model(batch).flatten()).cpu().numpy()


def live_rule(scores: np.ndarray, threshold: float, window: int, required: int) -> bool:
    hits = scores >= threshold
    return any(hits[i:i + window].sum() >= required for i in range(max(1, len(hits) - window + 1)))


def evaluate_rule(per_video, labels, threshold, window, required):
    preds = np.array([live_rule(s, threshold, window, required) for s in per_video])
    return metrics(labels, preds.astype(float), 0.5)


def choose(per_video, labels, window, required, min_precision):
    best = None
    for t in np.round(np.linspace(0.05, 0.98, 94), 2):
        m = {**evaluate_rule(per_video, labels, t, window, required), "threshold": float(t)}
        feasible = m["precision"] >= min_precision and m["tp"] > 0
        key = (feasible, m["f1"], m["precision"], t)
        if best is None or key > best[0]:
            best = (key, m)
    return best[1]


def score_split(classifier, records, clips):
    out = []
    for i, r in enumerate(records, 1):
        out.append(clip_scores(classifier, r.path, clips))
        if i % 50 == 0:
            print(f"  scored {i}/{len(records)}", flush=True)
    return out


def calibrate(checkpoint, records, args):
    classifier = RgbFightClassifier(checkpoint)
    split = {s: [r for r in records if r.split == s] for s in ("val", "test")}
    labels = {s: np.array([r.label for r in split[s]]) for s in split}
    print(f"{checkpoint}: scoring validation ({len(split['val'])}) and test ({len(split['test'])}) videos")
    scores = {s: score_split(classifier, split[s], args.clips) for s in split}
    chosen = choose(scores["val"], labels["val"], args.window, args.required, args.min_precision)
    test = evaluate_rule(scores["test"], labels["test"], chosen["threshold"], args.window, args.required)
    averaged = np.array([s.mean() for s in scores["test"]])
    return {
        "checkpoint": str(checkpoint),
        "clip_fps": classifier.clip_fps,
        "confirmed_threshold": chosen["threshold"],
        "validation": chosen,
        "test_live_rule": test,
        "test_mean_of_clips_auc": roc_auc(labels["test"], averaged),
    }


def main():
    parser = argparse.ArgumentParser(description="Calibrate live fight thresholds")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--data-root", default=None)
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--compare", default=None, help="second checkpoint scored with the same protocol")
    parser.add_argument("--clips", type=int, default=5, help="clips per video, in time order")
    parser.add_argument("--window", type=int, default=3)
    parser.add_argument("--required", type=int, default=2)
    parser.add_argument("--min-precision", type=float, default=0.90)
    parser.add_argument("--output", default=None)
    args = parser.parse_args()

    records = load_manifest(args.manifest, args.data_root)
    report = {"protocol": {"clips_per_video": args.clips, "rule": f"{args.required} of {args.window} "
                           "consecutive clips >= threshold", "threshold_chosen_on": "validation",
                           "min_precision": args.min_precision},
              "model": calibrate(args.checkpoint, records, args)}
    if args.compare:
        report["compared_with"] = calibrate(args.compare, records, args)

    output = Path(args.output or Path(args.checkpoint).with_suffix(".runtime.json"))
    output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    for key in ("model", "compared_with"):
        if key in report:
            r = report[key]
            t = r["test_live_rule"]
            print(f"{Path(r['checkpoint']).name}: threshold {r['confirmed_threshold']:.2f} -> test "
                  f"P {t['precision']:.3f} R {t['recall']:.3f} F1 {t['f1']:.3f}; "
                  f"mean-of-clips AUC {r['test_mean_of_clips_auc']:.3f}")
    print(f"saved {output}")


if __name__ == "__main__":
    main()
