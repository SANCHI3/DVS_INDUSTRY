from __future__ import annotations

import argparse
import csv
from pathlib import Path

try:
    from .dataset import load_manifest
    from .infer import RgbFightClassifier
except ImportError:
    from dataset import load_manifest
    from infer import RgbFightClassifier


def main():
    parser = argparse.ArgumentParser(description="Video-level RGB model evaluation")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--checkpoint", default="models/fight_r3d18_v1.pt")
    parser.add_argument("--split", default="test", choices=["train", "val", "test"])
    parser.add_argument("--output", default="output/rgb_fight_test_scores.csv")
    parser.add_argument("--threshold", type=float, default=None)
    parser.add_argument("--data-root", default=None,
                        help="folder with fight/ and not_fight/, used if manifest paths moved")
    args = parser.parse_args()

    classifier = RgbFightClassifier(args.checkpoint)
    threshold = classifier.threshold if args.threshold is None else args.threshold
    records = [r for r in load_manifest(args.manifest, args.data_root) if r.split == args.split]
    rows = []
    tp = fp = fn = tn = 0
    for index, record in enumerate(records, 1):
        score = classifier.score_video(record.path)
        predicted = int(score >= threshold)
        if predicted and record.label: tp += 1
        elif predicted and not record.label: fp += 1
        elif not predicted and record.label: fn += 1
        else: tn += 1
        rows.append({"group_id": record.group_id, "label": record.label,
                     "score": score, "predicted": predicted})
        print(f"[{index}/{len(records)}] label={record.label} score={score:.4f} {record.group_id}", flush=True)

    output = Path(args.output); output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["group_id", "label", "score", "predicted"])
        writer.writeheader(); writer.writerows(rows)
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    specificity = tn / (tn + fp) if tn + fp else 0.0
    print({"threshold": threshold, "precision": precision, "recall": recall,
           "specificity": specificity, "tp": tp, "fp": fp, "fn": fn, "tn": tn,
           "scores": str(output)})


if __name__ == "__main__":
    main()
