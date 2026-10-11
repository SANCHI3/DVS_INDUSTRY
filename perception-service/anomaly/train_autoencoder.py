"""Train and evaluate the scene-anomaly autoencoder.

Only NORMAL videos are needed for training. Abnormal videos are optional and
used purely for evaluation (they are never shown to the model).

Example (from the perception-service folder):

    python -m anomaly.train_autoencoder \
        --normal data/fall_videos/not_fall \
        --abnormal data/fall_videos/fall \
        --output models/scene_anomaly_ae_v1.npz

For a real deployment, record 20-60 minutes of ordinary activity from YOUR
camera and pass that folder as --normal. The model then learns what "normal"
looks like for that specific view.
"""
from __future__ import annotations

import argparse
import hashlib
import re
import json
import os
import time
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np

from anomaly.autoencoder import NumpyAutoencoder
from anomaly.scene_features import FEATURE_DIM, FEATURE_GROUPS, FEATURE_NAMES, FEATURE_VERSION, video_windows

VIDEO_EXT = {".mp4", ".avi", ".mov", ".mkv", ".mpg", ".mpeg", ".m4v"}


def list_videos(folders: List[str]) -> List[Path]:
    out: List[Path] = []
    for folder in folders:
        for root, _, files in os.walk(folder):
            out.extend(Path(root) / f for f in sorted(files) if Path(f).suffix.lower() in VIDEO_EXT)
    return out


def _extract_one(job):
    path, cached, sample_fps, window, stride, max_seconds = job
    t0 = time.time()
    try:
        windows = video_windows(str(path), sample_fps=sample_fps, window_frames=window,
                                stride_frames=stride, max_seconds=max_seconds)
    except IOError as exc:
        return str(path), None, f"[skip] {exc}"
    np.save(cached, windows)
    return str(path), windows, f"{Path(path).name}: {len(windows)} windows ({time.time() - t0:.1f}s)"


def extract_all(videos: List[Path], cache_dir: Path, args) -> Dict[str, np.ndarray]:
    """Extract (or load cached) window features for every video, in parallel."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    feats: Dict[str, np.ndarray] = {}
    jobs = []
    for path in videos:
        key = hashlib.md5(f"{path.resolve()}|{args.sample_fps}|{args.window}|{args.stride}|"
                          f"{FEATURE_DIM}|{FEATURE_VERSION}".encode()).hexdigest()[:12]
        cached = cache_dir / f"{path.stem}_{key}.npy"
        if cached.exists():
            feats[str(path)] = np.load(cached)
        else:
            jobs.append((path, cached, args.sample_fps, args.window, args.stride, args.max_seconds))
    if jobs:
        from multiprocessing import Pool
        workers = max(1, min(args.workers, len(jobs)))
        with Pool(workers) as pool:
            for i, (path, windows, msg) in enumerate(pool.imap_unordered(_extract_one, jobs), 1):
                print(f"  [{i}/{len(jobs)}] {msg}")
                if windows is not None:
                    feats[path] = windows
    return {str(p): feats[str(p)] for p in videos if str(p) in feats}


def roc_auc(labels: np.ndarray, scores: np.ndarray) -> float:
    """Rank-based (Mann-Whitney) ROC-AUC, no sklearn needed."""
    labels = np.asarray(labels).astype(bool)
    pos, neg = scores[labels], scores[~labels]
    if len(pos) == 0 or len(neg) == 0:
        return float("nan")
    order = np.argsort(np.concatenate([pos, neg]), kind="mergesort")
    ranks = np.empty(len(order))
    ranks[order] = np.arange(1, len(order) + 1)
    return float((ranks[:len(pos)].sum() - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg)))


def persistent_hits(ratios: np.ndarray, required: int, window: int) -> bool:
    """True when at least `required` of any `window` consecutive windows exceed 1.0."""
    above = (ratios > 1.0).astype(int)
    if len(above) < required:
        return False
    for start in range(0, max(1, len(above) - window + 1)):
        if above[start:start + window].sum() >= required:
            return True
    return False


def video_score(ratios: np.ndarray, required: int) -> float:
    """Highest error ratio that is sustained for `required` consecutive windows."""
    if len(ratios) == 0:
        return 0.0
    if len(ratios) < required:
        return float(ratios.min())
    return float(max(ratios[i:i + required].min() for i in range(len(ratios) - required + 1)))


def binary_metrics(y_true: List[int], y_pred: List[int]) -> Dict[str, float]:
    y_true, y_pred = np.asarray(y_true, bool), np.asarray(y_pred, bool)
    tp = int(np.sum(y_true & y_pred)); fp = int(np.sum(~y_true & y_pred))
    fn = int(np.sum(y_true & ~y_pred)); tn = int(np.sum(~y_true & ~y_pred))
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    specificity = tn / (tn + fp) if tn + fp else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {"TP": tp, "FP": fp, "FN": fn, "TN": tn, "precision": round(precision, 4),
            "recall": round(recall, 4), "specificity": round(specificity, 4),
            "accuracy": round((tp + tn) / max(len(y_true), 1), 4), "f1": round(f1, 4)}


def event_group(path: str) -> str:
    """Videos of one event filmed from several cameras ("01.mp4", "01 (2).mp4")
    share a numeric prefix; they must land in the same split, otherwise the
    test set contains other angles of scenes seen in training."""
    p = Path(path)
    match = re.match(r"^\s*(\d+)", p.stem)
    return f"{p.parent.as_posix()}/{match.group(1) if match else p.stem}"


def split_videos(paths: List[str], seed: int, val_frac: float, test_frac: float) -> Tuple[list, list, list]:
    """Split by event group (see event_group), not by individual file."""
    groups: Dict[str, List[str]] = {}
    for path in paths:
        groups.setdefault(event_group(path), []).append(path)
    keys = sorted(groups)
    rng = np.random.default_rng(seed)
    order = [keys[i] for i in rng.permutation(len(keys))]
    n_test = max(1, int(round(len(keys) * test_frac)))
    n_val = max(1, int(round(len(keys) * val_frac)))
    pick = lambda chosen: [p for g in chosen for p in groups[g]]  # noqa: E731
    return pick(order[n_test + n_val:]), pick(order[n_test:n_test + n_val]), pick(order[:n_test])


def save_plots(out_prefix: Path, normal_err: np.ndarray, abnormal_err: np.ndarray,
               threshold: float, history: dict, video_rows: list) -> List[str]:
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        return []
    saved = []
    fig, axes = plt.subplots(1, 3, figsize=(15, 4))
    bins = np.linspace(0, np.percentile(np.concatenate([normal_err, abnormal_err]) if len(abnormal_err) else normal_err, 99.5), 60)
    axes[0].hist(normal_err, bins=bins, alpha=0.6, label="normal (held-out)", color="#2a9d8f", density=True)
    if len(abnormal_err):
        axes[0].hist(abnormal_err, bins=bins, alpha=0.6, label="abnormal", color="#e76f51", density=True)
    axes[0].axvline(threshold, color="black", linestyle="--", label="threshold")
    axes[0].set_title("Reconstruction error per 2-s window"); axes[0].set_xlabel("error"); axes[0].legend()

    axes[1].plot(history["train_loss"], label="train")
    if history.get("val_loss"):
        axes[1].plot(history["val_loss"], label="validation")
    axes[1].set_title("Autoencoder training loss"); axes[1].set_xlabel("epoch"); axes[1].legend()

    if video_rows:
        labels = np.array([r["label"] for r in video_rows]); scores = np.array([r["score"] for r in video_rows])
        thresholds = np.unique(np.concatenate([[0], scores, [scores.max() + 1]]))[::-1]
        tpr = [np.mean(scores[labels == 1] >= t) for t in thresholds]
        fpr = [np.mean(scores[labels == 0] >= t) for t in thresholds]
        axes[2].plot(fpr, tpr, color="#264653", lw=2)
        axes[2].plot([0, 1], [0, 1], color="grey", linestyle=":")
        axes[2].set_title(f"Video-level ROC (AUC={roc_auc(labels, scores):.3f})")
        axes[2].set_xlabel("false positive rate"); axes[2].set_ylabel("true positive rate")
    fig.tight_layout()
    path = str(out_prefix) + ".evaluation.png"
    fig.savefig(path, dpi=130); plt.close(fig)
    saved.append(path)
    return saved


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--normal", nargs="+", required=True, help="folder(s) of NORMAL videos")
    parser.add_argument("--abnormal", nargs="*", default=[], help="optional folder(s) of abnormal videos (evaluation only)")
    parser.add_argument("--output", default="models/scene_anomaly_ae_v1.npz")
    parser.add_argument("--cache", default="data/anomaly_features_cache")
    parser.add_argument("--sample-fps", type=float, default=5.0)
    parser.add_argument("--window", type=int, default=10, help="frames per window (10 @ 5 FPS = 2 s)")
    parser.add_argument("--stride", type=int, default=2, help="frames between consecutive windows")
    parser.add_argument("--max-seconds", type=float, default=None)
    parser.add_argument("--percentile", type=float, default=95.0, help="normal-error percentile used as threshold")
    parser.add_argument("--required", type=int, default=2, help="consecutive abnormal windows for a video-level alert")
    parser.add_argument("--epochs", type=int, default=400)
    parser.add_argument("--hidden", type=int, default=16)
    parser.add_argument("--bottleneck", type=int, default=4)
    parser.add_argument("--noise", type=float, default=0.3, help="denoising input-noise std")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    args = parser.parse_args()

    normal_videos = list_videos(args.normal)
    abnormal_videos = list_videos(args.abnormal) if args.abnormal else []
    if len(normal_videos) < 3:
        raise SystemExit("need at least 3 normal videos (train / validation / test split by video)")
    print(f"normal videos: {len(normal_videos)}  abnormal videos: {len(abnormal_videos)}")

    cache = Path(args.cache)
    print("extracting optical-flow features ...")
    normal_feats = extract_all(normal_videos, cache, args)
    abnormal_feats = extract_all(abnormal_videos, cache, args) if abnormal_videos else {}

    paths = [p for p in normal_feats if len(normal_feats[p])]
    train_p, val_p, test_p = split_videos(paths, args.seed, val_frac=0.15, test_frac=0.25)
    x_train = np.concatenate([normal_feats[p] for p in train_p])
    x_val = np.concatenate([normal_feats[p] for p in val_p])
    print(f"split by video -> train {len(train_p)} videos / {len(x_train)} windows, "
          f"val {len(val_p)} / {len(x_val)}, test {len(test_p)} videos")

    model = NumpyAutoencoder.create(FEATURE_DIM, hidden=args.hidden, bottleneck=args.bottleneck, seed=args.seed)
    model.feature_names = FEATURE_NAMES
    model.fit_scaler(x_train)
    print("training denoising autoencoder ...")
    history = model.fit(x_train, x_val, epochs=args.epochs, noise_std=args.noise, seed=args.seed)

    # Threshold from validation-normal errors only (never from test or abnormal data)
    model.calibrate(model.errors(x_val), percentile=args.percentile)
    print(f"threshold (p{args.percentile:g} of validation-normal error) = {model.threshold:.4f}")

    report: Dict[str, object] = {
        "model": "denoising autoencoder (numpy)",
        "architecture": model.layer_sizes,
        "feature_dim": FEATURE_DIM,
        "configuration": {k: getattr(args, k) for k in
                          ("sample_fps", "window", "stride", "percentile", "required", "epochs", "hidden",
                           "bottleneck", "noise", "seed")},
        "data": {"normal_videos": len(paths), "train_videos": len(train_p), "val_videos": len(val_p),
                 "test_normal_videos": len(test_p), "abnormal_videos": len(abnormal_feats),
                 "train_windows": int(len(x_train)), "val_windows": int(len(x_val))},
        "threshold": model.threshold,
        "calibration": model.calibration,
        "epochs_trained": len(history["train_loss"]),
    }

    test_normal_err = np.concatenate([model.errors(normal_feats[p]) for p in test_p])
    abnormal_err = (np.concatenate([model.errors(v) for v in abnormal_feats.values() if len(v)])
                    if abnormal_feats else np.zeros(0))
    report["window_level"] = {
        "test_normal_windows": int(len(test_normal_err)),
        "false_alarm_rate": round(float(np.mean(test_normal_err > model.threshold)), 4),
    }

    video_rows = []
    for p in test_p:
        r = model.anomaly_ratio(normal_feats[p])
        video_rows.append({"video": Path(p).name, "label": 0, "score": video_score(r, args.required),
                           "alert": persistent_hits(r, args.required, args.required)})
    for p, v in abnormal_feats.items():
        if not len(v):
            continue
        r = model.anomaly_ratio(v)
        video_rows.append({"video": Path(p).name, "label": 1, "score": video_score(r, args.required),
                           "alert": persistent_hits(r, args.required, args.required)})

    if abnormal_feats:
        labels = np.array([r["label"] for r in video_rows])
        scores = np.array([r["score"] for r in video_rows])
        report["window_level"]["abnormal_windows"] = int(len(abnormal_err))
        report["window_level"]["roc_auc"] = round(roc_auc(
            np.r_[np.zeros(len(test_normal_err)), np.ones(len(abnormal_err))],
            np.r_[test_normal_err, abnormal_err]), 4)
        report["video_level"] = {
            "rule": f"alert if {args.required} consecutive 2-s windows exceed the threshold",
            "roc_auc": round(roc_auc(labels, scores), 4),
            **binary_metrics([r["label"] for r in video_rows], [int(r["alert"]) for r in video_rows]),
        }
        # Trade-off table: same model, different thresholds (all from validation-normal data)
        val_err = model.errors(x_val)
        points = []
        for pct in (90.0, 95.0, 97.5, 99.0):
            thr = float(np.percentile(val_err, pct))
            preds = []
            for p in test_p:
                preds.append((0, persistent_hits(model.errors(normal_feats[p]) / thr, args.required, args.required)))
            for v in abnormal_feats.values():
                if len(v):
                    preds.append((1, persistent_hits(model.errors(v) / thr, args.required, args.required)))
            points.append({"threshold_percentile": pct, "threshold": round(thr, 4),
                           **binary_metrics([a for a, _ in preds], [int(b) for _, b in preds])})
        report["operating_points"] = points
        # Which feature groups drive the error on abnormal data (explainability)
        fe = np.concatenate([model.feature_errors(v) for v in abnormal_feats.values() if len(v)])
        fn = np.concatenate([model.feature_errors(normal_feats[p]) for p in test_p])
        report["explainability"] = {
            g: round(float(fe[:, idx].sum(axis=1).mean() / max(fn[:, idx].sum(axis=1).mean(), 1e-9)), 2)
            for g, idx in FEATURE_GROUPS.items()
        }

    model.metadata = {"trained_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                      "sample_fps": args.sample_fps, "window_frames": args.window,
                      "required_windows": args.required}
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    model.save(str(out))
    prefix = out.with_suffix("")
    report["plots"] = save_plots(prefix, test_normal_err, abnormal_err, model.threshold, history, video_rows)
    with open(str(prefix) + ".metrics.json", "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)
    with open(str(prefix) + ".per_video.json", "w", encoding="utf-8") as fh:
        json.dump(video_rows, fh, indent=2, default=float)

    print(json.dumps({k: report[k] for k in report if k in ("threshold", "window_level", "video_level")}, indent=2))
    print(f"saved model -> {out}")


if __name__ == "__main__":
    main()
