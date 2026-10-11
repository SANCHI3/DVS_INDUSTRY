"""Train and evaluate the pose-based fall classifier.

    python -m fall_rf.train --manifest data/fall_features/manifest.csv --output models/fall_rf_v1.joblib

What it does
1. 5-fold cross-validation grouped BY EVENT (camera angles of one event share a fold;
   within that, never splitting a video) (no window of a test video is
   ever seen in training -- prevents the leakage that inflates many student
   results).
2. Compares three model families on identical folds:
   Random Forest, Gradient Boosting and Logistic Regression.
3. Evaluates at the level that matters operationally: one alert decision per
   video (alert if `required` consecutive windows score above threshold).
4. Compares against two training-free baselines on the same videos:
   - the original bounding-box aspect-ratio rule (temporal/rule_engine.py)
   - the physics score in fall_rf/features.py
5. Picks the threshold on out-of-fold predictions (precision floor first,
   then best recall), refits the best model on all data and saves it with
   metrics, feature importances and plots.
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Dict, List

import numpy as np

from fall_rf.features import FEATURE_NAMES


def event_of(video: str) -> str:
    """'fall/01 (2).mp4' -> 'fall/01' (numeric prefix = recorded event)."""
    import re

    cls, _, name = video.replace("\\", "/").rpartition("/")
    match = re.match(r"^\s*(\d+)", name)
    return f"{cls}/{match.group(1) if match else name}"


def load_manifest(path: str):
    import csv

    with open(path, newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    if not rows:
        raise SystemExit(f"empty manifest: {path}")
    x = np.array([[float(r[n]) for n in FEATURE_NAMES] for r in rows], dtype=np.float32)
    y = np.array([int(r["label"]) for r in rows])
    use = np.array([int(r["use_for_training"]) for r in rows]).astype(bool)
    videos = np.array([r["video"] for r in rows])
    window = np.array([int(r["window"]) for r in rows])
    physics = np.array([float(r.get("physics_score", 0.0)) for r in rows])
    return rows, x, y, use, videos, window, physics


def sustained(scores: np.ndarray, required: int) -> float:
    if len(scores) == 0:
        return 0.0
    if len(scores) < required:
        return float(scores.min())
    return float(max(scores[i:i + required].min() for i in range(len(scores) - required + 1)))


def video_level(videos, window, y, scores, required: int):
    out = {}
    for v in np.unique(videos):
        m = videos == v
        order = np.argsort(window[m])
        out[v] = (int(y[m][0]), sustained(scores[m][order], required))
    return out


def metrics_at(vid: Dict[str, tuple], threshold: float) -> dict:
    y = np.array([a for a, _ in vid.values()]).astype(bool)
    p = np.array([b >= threshold for _, b in vid.values()], dtype=bool)
    tp = int(np.sum(y & p)); fp = int(np.sum(~y & p)); fn = int(np.sum(y & ~p)); tn = int(np.sum(~y & ~p))
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    return {"threshold": round(float(threshold), 3), "TP": tp, "FP": fp, "FN": fn, "TN": tn,
            "precision": round(prec, 4), "recall": round(rec, 4),
            "specificity": round(tn / (tn + fp), 4) if tn + fp else 0.0,
            "accuracy": round((tp + tn) / max(len(y), 1), 4),
            "f1": round(2 * prec * rec / (prec + rec), 4) if prec + rec else 0.0}


def choose_threshold(vid: Dict[str, tuple], min_precision: float) -> dict:
    grid = [metrics_at(vid, t) for t in np.linspace(0.05, 0.95, 91)]
    ok = [m for m in grid if m["precision"] >= min_precision and m["TP"] > 0]
    if ok:
        best = max(ok, key=lambda m: (m["recall"], m["f1"], m["threshold"]))
        return {**best, "objective": f"precision>={min_precision}"}
    best = max(grid, key=lambda m: (m["f1"], m["precision"]))
    return {**best, "objective": "fallback_max_f1"}


def roc_auc(labels, scores) -> float:
    labels = np.asarray(labels).astype(bool)
    pos, neg = np.asarray(scores)[labels], np.asarray(scores)[~labels]
    if not len(pos) or not len(neg):
        return float("nan")
    order = np.argsort(np.concatenate([pos, neg]), kind="mergesort")
    ranks = np.empty(len(order)); ranks[order] = np.arange(1, len(order) + 1)
    return float((ranks[:len(pos)].sum() - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg)))


def bbox_rule_baseline(pose_dir: Path, flip_s: float, still_s: float, process_width: float = 640.0) -> Dict[str, int]:
    """Re-implements RuleEngine._check_fall on the pose-track person boxes."""
    out = {}
    for f in sorted(pose_dir.glob("*.npz")):
        d = np.load(f)
        t, b, valid = d["times"], d["boxes"], d["valid"]
        t, b = t[valid], b[valid]
        cls, name = f.stem.split("__", 1)
        fired = False
        if len(b):
            scale = process_width / max(float(b[:, 2].max()), 1.0)  # rough px tolerance scaling
            ar = (b[:, 2] - b[:, 0]) / np.maximum(b[:, 3] - b[:, 1], 1e-6)
            cx, cy = (b[:, 0] + b[:, 2]) / 2 * scale, (b[:, 1] + b[:, 3]) / 2 * scale
            for i in range(len(t)):
                if ar[i] <= 1.2:
                    continue
                j = i
                while j > 0 and ar[j - 1] > 1.2:
                    j -= 1
                pre = (t >= t[j] - flip_s) & (t < t[j])
                if not np.any(ar[pre] < 0.8):
                    continue
                run = slice(j, i + 1)
                still = (np.ptp(cx[run]) <= 8.0) and (np.ptp(cy[run]) <= 8.0)
                if still and t[i] - t[j] >= still_s:
                    fired = True
                    break
        out[f"{cls}/{name}"] = fired
    return out


def make_models(seed: int):
    from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    return {
        "random_forest": lambda: RandomForestClassifier(
            n_estimators=400, min_samples_leaf=3, max_features="sqrt",
            class_weight="balanced_subsample", n_jobs=-1, random_state=seed),
        "gradient_boosting": lambda: GradientBoostingClassifier(
            n_estimators=250, max_depth=3, learning_rate=0.05, subsample=0.8, random_state=seed),
        "logistic_regression": lambda: make_pipeline(
            StandardScaler(), LogisticRegression(max_iter=2000, class_weight="balanced")),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--manifest", default="data/fall_features/manifest.csv")
    parser.add_argument("--output", default="models/fall_rf_v1.joblib")
    parser.add_argument("--folds", type=int, default=5)
    parser.add_argument("--required", type=int, default=2, help="consecutive positive windows for an alert")
    parser.add_argument("--min-precision", type=float, default=0.85)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    import joblib
    import sklearn
    from sklearn.model_selection import StratifiedGroupKFold

    rows, x, y, use, videos, window, physics = load_manifest(args.manifest)
    uniq = np.unique(videos)
    vid_label = {v: int(y[videos == v][0]) for v in uniq}
    print(f"{len(rows)} windows from {len(uniq)} videos "
          f"({sum(vid_label.values())} fall / {len(uniq) - sum(vid_label.values())} not_fall); "
          f"{int(use.sum())} windows used for training")

    folds = StratifiedGroupKFold(n_splits=args.folds, shuffle=True, random_state=args.seed)
    # Group by EVENT, not file: "fall/01.mp4" and "fall/01 (2).mp4" are the same
    # fall filmed from another camera and must share a fold.
    events = sorted({event_of(v) for v in uniq})
    event_index = {e: i for i, e in enumerate(events)}
    groups = np.array([event_index[event_of(v)] for v in videos])
    print(f"{len(events)} event groups")
    fold_of = np.zeros(len(rows), int)
    for k, (_, test_idx) in enumerate(folds.split(x, y, groups)):
        fold_of[test_idx] = k

    report: Dict[str, object] = {
        "task": "pose-based fall detection",
        "features": FEATURE_NAMES,
        "data": {"windows": len(rows), "videos": len(uniq), "fall_videos": sum(vid_label.values()),
                 "not_fall_videos": len(uniq) - sum(vid_label.values()),
                 "training_windows": int(use.sum()), "positive_windows": int((use & (y == 1)).sum())},
        "evaluation": f"{args.folds}-fold cross-validation grouped by event (all camera angles of one event share a fold); "
                      f"video alert = {args.required} consecutive windows >= threshold",
        "models": {},
    }

    best_name, best_f1, oof_best = None, -1.0, None
    for name, factory in make_models(args.seed).items():
        t0 = time.time()
        oof = np.zeros(len(rows))
        for k in range(args.folds):
            train = (fold_of != k) & use
            test = fold_of == k
            if len(np.unique(y[train])) < 2:
                continue
            clf = factory().fit(x[train], y[train])
            oof[test] = clf.predict_proba(x[test])[:, 1]
        vid = video_level(videos, window, y, oof, args.required)
        chosen = choose_threshold(vid, args.min_precision)
        entry = {
            "window_roc_auc": round(roc_auc(y[use], oof[use]), 4),
            "video_roc_auc": round(roc_auc([a for a, _ in vid.values()], [b for _, b in vid.values()]), 4),
            "video_metrics": chosen,
            "seconds": round(time.time() - t0, 1),
        }
        report["models"][name] = entry
        print(f"{name:20s} window AUC={entry['window_roc_auc']:.3f} video AUC={entry['video_roc_auc']:.3f} "
              f"P={chosen['precision']:.2f} R={chosen['recall']:.2f} F1={chosen['f1']:.2f} @thr={chosen['threshold']}")
        if chosen["f1"] > best_f1:
            best_name, best_f1, oof_best = name, chosen["f1"], oof

    # Training-free baselines on the same videos
    baselines = {}
    vid_phys = video_level(videos, window, y, physics, args.required)
    baselines["physics_score (no training)"] = choose_threshold(vid_phys, args.min_precision)
    pose_dir = Path(args.manifest).parent / "poses"
    if pose_dir.exists():
        for label, still in (("bbox_rule (original config: stillness 5 s)", 5.0),
                             ("bbox_rule (relaxed: stillness 1 s)", 1.0)):
            fired = bbox_rule_baseline(pose_dir, flip_s=1.5, still_s=still)
            # pose caches are named without the video extension: "fall/01 (2)"
            vid = {v: (vid_label[v], 1.0 if fired[Path(v).with_suffix("").as_posix()] else 0.0)
                   for v in uniq if Path(v).with_suffix("").as_posix() in fired}
            baselines[label] = metrics_at(vid, 0.5)
    report["baselines"] = baselines
    for k, v in baselines.items():
        print(f"baseline {k:45s} P={v['precision']:.2f} R={v['recall']:.2f} F1={v['f1']:.2f}")

    # Refit the best model on all usable windows
    final = make_models(args.seed)[best_name]().fit(x[use], y[use])
    threshold = report["models"][best_name]["video_metrics"]["threshold"]
    importances = None
    if hasattr(final, "feature_importances_"):
        importances = dict(sorted(zip(FEATURE_NAMES, map(float, final.feature_importances_)),
                                  key=lambda kv: kv[1], reverse=True))
        report["feature_importance"] = {k: round(v, 4) for k, v in importances.items()}
    report["selected_model"] = best_name
    report["threshold"] = threshold
    report["required_windows"] = args.required

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": final, "model_name": best_name, "feature_names": FEATURE_NAMES,
                 "threshold": threshold, "required_windows": args.required,
                 "window_seconds": 2.0, "sklearn_version": sklearn.__version__,
                 "trained_at": time.strftime("%Y-%m-%d %H:%M:%S")}, out)
    prefix = out.with_suffix("")
    with open(f"{prefix}.metrics.json", "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)

    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        fig, axes = plt.subplots(1, 2, figsize=(13, 4.5))
        names = list(report["models"]) + list(baselines)
        f1s = [report["models"][n]["video_metrics"]["f1"] for n in report["models"]] + [b["f1"] for b in baselines.values()]
        colors = ["#264653" if n == best_name else ("#2a9d8f" if n in report["models"] else "#e9c46a") for n in names]
        axes[0].barh(names[::-1], f1s[::-1], color=colors[::-1])
        axes[0].set_xlim(0, 1); axes[0].set_title("Video-level F1 (grouped 5-fold CV)")
        if importances:
            top = list(importances.items())[:10][::-1]
            axes[1].barh([k for k, _ in top], [v for _, v in top], color="#2a9d8f")
            axes[1].set_title(f"Top features ({best_name})")
        fig.tight_layout(); fig.savefig(f"{prefix}.evaluation.png", dpi=130); plt.close(fig)
    except ImportError:
        pass

    print(f"selected {best_name} (video F1={best_f1:.3f}, threshold={threshold}) -> {out}")


if __name__ == "__main__":
    main()
