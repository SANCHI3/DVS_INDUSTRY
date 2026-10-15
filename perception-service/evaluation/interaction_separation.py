"""How well do the fight interaction thresholds separate fights from normal activity?

    cd perception-service
    python -m evaluation.interaction_separation

The interaction check (temporal/interaction.py) lets a fight incident through
only if two distinct people stayed close for >= min_interaction_seconds
(close_seconds) and the more active one moved with agitation >=
min_agitation_heights (0.1 body heights). This script measures both values on
labelled clips and asks how well the configured thresholds separate the classes.

Every clip is processed like the live pipeline does it: frames sampled at
detection_fps, resized to the processing resolution, YOLOv8n + ByteTrack, the
TemporalBuffer, and the module's own distinct_people() / pair_evidence(). The
only difference: track timestamps are the video's own time instead of the wall
clock, so the clips do not have to be replayed in real time. At every
processed frame every pair of distinct people is scored; per clip we keep

  close_seconds_max     the longest close_seconds of any pair at any time
  agitation_when_close  the highest agitation of a pair that was close enough
                        (close_seconds >= min_interaction_seconds) at that
                        time; 0 if no pair ever was. The check passes on the
                        clip iff this is >= min_agitation_heights.

This is the check on its own, evaluated at every frame. In the pipeline it
only runs after the R3D-18 model's 2-of-3 rule fires, so pass rates here are
an upper bound on how often it lets an alert through.

Clips: perception-service/field_data/{normal,events/fight} when that folder
exists, otherwise (PROXY) the fight dataset's held-out test split, 172 fight
and 172 not-fight clips.

Outputs: docs/results/interaction_separation.json (per-clip values),
docs/figures/interaction_separation.png and the "interaction" section of
docs/RESULTS.md. The configured threshold is NOT changed by this script.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from itertools import combinations
from pathlib import Path

import sklearn  # noqa: F401  (must load before torch on Windows, as in main.py)
import cv2
import numpy as np
import yaml

from evaluation.ablation import FIELD, fight_split, rel, videos
from evaluation.common import FIGURES, RESULTS_DIR, SERVICE_ROOT, update_section
from evaluation.stats import N_RESAMPLES, bootstrap_ci, roc_auc


def load_cfg() -> dict:
    return yaml.safe_load((SERVICE_ROOT / "config" / "thresholds.yaml").read_text(encoding="utf-8"))


def clip_values(path: Path, cfg: dict, detector, validator) -> dict:
    from temporal.interaction import distinct_people
    from temporal.temporal_buffer import TemporalBuffer
    from tracking.byte_tracker import ByteTracker

    perception, tracking = cfg["perception"], cfg["tracking"]
    tracker = ByteTracker(track_activation_threshold=tracking["track_activation_threshold"],
                          lost_track_buffer=tracking["lost_track_buffer"],
                          minimum_matching_threshold=tracking["minimum_matching_threshold"],
                          frame_rate=perception["detection_fps"])
    buffer = TemporalBuffer(window_seconds=cfg["temporal_buffer"]["window_seconds"])
    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS) or perception["detection_fps"]
    stride = max(1, int(round(fps / perception["detection_fps"])))   # as StreamReader samples files
    index, close_max, agit_close, agit_any, people_max = 0, 0.0, 0.0, 0.0, 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        index += 1
        if index % stride:
            continue
        now = index / fps
        detections = tracker.update(detector.detect(cv2.resize(frame, (perception["process_width"],
                                                                       perception["process_height"]))))
        for i in range(len(detections)):
            if detections.tracker_id is None:
                break
            buffer.update(int(detections.tracker_id[i]), detector.class_name(int(detections.class_id[i])),
                          detections.xyxy[i], float(detections.confidence[i]), timestamp=now)
        buffer.evict_stale(now=now)
        people = distinct_people(buffer.active_tracks_by_class("person", validator.active_track_seconds, now),
                                 validator.duplicate_iou)
        people_max = max(people_max, len(people))
        for a, b in combinations(people, 2):
            ev = validator.pair_evidence(a, b, now)
            close_max = max(close_max, ev["close_seconds"])
            agit_any = max(agit_any, ev["agitation"])
            if ev["close_seconds"] >= validator.min_interaction_seconds:
                agit_close = max(agit_close, ev["agitation"])
    cap.release()
    return {"clip": rel(path), "close_seconds_max": round(close_max, 2), "agitation_when_close": round(agit_close, 4),
            "agitation_any_pair": round(agit_any, 4), "max_distinct_people": people_max,
            "seconds": round(index / fps, 2)}


def rates(y: np.ndarray, score: np.ndarray, thr: float) -> tuple[float, float]:
    passed = score >= thr
    return float(passed[y == 1].mean()), float(passed[y == 0].mean())


def analyse(rows: list[dict], cfg_thr: float, close_thr: float) -> dict:
    y = np.array([r["label"] for r in rows])
    s = np.array([r["agitation_when_close"] for r in rows])
    c = np.array([r["close_seconds_max"] for r in rows])
    grid = np.round(np.arange(0.01, 0.501, 0.005), 3)
    js = [(lambda t, f: t - f)(*rates(y, s, t)) for t in grid]
    best = float(grid[int(np.argmax(js))])

    def at(thr):
        tpr, fpr = rates(y, s, thr)
        j = lambda idx: (lambda t, f: t - f)(*rates(y[idx], s[idx], thr)) \
            if (y[idx] == 1).any() and (y[idx] == 0).any() else None  # noqa: E731
        return {"threshold": thr, "fight_pass_rate": round(tpr, 4), "normal_pass_rate": round(fpr, 4),
                "fight_pass_rate_ci95": bootstrap_ci(len(y), lambda idx: float((s[idx][y[idx] == 1] >= thr).mean())
                                                     if (y[idx] == 1).any() else None),
                "normal_pass_rate_ci95": bootstrap_ci(len(y), lambda idx: float((s[idx][y[idx] == 0] >= thr).mean())
                                                      if (y[idx] == 0).any() else None),
                "youden_j": round(tpr - fpr, 4), "youden_j_ci95": bootstrap_ci(len(y), j)}

    def diff(idx):
        yi, si = y[idx], s[idx]
        if not (yi == 1).any() or not (yi == 0).any():
            return None
        jb = (lambda t, f: t - f)(*rates(yi, si, best))
        jc = (lambda t, f: t - f)(*rates(yi, si, cfg_thr))
        return jb - jc

    diff_ci = bootstrap_ci(len(y), diff)
    clearly_better = bool(diff_ci and diff_ci[0] > 0 and best != cfg_thr)
    close_tpr, close_fpr = float((c[y == 1] >= close_thr).mean()), float((c[y == 0] >= close_thr).mean())
    return {
        "n_fight": int((y == 1).sum()), "n_normal": int((y == 0).sum()),
        "auc_agitation_when_close": round(roc_auc(y, s), 4),
        "auc_agitation_when_close_ci95": bootstrap_ci(len(y), lambda idx: roc_auc(y[idx], s[idx])),
        "auc_close_seconds_max": round(roc_auc(y, c), 4),
        "configured": at(cfg_thr),
        "best_youden": at(best),
        "best_minus_configured_j_ci95": diff_ci,
        "best_clearly_better": clearly_better,
        "close_seconds_threshold": close_thr,
        "close_fight_pass_rate": round(close_tpr, 4), "close_normal_pass_rate": round(close_fpr, 4),
        "median": {k: {"fight": float(np.median(v[y == 1])), "normal": float(np.median(v[y == 0]))}
                   for k, v in (("agitation_when_close", s), ("close_seconds_max", c))},
    }


def make_figure(rows: list[dict], res: dict, cfg_thr: float, close_thr: float, source: str) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    blue, orange, ink, ink2, grid = "#2a78d6", "#eb6834", "#0b0b0b", "#52514e", "#e4e3df"
    y = np.array([r["label"] for r in rows])
    fig, axes = plt.subplots(1, 2, figsize=(11, 4.3), dpi=150)
    panels = [("agitation_when_close", "Agitation of the closest-interacting pair (body heights)",
               cfg_thr, "configured 0.1", np.linspace(0, max(0.6, max(r["agitation_when_close"] for r in rows)), 41)),
              ("close_seconds_max", "Longest time a pair stayed close (s, within 3 s)",
               close_thr, f"configured {close_thr:g} s", np.linspace(0, 3.2, 33))]
    for ax, (key, title, thr, thr_label, bins) in zip(axes, panels):
        v = np.array([r[key] for r in rows])
        ax.hist(v[y == 0], bins=bins, color=blue, alpha=0.75, label=f"normal (n={int((y == 0).sum())})")
        ax.hist(v[y == 1], bins=bins, color=orange, alpha=0.65, label=f"fight (n={int((y == 1).sum())})")
        ax.axvline(thr, color=ink, linewidth=1.2, linestyle="--")
        ax.text(thr, ax.get_ylim()[1] * 0.95, f" {thr_label}", color=ink, fontsize=8, va="top")
        if key == "agitation_when_close" and res["best_youden"]["threshold"] != cfg_thr:
            b = res["best_youden"]["threshold"]
            ax.axvline(b, color=ink2, linewidth=1, linestyle=":")
            ax.text(b, ax.get_ylim()[1] * 0.85, f" best J {b:g}", color=ink2, fontsize=8, va="top")
        ax.set_title(title, fontsize=10, color=ink, loc="left")
        ax.set_ylabel("clips", color=ink2)
        ax.spines[["top", "right"]].set_visible(False)
        ax.spines[["left", "bottom"]].set_color(grid)
        ax.tick_params(colors=ink2, labelsize=8.5)
        ax.yaxis.grid(True, color=grid, linewidth=0.8)
        ax.set_axisbelow(True)
        ax.legend(frameon=False, fontsize=8.5)
    fig.suptitle(f"Interaction-check separation on {source}", fontsize=9.5, color=ink2, x=0.01, ha="left")
    fig.tight_layout(rect=(0, 0, 1, 0.95))
    FIGURES.mkdir(parents=True, exist_ok=True)
    fig.savefig(FIGURES / "interaction_separation.png")
    plt.close(fig)


def markdown(result: dict) -> str:
    r = result["analysis"]
    c, b = r["configured"], r["best_youden"]
    ci = lambda x: f"[{x[0]:.2f}, {x[1]:.2f}]" if x else ""  # noqa: E731
    out = ["## 5. Fight interaction-check thresholds", "",
           f"Generated by `python -m evaluation.interaction_separation` on {result['run_at'][:10]}. "
           f"Clips: **{result['source']}** ({r['n_fight']} fight, {r['n_normal']} normal). Values are measured "
           "with the live detector, tracker and `temporal/interaction.py` at every processed frame (video "
           f"time instead of wall-clock). Brackets: bootstrap 95% CI over clips ({N_RESAMPLES} resamples).", "",
           "| Quantity | Fight clips (median) | Normal clips (median) | ROC AUC |", "|---|---|---|---|",
           f"| agitation of a close pair (body heights) | {r['median']['agitation_when_close']['fight']:.3f} | "
           f"{r['median']['agitation_when_close']['normal']:.3f} | {r['auc_agitation_when_close']:.2f} "
           f"{ci(r['auc_agitation_when_close_ci95'])} |",
           f"| longest close_seconds | {r['median']['close_seconds_max']['fight']:.2f} | "
           f"{r['median']['close_seconds_max']['normal']:.2f} | {r['auc_close_seconds_max']:.2f} |", "",
           "| Agitation threshold | Fight clips passing | Normal clips passing | Youden J |", "|---|---|---|---|",
           f"| {c['threshold']:g} (configured) | {c['fight_pass_rate']:.2f} {ci(c['fight_pass_rate_ci95'])} | "
           f"{c['normal_pass_rate']:.2f} {ci(c['normal_pass_rate_ci95'])} | {c['youden_j']:.2f} {ci(c['youden_j_ci95'])} |",
           f"| {b['threshold']:g} (best J on these clips) | {b['fight_pass_rate']:.2f} {ci(b['fight_pass_rate_ci95'])} | "
           f"{b['normal_pass_rate']:.2f} {ci(b['normal_pass_rate_ci95'])} | {b['youden_j']:.2f} {ci(b['youden_j_ci95'])} |",
           "", f"Closeness alone (close_seconds >= {r['close_seconds_threshold']:g} s): fight clips "
               f"{r['close_fight_pass_rate']:.2f}, normal clips {r['close_normal_pass_rate']:.2f}.", "",
           f"Difference in J, best minus configured: {ci(r['best_minus_configured_j_ci95']) or '–'} "
           f"(the best threshold is chosen on these same clips, so this is optimistic). "
           + ("**The data favour the best-J threshold; the configured value is kept and both are reported.**"
              if r["best_clearly_better"] else
              "The interval includes 0, so the data do not clearly favour another value; the configured "
              "threshold is kept."),
           "", "Pass rates are for the check on its own at every frame. In the pipeline it only runs after the "
               "R3D-18 2-of-3 rule fires, so these are upper bounds on how often it lets an alert through.",
           "", "![Interaction-check separation](figures/interaction_separation.png)", "",
           "*Distribution of agitation (left) and close time (right) for fight vs normal clips; dashed = configured threshold.*"]
    return "\n".join(out)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--limit", type=int, help="at most N clips per class (smoke testing; no docs written)")
    args = parser.parse_args()
    cfg = load_cfg()
    inter_cfg = cfg["fight_detection"]["interaction"]
    if FIELD.exists():
        fights, normals = videos(FIELD / "events" / "fight"), videos(FIELD / "normal")
        source = "field recordings (perception-service/field_data)"
    else:
        fights, normals = fight_split("test", "1"), fight_split("test", "0")
        source = "PROXY: fight-dataset held-out test split (not field recordings)"
    if args.limit:
        fights, normals = fights[:args.limit], normals[:args.limit]

    from detection.yolo_detector import YoloDetector
    from temporal.interaction import InteractionValidator
    p = cfg["perception"]
    detector = YoloDetector(p["model_path"], p["confidence_threshold"], p["classes_of_interest"])
    validator = InteractionValidator(inter_cfg)
    rows = []
    for label, clips in ((1, fights), (0, normals)):
        for i, path in enumerate(clips):
            rows.append({**clip_values(path, cfg, detector, validator), "label": label})
            if (i + 1) % 25 == 0:
                print(f"{'fight' if label else 'normal'}: {i + 1}/{len(clips)}", flush=True)
    cfg_thr = float(inter_cfg["min_agitation_heights"])
    close_thr = float(inter_cfg["min_interaction_seconds"])
    result = {"run_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "source": source,
              "generated_by": "perception-service/evaluation/interaction_separation.py",
              "interaction_config": inter_cfg, "analysis": analyse(rows, cfg_thr, close_thr), "clips": rows}
    text = markdown(result)
    print(text)
    if args.limit:
        return
    make_figure(rows, result["analysis"], cfg_thr, close_thr, source)
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    (RESULTS_DIR / "interaction_separation.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    update_section("interaction", text)


if __name__ == "__main__":
    main()
