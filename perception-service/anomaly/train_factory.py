"""Train the unusual-activity autoencoder on the factory's own CCTV footage.

The earlier models (v1, v2) learned "normal" from public exercise / fall
videos. This script learns it from recordings of the deployment cameras, so
ordinary factory activity (machines running, workers walking) is what the
model reconstructs well, and anything unlike it stands out.

    python -m anomaly.train_factory --videos data/factory_videos \
        --output models/scene_anomaly_ae_v3.npz

Video files must be named <camera>_<scene>_<NN>.mp4 (e.g. camB_aisle_01.mp4);
everything before the last "_NN" is the camera name. The footage itself is
company data and is never committed (data/ is git-ignored).

How the data is used
- The first `--warmup` windows of each video are dropped: the live detector
  also ignores them while its background model settles. Recordings too short
  to give `--min-windows` windows after that are not used for training.
- With only a few minutes of footage, a single train/test split would test on
  a few seconds per camera. So the model is evaluated with BLOCKED 5-FOLD
  CROSS-VALIDATION IN TIME: every recording is cut into 5 consecutive blocks;
  each fold tests on one block, uses the next block for early stopping and the
  threshold, and trains on the rest, leaving a gap of one window length around
  the held-out blocks so overlapping windows never leak. Every second of
  footage is tested exactly once, by a model that never saw it.
- Model size (hidden units, bottleneck, input noise) is chosen on the average
  validation loss over the folds (smallest model within 2 % of the best), so
  the model is neither too small to learn normal activity (underfitting) nor
  big enough to copy it (overfitting); training stops early when validation
  loss stops improving.
- The final model is then trained on all usable footage except the last
  15 % of each recording, which is kept for early stopping and the threshold.

Threshold
- Model threshold: p95 of validation-normal error (same rule as v1/v2).
- The live detector calibrates every camera on its own normal footage
  (temporal/scene_anomaly.py: camera threshold = max(model threshold, p99 of
  that camera's error)). The evaluation simulates this with each camera's
  validation windows, so a busy camera gets a higher bar than a quiet one.

Also reported
- The previous model (v2) on the same held-out windows.
- Leave-one-camera-out: how a camera never seen in training behaves.
- SYNTHETIC stress tests on held-out footage: x4 fast motion, camera covered,
  camera shake, lights dimmed. No recordings of real incidents were
  available, so these are clearly labelled stand-ins, not incident recall.
"""

from __future__ import annotations

import argparse
import json
import re
import time
from collections import defaultdict
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

import cv2
import numpy as np

from anomaly.autoencoder import NumpyAutoencoder
from anomaly.scene_features import (FEATURE_DIM, FEATURE_GROUPS, FEATURE_NAMES, SceneFeatureExtractor,
                                    video_windows)

SAMPLE_FPS = 5.0
WINDOW = 10      # frames per window (2 s at 5 FPS), same as the live detector
STRIDE = 2       # windows every 0.4 s, same as the live evaluation stride


def camera_of(path: Path) -> str:
    return re.sub(r"_\d+$", "", path.stem)


def window_time(i: int) -> float:
    """End time (s) of window i, as produced by video_windows with STRIDE."""
    return (WINDOW + 1 + i * STRIDE) / SAMPLE_FPS


# ------------------------------------------------------------------ live-like alert rule
def alert_episodes(ratios: np.ndarray, required: int = 2, window: int = 3,
                   cooldown_windows: int = 75) -> int:
    """Count alert episodes the live detector would raise: `required` of the
    last `window` evaluations above 1.0 starts an episode; a 30 s cooldown
    (75 evaluations at 0.4 s) follows each episode."""
    episodes, active, cool, recent = 0, False, 0, []
    for r in ratios:
        recent = (recent + [r > 1.0])[-window:]
        hit = sum(recent) >= required
        if cool > 0:
            cool -= 1
        if hit and not active and cool == 0:
            episodes += 1
            active = True
        elif not hit and active:
            active = False
            cool = cooldown_windows
    return episodes


# ------------------------------------------------------------------ synthetic stress tests
def _fast(frame, k, rng):  # handled by frame skipping, see synthetic_windows
    return frame


def _covered(frame, k, rng):
    alpha = min(1.0, k / 5.0)  # fully covered after 1 s
    return (frame.astype(np.float32) * (1 - alpha)).astype(np.uint8)


def _shake(frame, k, rng):
    dx, dy = rng.integers(-10, 11, 2)
    m = np.float32([[1, 0, dx], [0, 1, dy]])
    return cv2.warpAffine(frame, m, (frame.shape[1], frame.shape[0]), borderMode=cv2.BORDER_REPLICATE)


def _dim(frame, k, rng):
    factor = max(0.35, 1.0 - 0.13 * k)  # lights go down to 35 % over 1 s
    return (frame.astype(np.float32) * factor).astype(np.uint8)


STRESS: Dict[str, Callable] = {"fast_motion_x4": _fast, "camera_covered": _covered,
                               "camera_shake": _shake, "lights_dimmed": _dim}


def synthetic_windows(path: Path, start_s: float, duration_s: float, kind: str, seed: int) -> np.ndarray:
    """Window features for `duration_s` of transformed footage starting at
    `start_s`, after 8 s of untouched footage so the background model is warm."""
    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    step = max(1, int(round(fps / SAMPLE_FPS)))
    lead = 8.0
    begin = max(0.0, start_s - lead)
    cap.set(cv2.CAP_PROP_POS_MSEC, begin * 1000)
    ext = SceneFeatureExtractor(fps=fps / step, window_frames=WINDOW)
    rng = np.random.default_rng(seed)
    out, sampled, k = [], 0, 0
    t = begin
    while t < start_s + duration_s:
        in_segment = t >= start_s
        skip = step * (4 if in_segment and kind == "fast_motion_x4" else 1)
        frame = None
        for _ in range(skip):
            ok, f = cap.read()
            if not ok:
                break
            frame = f
        if frame is None:
            break
        t += skip / fps
        if in_segment:
            frame = STRESS[kind](frame, k, rng)
            k += 1
        vec = ext.push(frame)
        sampled += 1
        if vec is not None and in_segment and k >= 3:
            out.append(vec)
    cap.release()
    return np.stack(out) if out else np.zeros((0, FEATURE_DIM), np.float32)


# ------------------------------------------------------------------ training
def train_model(x_train, x_val, cfg: dict, seed: int, epochs: int, verbose: bool = False):
    """cfg: hidden, bottleneck, noise (denoising input noise), floor (minimum
    feature std used for scaling, so near-constant features of a quiet scene
    are not blown up) and weight_decay (L2 regularisation)."""
    model = NumpyAutoencoder.create(FEATURE_DIM, hidden=cfg["hidden"], bottleneck=cfg["bottleneck"], seed=seed)
    model.feature_names = FEATURE_NAMES
    model.fit_scaler(x_train, std_floor=cfg["floor"])
    hist = model.fit(x_train, x_val, epochs=epochs, noise_std=cfg["noise"], weight_decay=cfg["weight_decay"],
                     seed=seed, patience=40, verbose=verbose)
    return model, hist


# ------------------------------------------------------------------ folds
def fold_blocks(n: int, warmup: int, k: int):
    """Indices of each video's windows after warm-up, cut into k consecutive blocks."""
    return np.array_split(np.arange(warmup, n), k)


def fold_split(blocks, test_k: int, gap: int):
    """(train, val, test) indices for one fold: test = block test_k, val = the
    next block, train = the rest minus `gap` windows next to each held-out block."""
    k = len(blocks)
    val_k = (test_k + 1) % k
    test, val = blocks[test_k], blocks[val_k]
    lo_hi = [(b[0], b[-1]) for b in (test, val) if len(b)]
    train = [i for j, b in enumerate(blocks) if j not in (test_k, val_k) for i in b
             if all(not (lo - gap <= i <= hi + gap) for lo, hi in lo_hi)]
    return np.array(train, int), val, test


def per_camera_thresholds(model, feats, calib_idx, model_thr) -> Dict[str, float]:
    """Simulates the live per-camera calibration: camera threshold = max(model
    threshold, p99 of the camera's error on footage the fold may use)."""
    errs: Dict[str, List[np.ndarray]] = defaultdict(list)
    for p, idx in calib_idx.items():
        if len(idx):
            errs[camera_of(p)].append(model.errors(feats[p][idx]))
    return {cam: max(model_thr, float(np.percentile(np.concatenate(e), 99))) for cam, e in errs.items()}


def stress_eval(model, thr_of, paths_idx, seed_base: int) -> Dict[str, List[int]]:
    """One 4-s synthetic segment of each kind per held-out block of >= 12 windows."""
    hits: Dict[str, List[int]] = {k: [] for k in STRESS}
    for p, idx in paths_idx.items():
        if len(idx) < 12:
            continue
        start = window_time(int(idx[0])) + 1.0
        for kind in STRESS:
            w = synthetic_windows(p, start, 4.0, kind, seed=seed_base + int(start * 10))
            if len(w):
                hits[kind].append(int(alert_episodes(model.errors(w) / thr_of(p)) > 0))
    return hits


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--videos", default="data/factory_videos")
    ap.add_argument("--output", default="models/scene_anomaly_ae_v3.npz")
    ap.add_argument("--compare", default="models/scene_anomaly_ae_v2.npz", help="previous model to compare with")
    ap.add_argument("--warmup", type=int, default=10, help="windows dropped at the start of each video")
    ap.add_argument("--min-windows", type=int, default=50, help="shorter recordings are not used")
    ap.add_argument("--folds", type=int, default=5)
    ap.add_argument("--epochs", type=int, default=600)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    videos = sorted(Path(args.videos).glob("*.mp4"))
    feats = {p: video_windows(str(p), sample_fps=SAMPLE_FPS, window_frames=WINDOW, stride_frames=STRIDE)
             for p in videos}
    used = [p for p in videos if len(feats[p]) - args.warmup >= args.min_windows]
    skipped = [p.name for p in videos if p not in used]
    blocks = {p: fold_blocks(len(feats[p]), args.warmup, args.folds) for p in used}
    gap = WINDOW // STRIDE + 1
    print(f"videos used: {[p.name for p in used]}\nskipped (too short): {skipped}")

    def gather(idx_map):
        parts = [feats[p][i] for p, i in idx_map.items() if len(i)]
        return np.concatenate(parts) if parts else np.zeros((0, FEATURE_DIM))

    folds = []
    for k in range(args.folds):
        s = {p: fold_split(blocks[p], k, gap) for p in used}
        folds.append(({p: v[0] for p, v in s.items()}, {p: v[1] for p, v in s.items()},
                      {p: v[2] for p, v in s.items()}))

    # -------- model selection: average validation loss over the folds
    # floor and weight decay are fixed (errors measured with different floors
    # are on different scales, so they cannot be compared); the grid varies
    # the model size and the denoising noise.
    grid = [{"hidden": h, "bottleneck": b, "noise": n, "floor": 0.1, "weight_decay": 1e-3}
            for h in (8, 16, 24) for b in (4, 6) for n in (0.1, 0.3, 0.5)]
    selection = []
    for cfg in grid:
        vals, trains = [], []
        for tr, va, _ in folds:
            m, hist = train_model(gather(tr), gather(va), cfg, args.seed, args.epochs)
            xt, xv = m._scale(gather(tr)), m._scale(gather(va))
            # median window error: robust to the rare spiky windows of busy scenes
            vals.append(float(np.median(np.mean((m.reconstruct(xv) - xv) ** 2, axis=1))))
            trains.append(float(np.median(np.mean((m.reconstruct(xt) - xt) ** 2, axis=1))))
        row = {**cfg, "cv_val_error": round(float(np.mean(vals)), 5), "cv_train_error": round(float(np.mean(trains)), 5)}
        selection.append(row)
        print(f"  {cfg}: train {row['cv_train_error']:.5f}  val {row['cv_val_error']:.5f}")
    best = min(r["cv_val_error"] for r in selection)
    chosen = min((r for r in selection if r["cv_val_error"] <= best * 1.05),
                 key=lambda r: (r["hidden"] * r["bottleneck"], -r["noise"], r["cv_val_error"]))
    print(f"chosen: {chosen}")
    CFG = {k: chosen[k] for k in ("hidden", "bottleneck", "noise", "floor", "weight_decay")}

    # -------- cross-validated evaluation of the chosen size
    old = NumpyAutoencoder.load(args.compare) if args.compare and Path(args.compare).exists() else None
    cv = {"windows": 0, "above": 0, "above_model_only": 0, "episodes": 0, "minutes": 0.0,
          "old_above": 0, "old_episodes": 0, "train_mse": [], "val_mse": [], "test_mse": []}
    per_cam = defaultdict(lambda: {"windows": 0, "above": 0, "episodes": 0, "minutes": 0.0})
    stress = {k: [] for k in STRESS}
    old_stress = {k: [] for k in STRESS}
    for fi, (tr, va, te) in enumerate(folds):
        m, hist = train_model(gather(tr), gather(va), CFG, args.seed, args.epochs)
        m.calibrate(m.errors(gather(va)), percentile=95.0)
        calib = {p: np.concatenate([tr[p], va[p]]) for p in tr}
        cam_thr = per_camera_thresholds(m, feats, calib, m.threshold)
        thr_of = lambda p, c=cam_thr, t=m.threshold: c.get(camera_of(p), t)  # noqa: E731
        old_thr = per_camera_thresholds(old, feats, calib, old.threshold) if old is not None else {}
        for name, x in (("train_mse", gather(tr)), ("val_mse", gather(va)), ("test_mse", gather(te))):
            xs = m._scale(x)
            cv[name].append(float(np.mean((m.reconstruct(xs) - xs) ** 2)))
        for p, idx in te.items():
            if not len(idx):
                continue
            err = m.errors(feats[p][idx])
            r = err / thr_of(p)
            minutes = len(idx) * STRIDE / SAMPLE_FPS / 60
            eps = alert_episodes(r)
            cv["windows"] += len(idx); cv["above"] += int(np.sum(r > 1.0))
            cv["above_model_only"] += int(np.sum(err > m.threshold))
            cv["episodes"] += eps; cv["minutes"] += minutes
            c = per_cam[camera_of(p)]
            c["windows"] += len(idx); c["above"] += int(np.sum(r > 1.0)); c["episodes"] += eps; c["minutes"] += minutes
            if old is not None:
                ro = old.errors(feats[p][idx]) / old_thr[camera_of(p)]
                cv["old_above"] += int(np.sum(ro > 1.0)); cv["old_episodes"] += alert_episodes(ro)
        for kind, v in stress_eval(m, thr_of, te, seed_base=fi * 1000).items():
            stress[kind] += v
        if old is not None:
            for kind, v in stress_eval(old, lambda p, c=old_thr: c[camera_of(p)], te, seed_base=fi * 1000).items():
                old_stress[kind] += v
        print(f"  fold {fi + 1}/{args.folds}: done")

    rate = lambda hits: round(sum(hits) / len(hits), 3) if hits else None  # noqa: E731
    report = {
        "model": "denoising autoencoder (numpy), trained on factory CCTV footage",
        "data": {
            "videos_used": [p.name for p in used], "videos_skipped_too_short": skipped,
            "cameras": sorted({camera_of(p) for p in used}),
            "usable_windows": int(sum(len(feats[p]) - args.warmup for p in used)),
            "usable_minutes": round(sum(len(feats[p]) - args.warmup for p in used) * STRIDE / SAMPLE_FPS / 60, 2),
        },
        "model_selection": {"criterion": "median window error on the validation blocks, averaged over the folds; "
                                         "smallest model within 5% of the best",
                            "grid": selection, "chosen": chosen},
        "cross_validation": {
            "protocol": f"blocked {args.folds}-fold CV in time per recording; gap of {gap} windows around held-out blocks",
            "fit": {"train_mse": round(float(np.mean(cv["train_mse"])), 4),
                    "val_mse": round(float(np.mean(cv["val_mse"])), 4),
                    "test_mse": round(float(np.mean(cv["test_mse"])), 4)},
            "normal_footage": {
                "held_out_windows": cv["windows"], "held_out_minutes": round(cv["minutes"], 2),
                "windows_above_threshold": round(cv["above"] / max(cv["windows"], 1), 4),
                "windows_above_model_threshold_only": round(cv["above_model_only"] / max(cv["windows"], 1), 4),
                "false_alert_episodes": cv["episodes"],
                "note": "per-camera calibration simulated (p99 of the camera's training + validation blocks), as deployed",
                "per_camera": {cam: {"windows": c["windows"], "minutes": round(c["minutes"], 2),
                                     "windows_above_threshold": round(c["above"] / max(c["windows"], 1), 4),
                                     "false_alert_episodes": c["episodes"]} for cam, c in per_cam.items()},
            },
            "synthetic_stress_tests": {
                "note": "SYNTHETIC: held-out footage transformed to imitate unusual events; not real incidents",
                **{kind: {"segments": len(v), "detected": sum(v), "detection_rate": rate(v)}
                   for kind, v in stress.items()}},
        },
    }
    if old is not None:
        report["cross_validation"]["previous_model_v2_same_windows"] = {
            "note": "v2 (trained on public exercise / fall videos) with the same per-camera calibration",
            "windows_above_threshold": round(cv["old_above"] / max(cv["windows"], 1), 4),
            "false_alert_episodes": cv["old_episodes"],
            "synthetic_detection_rate": {kind: rate(v) for kind, v in old_stress.items()},
        }

    # -------- leave one camera out (camera never seen in training, no calibration)
    loco = {}
    for cam in sorted({camera_of(p) for p in used}):
        tr = {p: np.concatenate(blocks[p][:-1]) for p in used if camera_of(p) != cam}
        va = {p: blocks[p][-1] for p in used if camera_of(p) != cam}
        te = {p: np.concatenate(blocks[p]) for p in used if camera_of(p) == cam}
        m, _ = train_model(gather(tr), gather(va), CFG, args.seed, args.epochs)
        m.calibrate(m.errors(gather(va)), percentile=95.0)
        loco[cam] = {"windows": int(len(gather(te))),
                     "windows_above_threshold": round(float(np.mean(m.anomaly_ratio(gather(te)) > 1.0)), 4)}
    report["leave_one_camera_out"] = loco

    # -------- final model: all usable footage, last 15 % of each recording for early stopping + threshold
    tr, va = {}, {}
    for p in used:
        idx = np.arange(args.warmup, len(feats[p]))
        cut = int(len(idx) * 0.85)
        tr[p], va[p] = idx[:cut - gap], idx[cut:]
    model, hist = train_model(gather(tr), gather(va), CFG, args.seed, args.epochs, verbose=True)
    model.calibrate(model.errors(gather(va)), percentile=95.0)
    report["final_model"] = {
        "architecture": model.layer_sizes, "threshold": model.threshold,
        "threshold_rule": "p95 of validation-normal error; the live detector then raises it per camera "
                          "to the p99 of that camera's own normal footage (5-minute calibration)",
        "train_windows": int(len(gather(tr))), "val_windows": int(len(gather(va))),
        "epochs_trained": len(hist["train_loss"]),
        "camera_thresholds_on_validation": {c: round(t, 4) for c, t in
                                            per_camera_thresholds(model, feats, va, model.threshold).items()},
    }
    model.metadata = {"trained_at": time.strftime("%Y-%m-%d %H:%M:%S"), "sample_fps": SAMPLE_FPS,
                      "window_frames": WINDOW, "required_windows": 2,
                      "training_data": "factory CCTV footage of the deployment cameras"}
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    model.save(str(out))
    with open(out.with_suffix("").as_posix() + ".metrics.json", "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)
    _plot(out, hist, model.errors(gather(va)), model.threshold, report)
    print(json.dumps(report["cross_validation"], indent=2))
    print(json.dumps(report["leave_one_camera_out"], indent=2))
    print(f"saved {out}")


def _plot(out: Path, hist, val_err, thr, report) -> None:
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        return
    fig, ax = plt.subplots(1, 3, figsize=(15, 4))
    ax[0].plot(hist["train_loss"], label="train"); ax[0].plot(hist["val_loss"], label="validation")
    ax[0].set_title("v3 final model: training curve"); ax[0].set_xlabel("epoch"); ax[0].legend()
    sel = report["model_selection"]["grid"]
    labels = [f"{r['hidden']}-{r['bottleneck']}\nn{r['noise']}" for r in sel]
    xs = np.arange(len(sel))
    ax[1].bar(xs - 0.2, [r["cv_train_error"] for r in sel], 0.4, label="train")
    ax[1].bar(xs + 0.2, [r["cv_val_error"] for r in sel], 0.4, label="validation")
    ax[1].set_xticks(xs); ax[1].set_xticklabels(labels, fontsize=5)
    ax[1].set_title("Model size vs median error (5-fold CV)"); ax[1].legend()
    st = report["cross_validation"]["synthetic_stress_tests"]
    names = [k for k in STRESS if st[k]["segments"]]
    ax[2].bar(range(len(names)), [st[k]["detection_rate"] for k in names], color="#8B2E1F", label="v3 (factory)")
    old = report["cross_validation"].get("previous_model_v2_same_windows")
    if old:
        ax[2].bar([i + 0.3 for i in range(len(names))], [old["synthetic_detection_rate"][k] or 0 for k in names],
                  0.3, color="#A9A39C", label="v2")
    ax[2].set_xticks(range(len(names))); ax[2].set_xticklabels([n.replace("_", "\n") for n in names])
    ax[2].set_ylim(0, 1.05); ax[2].set_title("SYNTHETIC stress tests: share detected"); ax[2].legend()
    fig.tight_layout()
    fig.savefig(out.with_suffix("").as_posix() + ".evaluation.png", dpi=120)
    plt.close(fig)


if __name__ == "__main__":
    main()
