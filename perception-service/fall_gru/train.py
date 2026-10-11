"""Train and evaluate the pose-sequence fall model with grouped cross-validation.

    python -m fall_gru.extract --input data/fall_videos --output data/fall_gru_features
    python -m fall_gru.train --features data/fall_gru_features --output models/fall_gru_v1.pt

1. K-fold cross-validation grouped by event (all camera angles of one event
   stay in the same fold). Every video gets an out-of-fold score from a model
   that never saw that event; these give the reported metrics.
2. The original rule-based detector (box aspect-ratio flip) is scored on the
   same videos as a baseline.
3. A final model is trained on all videos; its alert threshold is chosen from
   the out-of-fold scores at the requested precision floor.

--box-only runs the ablation without skeleton features.
"""
from __future__ import annotations

import argparse
import csv
import json
import random
from pathlib import Path

import numpy as np
import torch
from torch import nn

from fall_gru.features import FRAME_FEATURES, POSE_SLICE, VELOCITY_OF, build_sequence
from fall_gru.model import FallNet, pad_window, sliding_windows
from rgb_fight_model.train import choose_threshold, metrics, roc_auc


# ── Data ─────────────────────────────────────────────────────────────────────

def load_index(features_dir: Path):
    with (features_dir / "index.csv").open(encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    return [{**r, "label": int(r["label"]), "seq": np.load(features_dir / r["file"])} for r in rows]


def group_folds(items, k: int, seed: int):
    """Assign event groups to k folds, balancing each class separately."""
    fold_of = {}
    for label in (0, 1):
        groups = sorted({it["group"] for it in items if it["label"] == label})
        random.Random(seed + label).shuffle(groups)
        for i, g in enumerate(groups):
            fold_of[g] = i % k
    return [fold_of[it["group"]] for it in items]


def fall_moment(seq: np.ndarray) -> int:
    """Heuristic location of the fall inside a positive clip: the step where
    the body drops fastest while the torso tips over."""
    n_base = len(FRAME_FEATURES)
    d_center = seq[:, n_base + VELOCITY_OF.index(2)]
    d_tilt = seq[:, n_base + VELOCITY_OF.index(4)]
    signal = np.convolve(d_center + 0.5 * d_tilt, np.ones(5) / 5, mode="same")
    return int(np.argmax(signal))


def time_stretch(seq: np.ndarray, factor: float, fps: float) -> np.ndarray:
    """Resample the clip in time and recompute velocities consistently."""
    n_base = len(FRAME_FEATURES)
    base = np.concatenate([seq[:, :n_base], seq[:, -1:]], axis=1)
    new_len = max(2, int(round(len(seq) * factor)))
    src = np.linspace(0, len(seq) - 1, new_len)
    resampled = np.stack([np.interp(src, np.arange(len(seq)), base[:, j])
                          for j in range(base.shape[1])], axis=1).astype(np.float32)
    frames = [row[:n_base] if row[-1] > 0.5 else None for row in resampled]
    return build_sequence(frames, fps)


def sample_window(item, window: int, fps: float, augment: bool) -> np.ndarray:
    seq = item["seq"]
    if augment and random.random() < 0.5:
        seq = time_stretch(seq, random.uniform(0.8, 1.25), fps)
    if item["label"] == 1:
        # Put the fall somewhere inside the window (not always centred)
        start = fall_moment(seq) - random.randint(window // 4, 3 * window // 4)
    else:
        start = random.randint(0, max(len(seq) - window, 0))
    start = min(max(start, 0), max(len(seq) - window, 0))
    w = pad_window(seq, start, window).copy()
    if augment:
        if random.random() < 0.3:  # pose missing for part/all of the window
            cut = random.randint(0, window)
            w[:cut, POSE_SLICE] = 0.0
        w += np.random.normal(0, 0.01, w.shape).astype(np.float32)
    return w


# ── Training ─────────────────────────────────────────────────────────────────

def fit(train_items, args, device):
    model = FallNet(hidden=args.hidden).to(device)
    stacked = np.concatenate([it["seq"] for it in train_items])
    model.mean.copy_(torch.from_numpy(stacked.mean(0)))
    model.std.copy_(torch.from_numpy(stacked.std(0) + 1e-3))
    positives = sum(it["label"] for it in train_items)
    pos_weight = torch.tensor([(len(train_items) - positives) / max(positives, 1)], device=device)
    loss_fn = nn.BCEWithLogitsLoss(pos_weight=pos_weight)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-3)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)
    for _ in range(args.epochs):
        model.train()
        order = random.sample(train_items, len(train_items)) * args.windows_per_video
        for b in range(0, len(order), args.batch_size):
            batch = order[b:b + args.batch_size]
            x = torch.from_numpy(np.stack([sample_window(it, args.window, args.fps, True)
                                           for it in batch])).float().to(device)
            y = torch.tensor([float(it["label"]) for it in batch], device=device)
            optimizer.zero_grad()
            loss = loss_fn(model(x), y)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            optimizer.step()
        scheduler.step()
    return model


def score_video(model, seq, window, device) -> float:
    model.eval()
    windows = torch.from_numpy(sliding_windows(seq, window, 5)).float().to(device)
    with torch.inference_mode():
        return float(torch.sigmoid(model(windows)).max().item())


# ── Rule baseline (mirrors temporal/rule_engine.py::_check_fall) ─────────────

def rule_baseline(seq: np.ndarray, fps: float, flip_seconds: float, still_seconds: float) -> int:
    aspect, present = seq[:, 0], seq[:, -1]
    flip = int(round(flip_seconds * fps))
    still = int(round(still_seconds * fps))
    t = 0
    while t < len(seq):
        if present[t] and aspect[t] > 1.2:
            run_end = t
            while run_end + 1 < len(seq) and aspect[run_end + 1] > 1.2:
                run_end += 1
            was_standing = np.any((aspect[max(0, t - flip):t] < 0.8) & (present[max(0, t - flip):t] > 0))
            if was_standing and (run_end - t) >= still:
                return 1
            t = run_end + 1
        else:
            t += 1
    return 0


def binary_metrics(labels, preds):
    labels, preds = np.asarray(labels), np.asarray(preds)
    return metrics(labels, preds.astype(float), 0.5)


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Train the pose-sequence fall model")
    parser.add_argument("--features", default="data/fall_gru_features")
    parser.add_argument("--output", default="models/fall_gru_v1.pt")
    parser.add_argument("--folds", type=int, default=5)
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--window", type=int, default=40, help="steps per window (40 = 4 s at 10 fps)")
    parser.add_argument("--fps", type=float, default=10.0)
    parser.add_argument("--hidden", type=int, default=64)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--windows-per-video", type=int, default=4)
    parser.add_argument("--lr", type=float, default=2e-3)
    parser.add_argument("--min-precision", type=float, default=0.85)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--box-only", action="store_true",
                        help="ablation: drop skeleton features (box features only)")
    args = parser.parse_args()

    random.seed(args.seed); np.random.seed(args.seed); torch.manual_seed(args.seed)
    device = torch.device("cpu")  # tiny model; CPU is fast and deterministic
    items = load_index(Path(args.features))
    if args.box_only:
        for it in items:
            it["seq"] = it["seq"].copy()
            it["seq"][:, POSE_SLICE] = 0.0
            it["seq"][:, len(FRAME_FEATURES) + VELOCITY_OF.index(4)] = 0.0  # torso-tilt velocity
    folds = group_folds(items, args.folds, args.seed)
    labels = np.array([it["label"] for it in items])

    oof = np.zeros(len(items))
    for k in range(args.folds):
        train_items = [it for it, f in zip(items, folds) if f != k]
        model = fit(train_items, args, device)
        for i, (it, f) in enumerate(zip(items, folds)):
            if f == k:
                oof[i] = score_video(model, it["seq"], args.window, device)
        fold_idx = [i for i, f in enumerate(folds) if f == k]
        print(json.dumps({"fold": k, "videos": len(fold_idx),
                          "auc": roc_auc(labels[fold_idx], oof[fold_idx])}), flush=True)

    selected = choose_threshold(labels, oof, args.min_precision)
    model_metrics = {**metrics(labels, oof, selected["threshold"]), "auc": roc_auc(labels, oof)}
    deployed_rule = binary_metrics(labels, [rule_baseline(it["seq"], args.fps, 1.5, 5.0) for it in items])
    relaxed_rule = binary_metrics(labels, [rule_baseline(it["seq"], args.fps, 1.5, 1.0) for it in items])

    final = fit(items, args, device)
    output = Path(args.output); output.parent.mkdir(parents=True, exist_ok=True)
    torch.save({"state_dict": final.state_dict(), "threshold": selected["threshold"],
                "window": args.window, "fps": args.fps, "hidden": args.hidden,
                "box_only": args.box_only, "cv_metrics": model_metrics}, output)

    report = {
        "config": vars(args),
        "data": {"videos": len(items), "fall": int(labels.sum()), "not_fall": int((labels == 0).sum()),
                 "event_groups": len({it["group"] for it in items})},
        "evaluation": f"{args.folds}-fold cross-validation grouped by event (out-of-fold scores)",
        "pose_gru_model": model_metrics,
        "rule_baseline_deployed_5s": deployed_rule,
        "rule_baseline_relaxed_1s": relaxed_rule,
    }
    report_path = output.with_suffix(".metrics.json")
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("pose_gru_model", "rule_baseline_deployed_5s",
                                             "rule_baseline_relaxed_1s")}, indent=2))


if __name__ == "__main__":
    main()
