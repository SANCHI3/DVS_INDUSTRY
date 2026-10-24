"""Ablation of the false-alarm verification stages.

    cd perception-service
    python -m evaluation.ablation run                # all configurations (hours: real-time replay)
    python -m evaluation.ablation run --configs b_full c_no_interaction
    python -m evaluation.ablation report             # tables, chart, RESULTS.md from saved runs

Each configuration plays every clip of every set through the real pipeline
(main.run, headless, dashboard and LLM off), one clip at a time with fresh
state, at the live 10 processed frames/s (the detectors use wall-clock time,
so clips must be replayed in real time). Configurations differ only in
existing thresholds.yaml flags (applied by evaluation/ablation_worker.py), or,
for (a), in the code: commit 85315cc~1 checked out in a temporary git worktree.

  a_prefix          code before "Fix false-positive CCTV detections" (85315cc~1)
  b_full            current code, interaction check as a VETO (the earlier default)
  c_no_interaction  fight_detection.interaction.enabled = false
  d_no_dynamics     (b) with fire_smoke_detection.dynamics.enabled = false
  e_no_calibration  (b) with scene_anomaly.calibration.enabled = false
  f_single_frame    (b) with every N-of-M persistence rule set to 1 of 1 (see SINGLE_FRAME)
  g_review          current code, interaction check in REVIEW mode (the current default):
                    a fight without interaction evidence is sent to an operator as PROBABLE
  h_tuned           the deployed configuration after the false-positive tuning that followed
                    (g): fight pop-up alarm threshold 0.75 (lower scores go to review),
                    smoke on a person ignored, fall torso rule; thresholds.yaml as is

(b), (d), (e) and (f) pin the veto so they stay comparable with each other and
with earlier runs; (g) - (b) is the effect of turning the veto into a review
signal. Fights sent for review are counted separately from alerts.

Footage. The field recordings this study was designed for (normal activity,
staged events and look-alikes from the deployment camera) were not available,
so the sets below are a PROXY built from held-out or public clips already in
data/. They are labelled as such everywhere. `field_*` sets are used instead
when perception-service/field_data/ exists (see FIELD_SETS).

Scene-anomaly calibration needs 300 s of continuous footage from one camera;
the proxy clips are a few seconds each and come from many cameras. For the
configurations with calibration on, it is computed once from CALIBRATION_SET
(normal clips disjoint from every evaluation set) by pooling the windows the
real detector records on each clip (ablation_worker.py --mode calibrate), and
the resulting file is given to every clip.

Outputs: docs/results/ablation.json, docs/results/ablation_per_clip/<config>.jsonl,
docs/figures/ablation.png and the "ablation" section of docs/RESULTS.md.
"""
from __future__ import annotations

import argparse
import csv
import json
import random
import shutil
import subprocess
import sys
import tempfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np

from evaluation.common import FIGURES, REPO_ROOT, RESULTS_DIR, SERVICE_ROOT, update_section
from evaluation.stats import N_RESAMPLES, bootstrap_ci

PREFIX_REF = "85315cc~1"
DATA = SERVICE_ROOT / "data"
FIELD = SERVICE_ROOT / "field_data"
PER_CLIP_DIR = RESULTS_DIR / "ablation_per_clip"
WORKER = SERVICE_ROOT / "evaluation" / "ablation_worker.py"
WARMUP_CLIP = SERVICE_ROOT / "demo_videos" / "01_normal_activity.mp4"
VIDEO_EXT = {".mp4", ".avi", ".mov", ".mkv"}

VETO = {"fight_detection.interaction.mode": "veto"}
SINGLE_FRAME = {
    **VETO,
    "fight_detection.rgb.persistence_window": 1, "fight_detection.rgb.required_confirmed": 1,
    "fire_smoke_detection.persistence_window": 1, "fire_smoke_detection.required_hits": 1,
    "fire_smoke_detection.single_class_confirm_seconds": 0,
    "fall_detection.gru.persistence_window": 1, "fall_detection.gru.required_hits": 1,
    "scene_anomaly.persistence_window": 1, "scene_anomaly.required_hits": 1,
    "confirmation.default.probable_hits": 1, "confirmation.default.probable_window": 1,
    "confirmation.default.confirmed_hits": 1, "confirmation.default.confirmed_window": 1,
}
CONFIGS = {
    "a_prefix": {"label": "(a) pre-fix code", "ref": PREFIX_REF, "overrides": {}, "calibrated": False},
    "b_full": {"label": "(b) full system (interaction veto)", "overrides": VETO, "calibrated": True},
    "c_no_interaction": {"label": "(c) full − interaction check",
                         "overrides": {"fight_detection.interaction.enabled": False}, "calibrated": True},
    "d_no_dynamics": {"label": "(d) full − region dynamics",
                      "overrides": {**VETO, "fire_smoke_detection.dynamics.enabled": False}, "calibrated": True},
    "e_no_calibration": {"label": "(e) full − anomaly calibration",
                         "overrides": {**VETO, "scene_anomaly.calibration.enabled": False}, "calibrated": False},
    "f_single_frame": {"label": "(f) full, single-frame (1/1)", "overrides": SINGLE_FRAME, "calibrated": True},
    "g_review": {"label": "(g) interaction check in review mode",
                 "overrides": {"fight_detection.interaction.mode": "review"}, "calibrated": True},
    "h_tuned": {"label": "(h) deployed, after false-positive tuning", "overrides": {}, "calibrated": True},
}
CALIBRATION_OVERRIDES = {"scene_anomaly.calibration.enabled": True, "scene_anomaly.calibration.recalibrate": True,
                         "scene_anomaly.calibration.seconds": 1e9}

# set name -> (kind, event_type for recall, description)
SET_INFO = {
    "normal": ("normal", None, "fight-dataset test split, not-fight clips (held out from every model)"),
    "lookalikes": ("lookalike", None, "FIRESENSE fire/neg + smoke/neg clips (fire/smoke look-alike scenes)"),
    "fight": ("event", "fight", "fight-dataset test split, fight clips (held out)"),
    "fall": ("event", "fall", "fall dataset, fall clips (IN-SAMPLE: the deployed fall GRU was trained on them)"),
    "fire": ("event", "fire_smoke", "FIRESENSE fire/pos clips (verifier trained on FIRESENSE)"),
    "smoke": ("event", "fire_smoke", "FIRESENSE smoke/pos clips (verifier trained on FIRESENSE)"),
    "fire_smoke": ("event", "fire_smoke", "field recordings: staged fire/smoke"),
}
FIELD_SETS = {"normal": "normal", "lookalikes": "lookalikes", "fight": "events/fight",
              "fall": "events/fall", "fire_smoke": "events/fire_smoke"}


def code_version() -> str:
    """Short commit of HEAD, marked when perception-service has uncommitted changes."""
    head = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=REPO_ROOT,
                          capture_output=True, text=True).stdout.strip()
    dirty = subprocess.run(["git", "status", "--porcelain", "--", "perception-service"], cwd=REPO_ROOT,
                           capture_output=True, text=True).stdout.strip()
    return f"{head} + uncommitted changes" if dirty else head


def fight_split(split: str, label: str) -> list[Path]:
    rows = csv.DictReader((DATA / "rgb_fight_manifest.csv").open(encoding="utf-8"))
    return sorted(DATA / "fight_videos" / r["group_id"] for r in rows if r["split"] == split and r["label"] == label)


def videos(folder: Path) -> list[Path]:
    return sorted(p for p in folder.rglob("*") if p.suffix.lower() in VIDEO_EXT)


def proxy_sets() -> tuple[dict, list[Path]]:
    fs = DATA / "fire_smoke_videos" / "firesense"
    sets = {
        "normal": fight_split("test", "0"),
        "lookalikes": videos(fs / "fire" / "neg") + videos(fs / "smoke" / "neg"),
        "fight": fight_split("test", "1"),
        "fall": videos(DATA / "fall_videos" / "fall"),
        "fire": videos(fs / "fire" / "pos"),
        "smoke": videos(fs / "smoke" / "pos"),
    }
    calibration = fight_split("val", "0")
    random.Random(0).shuffle(calibration)
    return sets, calibration   # all 172: a 5-s clip yields only ~1 anomaly window


def field_sets() -> tuple[dict, list[Path]]:
    sets = {name: videos(FIELD / sub) for name, sub in FIELD_SETS.items() if (FIELD / sub).exists()}
    # The deployed procedure: calibrate on this camera's own normal footage. The
    # same normal/ footage is then also scored, which favours calibration a little.
    return sets, sets.get("normal", [])


def clip_minutes(path: Path) -> float:
    cap = cv2.VideoCapture(str(path))
    frames, fps = cap.get(cv2.CAP_PROP_FRAME_COUNT), cap.get(cv2.CAP_PROP_FPS)
    cap.release()
    return frames / fps / 60.0 if fps and frames else 0.0


def rel(path: Path) -> str:
    try:
        return path.relative_to(SERVICE_ROOT).as_posix()
    except ValueError:
        return str(path)


# ─────────────────────────────────────────────────────────────── running

def worker(tree: Path, args: list[str], log: Path) -> None:
    cmd = [sys.executable, str(WORKER), *args]
    with log.open("a", encoding="utf-8") as handle:
        result = subprocess.run(cmd, cwd=tree, stdout=handle, stderr=subprocess.STDOUT)
    if result.returncode != 0:
        raise SystemExit(f"worker failed (exit {result.returncode}); see {log}")


def calibrate(clips: list[Path], work: Path) -> Path:
    target = PER_CLIP_DIR / "scene_anomaly_calibration.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        print(f"reusing {rel(target)}")
        return target
    clip_file = work / "calibration_clips.json"
    clip_file.write_text(json.dumps([str(c) for c in clips]), encoding="utf-8")
    print(f"calibrating scene anomaly on {len(clips)} clips ...")
    worker(SERVICE_ROOT, ["--mode", "calibrate", "--clips", str(clip_file), "--no-zones",
                          "--overrides", json.dumps(CALIBRATION_OVERRIDES), "--work", str(work / "cal"),
                          "--calibration", str(target), "--warmup", str(WARMUP_CLIP)], work / "calibration.log")
    return target


def run_config(name: str, sets: dict, calibration: Path | None, work: Path) -> None:
    cfg = CONFIGS[name]
    PER_CLIP_DIR.mkdir(parents=True, exist_ok=True)
    raw = work / f"{name}.raw.jsonl"
    tree, cleanup = SERVICE_ROOT, None
    if cfg.get("ref"):
        tree_root = work / f"tree_{name}"
        if not tree_root.exists():
            subprocess.run(["git", "worktree", "add", "--detach", str(tree_root), cfg["ref"]],
                           cwd=REPO_ROOT, check=True)
        tree, cleanup = tree_root / "perception-service", tree_root
    clips = [str(c) for clips in sets.values() for c in clips]
    clip_file = work / f"{name}.clips.json"
    clip_file.write_text(json.dumps(clips), encoding="utf-8")
    args = ["--clips", str(clip_file), "--overrides", json.dumps(cfg["overrides"]), "--no-zones",
            "--work", str(work / name), "--results", str(raw), "--warmup", str(WARMUP_CLIP)]
    if cfg["calibrated"] and calibration is not None:
        args += ["--calibration", str(calibration)]
    print(f"[{name}] {len(clips)} clips -> {raw}")
    try:
        worker(tree, args, work / f"{name}.log")
    finally:
        if cleanup is not None:
            subprocess.run(["git", "worktree", "remove", "--force", str(cleanup)], cwd=REPO_ROOT, check=False)
    set_of = {str(c): s for s, cs in sets.items() for c in cs}
    with (PER_CLIP_DIR / f"{name}.jsonl").open("w", encoding="utf-8") as out:
        for line in raw.read_text(encoding="utf-8").splitlines():
            r = json.loads(line)
            out.write(json.dumps(compact(r, set_of[r["clip"]])) + "\n")


def compact(record: dict, set_name: str) -> dict:
    """Per-clip outcome kept in the repo: incident types/tiers, not the full records."""
    escalated = {u["incident_id"] for u in record["updates"] if u.get("confidence_tier") == "CONFIRMED"}
    incidents = []
    for r in record["incidents"]:
        alert = r["confidence_tier"] == "CONFIRMED" or r["incident_id"] in escalated
        detail = r.get("detail") or {}
        incidents.append({
            "event_type": r["event_type"], "tier": r["confidence_tier"], "dashboard": alert,
            # a fight sent for operator review (interaction check failed or score below the
            # alarm threshold) and never confirmed
            "review": (not alert and r["event_type"] == "fight" and r["confidence_tier"] == "PROBABLE"
                       and (detail.get("review") is True or detail.get("interaction_passed") is False)),
            "validation_version": detail.get("validation_version")})
    path = Path(record["clip"])
    return {"set": set_name, "clip": rel(path), "minutes": round(clip_minutes(path), 4),
            "wall_seconds": record["seconds"], "incidents": incidents}


# ─────────────────────────────────────────────────────────────── report

def load_per_clip(name: str) -> list[dict]:
    path = PER_CLIP_DIR / f"{name}.jsonl"
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def summarise(rows: list[dict]) -> dict:
    out = {}
    for set_name in SET_INFO:
        clips = [r for r in rows if r["set"] == set_name]
        if not clips:
            continue
        kind, event, _ = SET_INFO[set_name]
        minutes = np.array([c["minutes"] for c in clips])
        if kind in ("normal", "lookalike"):
            types = sorted({i["event_type"] for c in clips for i in c["incidents"] if i["dashboard"]})
            per_type = {}
            for t in types + ["total"]:
                counts = np.array([sum(1 for i in c["incidents"] if i["dashboard"] and (t == "total" or i["event_type"] == t))
                                   for c in clips])
                rate = lambda idx, counts=counts: float(counts[idx].sum() * 60.0 / minutes[idx].sum())  # noqa: E731
                per_type[t] = {"count": int(counts.sum()), "per_hour": round(rate(np.arange(len(clips))), 2),
                               "per_hour_ci95": bootstrap_ci(len(clips), rate)}
            reviews = np.array([sum(1 for i in c["incidents"] if i.get("review")) for c in clips])
            review_rate = lambda idx: float(reviews[idx].sum() * 60.0 / minutes[idx].sum())  # noqa: E731
            out[set_name] = {"kind": kind, "clips": len(clips), "minutes": round(float(minutes.sum()), 2),
                             "false_alarms": per_type,
                             "review_alerts": {"count": int(reviews.sum()),
                                               "per_hour": round(review_rate(np.arange(len(clips))), 2),
                                               "per_hour_ci95": bootstrap_ci(len(clips), review_rate)},
                             "all_records": sum(len(c["incidents"]) for c in clips)}
        else:
            hit = np.array([any(i["dashboard"] and i["event_type"] == event for i in c["incidents"]) for c in clips])
            hit_any = np.array([any((i["dashboard"] or i.get("review")) and i["event_type"] == event
                                    for i in c["incidents"]) for c in clips])
            by_type = Counter(i["event_type"] for c in clips for i in c["incidents"] if i["dashboard"])
            out[set_name] = {"kind": kind, "event_type": event, "clips": len(clips),
                             "minutes": round(float(minutes.sum()), 2), "detected": int(hit.sum()),
                             "dashboard_alarms_by_type": dict(sorted(by_type.items())),
                             "recall": round(float(hit.mean()), 4),
                             "recall_ci95": bootstrap_ci(len(clips), lambda idx: float(hit[idx].mean())),
                             "detected_incl_review": int(hit_any.sum()),
                             "recall_incl_review": round(float(hit_any.mean()), 4),
                             "recall_incl_review_ci95": bootstrap_ci(len(clips),
                                                                     lambda idx: float(hit_any[idx].mean()))}
    return out


def paired_differences(reference: list[dict], other: list[dict]) -> dict:
    """Configuration minus full system on the SAME clips, with a paired bootstrap
    (one resample of clips is applied to both configurations)."""
    ref = {r["clip"]: r for r in reference}
    out = {}
    for set_name, (kind, event, _) in SET_INFO.items():
        clips = [r for r in other if r["set"] == set_name and r["clip"] in ref]
        if not clips:
            continue
        minutes = np.array([c["minutes"] for c in clips])
        if kind in ("normal", "lookalike"):
            def alarms(rows, with_review=False):
                return np.array([sum(1 for i in r["incidents"] if i["dashboard"] or (with_review and i.get("review")))
                                 for r in rows])
            a, b = alarms(clips), alarms([ref[c["clip"]] for c in clips])
            a2 = alarms(clips, True)
            delta = lambda idx: float((a[idx].sum() - b[idx].sum()) * 60.0 / minutes[idx].sum())  # noqa: E731
            delta2 = lambda idx: float((a2[idx].sum() - b[idx].sum()) * 60.0 / minutes[idx].sum())  # noqa: E731
            out[set_name] = {"metric": "false alarms per hour, config minus full",
                             "delta": round(delta(np.arange(len(clips))), 2), "ci95": bootstrap_ci(len(clips), delta),
                             "delta_incl_review": round(delta2(np.arange(len(clips))), 2),
                             "ci95_incl_review": bootstrap_ci(len(clips), delta2)}
        else:
            def hits(rows, with_review=False):
                return np.array([any((i["dashboard"] or (with_review and i.get("review"))) and i["event_type"] == event
                                     for i in r["incidents"]) for r in rows], dtype=float)
            a, b = hits(clips), hits([ref[c["clip"]] for c in clips])
            a2 = hits(clips, True)
            delta = lambda idx: float(a[idx].mean() - b[idx].mean())  # noqa: E731
            delta2 = lambda idx: float(a2[idx].mean() - b[idx].mean())  # noqa: E731
            out[set_name] = {"metric": "recall, config minus full",
                             "delta": round(delta(np.arange(len(clips))), 4), "ci95": bootstrap_ci(len(clips), delta),
                             "delta_incl_review": round(delta2(np.arange(len(clips))), 4),
                             "ci95_incl_review": bootstrap_ci(len(clips), delta2),
                             "only_config_detected": int(((a == 1) & (b == 0)).sum()),
                             "only_full_detected": int(((a == 0) & (b == 1)).sum())}
    return out


def processing_speed(rows: list[dict]) -> dict:
    """Wall-clock seconds per second of video, per set (1.0 = real time)."""
    out = {}
    for set_name in SET_INFO:
        clips = [r for r in rows if r["set"] == set_name]
        if clips:
            out[set_name] = round(sum(c["wall_seconds"] for c in clips) / (60 * sum(c["minutes"] for c in clips)), 2)
    return out


def longest_clip(rows: list[dict]) -> dict | None:
    """The longest clip's length and wall time: shows whether long scenes kept real time."""
    if not rows:
        return None
    clip = max(rows, key=lambda r: r["minutes"])
    return {"clip": clip["clip"], "set": clip["set"], "seconds": round(clip["minutes"] * 60),
            "wall_seconds": round(clip["wall_seconds"])}


def make_figure(results: dict) -> str | None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    names = [n for n in CONFIGS if n in results["configs"]]
    if not names:
        return None
    colors = ["#2a78d6", "#eb6834", "#1baf7a", "#8a5cd1", "#d4a20b", "#52514e", "#c2398a", "#0f8b8d"]
    ink, ink2, grid = "#0b0b0b", "#52514e", "#e4e3df"
    fa_groups = [("normal", "Normal clips"), ("lookalikes", "Look-alike clips")]
    rec_groups = [(s, s.replace("_", "/").capitalize()) for s in ("fight", "fall", "fire", "smoke", "fire_smoke")
                  if any(s in results["configs"][n]["sets"] for n in names)]
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 4.8), dpi=150, gridspec_kw={"width_ratios": [2, 4]})
    width = 0.8 / len(names)
    for k, name in enumerate(names):
        res = results["configs"][name]["sets"]
        for ax, groups, getter in [
            (ax1, fa_groups, lambda s: (s["false_alarms"]["total"]["per_hour"], s["false_alarms"]["total"]["per_hour_ci95"])),
            (ax2, rec_groups, lambda s: (s["recall"], s["recall_ci95"])),
        ]:
            xs, vals, errs = [], [], [[], []]
            for g, (set_name, _) in enumerate(groups):
                if set_name not in res:
                    continue
                v, ci = getter(res[set_name])
                xs.append(g - 0.4 + width * (k + 0.5))
                vals.append(v)
                lo, hi = ci if ci else (v, v)
                errs[0].append(max(v - lo, 0))
                errs[1].append(max(hi - v, 0))
            ax.bar(xs, vals, width * 0.92, color=colors[k], label=CONFIGS[name]["label"] if ax is ax1 else None,
                   yerr=errs, error_kw={"elinewidth": 0.8, "ecolor": ink2, "capsize": 1.5})
    for ax, groups, title, ylabel in [
        (ax1, fa_groups, "False alarms per hour (dashboard alerts)", "alerts / hour"),
        (ax2, rec_groups, "Recall on genuine-event clips", "events detected / clips"),
    ]:
        ax.set_xticks(range(len(groups)), [g[1] for g in groups], fontsize=9)
        ax.set_title(title, fontsize=10.5, color=ink, loc="left")
        ax.set_ylabel(ylabel, color=ink2)
        ax.spines[["top", "right"]].set_visible(False)
        ax.spines[["left", "bottom"]].set_color(grid)
        ax.tick_params(colors=ink2, labelsize=9)
        ax.yaxis.grid(True, color=grid, linewidth=0.8)
        ax.set_axisbelow(True)
    ax2.set_ylim(0, 1.05)
    fig.legend(frameon=False, ncol=3, loc="lower center", fontsize=8.5, bbox_to_anchor=(0.5, -0.01))
    fig.suptitle("Ablation on the PROXY clip sets (public/held-out clips, not field recordings); "
                 "error bars = bootstrap 95% CI over clips", fontsize=9, color=ink2, x=0.01, ha="left")
    fig.tight_layout(rect=(0, 0.08, 1, 0.95))
    FIGURES.mkdir(parents=True, exist_ok=True)
    fig.savefig(FIGURES / "ablation.png")
    plt.close(fig)
    return "ablation.png"


def fmt_ci(v, ci, digits=1):
    if v is None:
        return "–"
    return f"{v:.{digits}f} [{ci[0]:.{digits}f}, {ci[1]:.{digits}f}]" if ci else f"{v:.{digits}f}"


def markdown(results: dict, figure: str | None) -> str:
    cfgs = results["configs"]
    names = [n for n in CONFIGS if n in cfgs]
    src = results["footage"]
    out = ["## 4. Ablation study", "",
           f"Generated by `python -m evaluation.ablation` (runs {results['run_dates']}). "
           f"Footage: **{src}**. Every clip is played separately through the real pipeline at the live "
           "10 processed frames/s, headless, dashboard and LLM off, zones removed. Counts are dashboard "
           "alerts (CONFIRMED, or PROBABLE later escalated); fights sent for operator review in (g) and (h) are "
           "counted separately below. Brackets: bootstrap 95% CI over clips "
           f"({N_RESAMPLES} resamples). Per-clip outcomes: `docs/results/ablation_per_clip/`.", ""]
    if src.startswith("proxy"):
        out += ["**These are proxy sets, not field recordings.** The deployment-camera recordings "
                "(normal activity, staged events, look-alikes) were not available, so the rows below use "
                "short clips from many different cameras. False-alarm rates are therefore rates on "
                "*clips of other people's cameras*, and the per-camera anomaly calibration is computed "
                "from a pool of such clips rather than from one camera. Treat the numbers as evidence "
                "about the direction of each stage's effect, not as deployment rates.", "",
                "| Set | Clips | Minutes | Source |", "|---|---|---|---|"]
        first = cfgs[names[0]]["sets"]
        for set_name, (kind, _, desc) in SET_INFO.items():
            if set_name in first:
                out.append(f"| {set_name} | {first[set_name]['clips']} | {first[set_name]['minutes']:.1f} | {desc} |")
        out.append("")
    event_sets = [e for e in ("fight", "fall", "fire", "smoke", "fire_smoke")
                  if any(e in cfgs[n]["sets"] for n in names)]
    out += ["### False alarms per hour", "",
            "| Configuration | Normal: total / h | Normal: by type | Look-alikes: total / h | Look-alikes: by type |",
            "|---|---|---|---|---|"]
    for n in names:
        s = cfgs[n]["sets"]
        cells = []
        for set_name in ("normal", "lookalikes"):
            if set_name not in s:
                cells += ["–", "–"]
                continue
            fa = s[set_name]["false_alarms"]
            cells.append(f"{fa['total']['count']} alarms = {fmt_ci(fa['total']['per_hour'], fa['total']['per_hour_ci95'])}")
            by = [f"{t} {v['count']} ({v['per_hour']:.1f}/h)" for t, v in fa.items() if t != "total"]
            cells.append(", ".join(by) or "none")
        out.append(f"| {CONFIGS[n]['label']} | " + " | ".join(cells) + " |")
    out += ["", "### Recall on genuine events (events detected / clips)", "",
            "| Configuration | " + " | ".join(event_sets) + " |",
            "|---" * (len(event_sets) + 1) + "|"]
    for n in names:
        s = cfgs[n]["sets"]
        cells = []
        for set_name in event_sets:
            if set_name in s:
                r = s[set_name]
                cells.append(f"{r['detected']}/{r['clips']} = {fmt_ci(r['recall'], r['recall_ci95'], 2)}")
            else:
                cells.append("–")
        out.append(f"| {CONFIGS[n]['label']} | " + " | ".join(cells) + " |")
    paired = results.get("paired_vs_full") or {}
    if paired:
        cols = ["normal", "lookalikes"] + event_sets
        out += ["", "### Paired differences against the full system", "",
                "Every configuration ran on the same clips, so each is compared with (b) clip by clip: the "
                "same bootstrap resample of clips is applied to both. False alarms: alarms per hour, "
                "configuration minus full (positive = more false alarms without the stage). Recall: "
                "configuration minus full (positive = the stage was costing detections). An interval that "
                "excludes 0 marks a difference larger than resampling noise.", "",
                "| Configuration | " + " | ".join(f"Δ FA/h {c}" if c in ("normal", "lookalikes") else f"Δ recall {c}"
                                               for c in cols) + " |",
                "|---" * (len(cols) + 1) + "|"]
        for n in names:
            if n not in paired:
                continue
            cells = []
            for c in cols:
                d = paired[n].get(c)
                if d is None:
                    cells.append("–")
                    continue
                digits = 1 if c in ("normal", "lookalikes") else 2
                cells.append(f"{d['delta']:+.{digits}f} [{d['ci95'][0]:+.{digits}f}, {d['ci95'][1]:+.{digits}f}]"
                             if d["ci95"] else f"{d['delta']:+.{digits}f}")
            out.append(f"| {CONFIGS[n]['label']} | " + " | ".join(cells) + " |")
    review_cfgs = [name for name in ("g_review", "h_tuned") if name in cfgs]
    if review_cfgs:
        out += ["", "### Fights sent for operator review", "",
                "In review mode a fight whose interaction check fails (and in (h) also one whose scores stay "
                "below the alarm threshold) is still reported, as PROBABLE "
                "(\"Possible fight \u2014 please check\", no pop-up). Those are not alerts in the tables above; "
                "this table counts them. Recall including review = clips with a fight alert or a fight sent "
                "for review. Deltas are paired against (b), the veto.", "",
                "| Configuration | Review alerts, normal | Review alerts, look-alikes | Fight recall (alerts) "
                "| Fight recall incl. review | \u0394 fight recall incl. review vs (b) "
                "| \u0394 FA/h normal incl. review vs (b) |",
                "|---|---|---|---|---|---|---|"]
    for review_cfg in review_cfgs:
        s = cfgs[review_cfg]["sets"]
        p = (results.get("paired_vs_full") or {}).get(review_cfg, {})

        def rv(set_name):
            r = s.get(set_name, {}).get("review_alerts")
            return f"{r['count']} = {fmt_ci(r['per_hour'], r['per_hour_ci95'])} / h" if r else "\u2013"

        def pd(set_name, digits):
            d = p.get(set_name)
            if not d or "delta_incl_review" not in d:
                return "\u2013"
            lo, hi = d["ci95_incl_review"] or (d["delta_incl_review"], d["delta_incl_review"])
            return f"{d['delta_incl_review']:+.{digits}f} [{lo:+.{digits}f}, {hi:+.{digits}f}]"

        f = s.get("fight")
        alerts = f"{f['detected']}/{f['clips']} = {fmt_ci(f['recall'], f['recall_ci95'], 2)}" if f else "\u2013"
        incl = (f"{f['detected_incl_review']}/{f['clips']} = "
                f"{fmt_ci(f['recall_incl_review'], f['recall_incl_review_ci95'], 2)}") if f else "\u2013"
        out.append(f"| {CONFIGS[review_cfg]['label']} | {rv('normal')} | {rv('lookalikes')} | {alerts} | {incl} "
                   f"| {pd('fight', 2)} | {pd('normal', 1)} |")
    speed = results.get("processing_speed")
    if speed:
        longest = results.get("longest_clip")
        out += ["", "Processing pace in (b), wall-clock seconds per second of video (1.0 = real time): "
                + ", ".join(f"{k} {v}" for k, v in speed.items())
                + ". Wall time includes each clip's detector start-up (about a second), which dominates on "
                  "the 5-s clips."
                + (f" The longest clip ({longest['set']}, {longest['seconds']} s) took {longest['wall_seconds']} s "
                   "of wall time." if longest else "")]
    out += ["", "Unusual-activity (anomaly) alarms raised while the genuine-event clips played (no labelled "
                "unusual-activity set exists in the proxy, so this is the only indication of what calibration "
                "costs in anomaly detections):", "",
            "| Configuration | " + " | ".join(event_sets) + " |", "|---" * (len(event_sets) + 1) + "|"]
    for n in names:
        s = cfgs[n]["sets"]
        out.append(f"| {CONFIGS[n]['label']} | " + " | ".join(
            str(s[e].get("dashboard_alarms_by_type", {}).get("anomaly", 0)) if e in s else "–" for e in event_sets) + " |")
    missing = [CONFIGS[n]["label"] for n in CONFIGS if n not in cfgs]
    out += ["", "Configurations:", ""]
    for n in names:
        o = CONFIGS[n]["overrides"]
        what = (f"code at `{CONFIGS[n]['ref']}`, its own thresholds.yaml" if CONFIGS[n].get("ref")
                else ", ".join(f"`{k}: {v}`" for k, v in o.items()) or "current thresholds.yaml")
        out.append(f"- {CONFIGS[n]['label']}: {what}.")
    if missing:
        out += ["", "Not run: " + ", ".join(missing) + "."]
    cal = results.get("calibration")
    if cal:
        out += ["", f"Scene-anomaly calibration used by the calibrated configurations: {cal['windows']} windows "
                    f"pooled from {cal['clips']} normal clips disjoint from the evaluation sets "
                    f"(fight-dataset validation split); 99th-percentile ratio {cal['observed_percentile_ratio']} "
                    f"→ camera threshold {cal['camera_scale']}× the model's."]
    out += ["", "Caveats: one run per configuration (the pipeline is timing-dependent, so a re-run can differ "
                "by an alert or a detection); clip-level recall counts a clip as detected if at least one "
                "dashboard alert of the right type was raised while it played; alerts of other types on "
                "event clips are not counted as false alarms."]
    if figure:
        out += ["", f"![Ablation: false alarms per hour and recall per configuration](figures/{figure})", "",
                "*Ablation: false alarms per hour (left) and recall (right) per configuration, 95% bootstrap CIs.*"]
    return "\n".join(out)


def report() -> None:
    results = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
               "generated_by": "perception-service/evaluation/ablation.py",
               "footage": "field recordings (perception-service/field_data)" if FIELD.exists()
               else "proxy clip sets (held-out/public clips in perception-service/data; field recordings unavailable)",
               "set_descriptions": {k: v[2] for k, v in SET_INFO.items()},
               "bootstrap": {"resamples": N_RESAMPLES, "unit": "clip", "interval": "percentile 95%"},
               "configs": {}}
    dates = set()
    for name, cfg in CONFIGS.items():
        rows = load_per_clip(name)
        if not rows:
            continue
        meta_path = PER_CLIP_DIR / f"{name}.meta.json"
        meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
        dates.add(meta.get("run_at", "")[:10])
        results["configs"][name] = {"label": cfg["label"], "ref": cfg.get("ref") or "HEAD",
                                    "overrides": cfg["overrides"], "calibrated": cfg["calibrated"],
                                    "run": meta, "sets": summarise(rows)}
    cal_path = PER_CLIP_DIR / "scene_anomaly_calibration.json"
    if cal_path.exists():
        cal = json.loads(cal_path.read_text(encoding="utf-8"))
        cal["clips"] = json.loads((PER_CLIP_DIR / "calibration_clips.json").read_text(encoding="utf-8")).__len__() \
            if (PER_CLIP_DIR / "calibration_clips.json").exists() else None
        results["calibration"] = cal
    results["run_dates"] = ", ".join(sorted(d for d in dates if d)) or "–"
    if not results["configs"]:
        raise SystemExit("no ablation runs found; run `python -m evaluation.ablation run` first")
    if "b_full" in results["configs"]:
        reference = load_per_clip("b_full")
        results["paired_vs_full"] = {n: paired_differences(reference, load_per_clip(n))
                                     for n in results["configs"] if n != "b_full"}
        results["processing_speed"] = processing_speed(reference)
        results["longest_clip"] = longest_clip(reference)
    figure = make_figure(results)
    (RESULTS_DIR / "ablation.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    text = markdown(results, figure)
    update_section("ablation", text)
    print(text)


def main() -> None:
    sys.stdout.reconfigure(errors="replace")  # Windows consoles cannot print every character in the tables
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("command", choices=["run", "report"])
    parser.add_argument("--configs", nargs="+", choices=list(CONFIGS), default=list(CONFIGS))
    parser.add_argument("--work", type=Path, help="scratch folder (kept; re-running resumes)")
    parser.add_argument("--limit", type=int, help="at most N clips per set (smoke testing)")
    args = parser.parse_args()
    if args.command == "report":
        report()
        return

    sets, cal_clips = field_sets() if FIELD.exists() else proxy_sets()
    work = args.work or Path(tempfile.mkdtemp(prefix="ablation_"))
    work.mkdir(parents=True, exist_ok=True)
    if args.limit:  # smoke test: keep everything out of docs/
        global PER_CLIP_DIR
        PER_CLIP_DIR = work / "per_clip"
        sets = {k: v[:args.limit] for k, v in sets.items()}
        cal_clips = cal_clips[:args.limit * 20]
    print(f"work folder: {work}")
    PER_CLIP_DIR.mkdir(parents=True, exist_ok=True)
    calibration = None
    if any(CONFIGS[c]["calibrated"] for c in args.configs) and cal_clips:
        calibration = calibrate(cal_clips, work)
        (PER_CLIP_DIR / "calibration_clips.json").write_text(
            json.dumps([rel(c) for c in cal_clips], indent=1), encoding="utf-8")
    for name in args.configs:
        started = datetime.now(timezone.utc)
        run_config(name, sets, calibration if CONFIGS[name]["calibrated"] else None, work)
        (PER_CLIP_DIR / f"{name}.meta.json").write_text(json.dumps({
            "run_at": started.isoformat(timespec="seconds"),
            "finished_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "code": CONFIGS[name].get("ref") or code_version(),
            "overrides": CONFIGS[name]["overrides"], "limit_per_set": args.limit,
        }, indent=2), encoding="utf-8")
        print(f"[{name}] done")
    if not args.limit:
        report()


if __name__ == "__main__":
    main()
