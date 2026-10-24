"""Collect every model metrics file into one results table, charts and JSON.

    cd perception-service
    python -m evaluation.run_all

Reads perception-service/models/*.json only. Every number in the output is
copied from those files (precision/recall/F1 are recomputed from the stored
confusion counts only as a consistency check). Outputs:

    docs/RESULTS.md                      section "models"
    docs/results/model_results.json      served to the dashboard's AI Models page
    docs/figures/model_scores.png        final model per task: precision / recall / F1
    docs/figures/baseline_vs_final.png   F1 and false alarms, baseline vs final
    docs/figures/confusion_matrices.png  final models (and fight v1) where counts exist

Rows whose per-video predictions are stored in the repository also get
bootstrap 95% confidence intervals (1000 resamples over test videos, see
evaluation/stats.py). The recomputed confusion counts must equal the stored
ones. Rows without stored per-video predictions get no interval: they are
listed, not approximated. McNemar's test needs paired per-video predictions of
both models on the same videos, so it is run only where both are stored.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import csv

from evaluation.common import FIGURES, RESULTS_DIR, SERVICE_ROOT, fmt, update_section
from evaluation.stats import N_RESAMPLES, classification_cis, mcnemar

MODELS = SERVICE_ROOT / "models"

# Files that exist but are not results: logged here so nothing is silently skipped.
EXCLUDED = {
    "fight_r3d18_smoke.metrics.json": "pipeline smoke test on 10 clips, not an evaluation",
    "fight_r3d18_unfreeze_smoke.metrics.json": "pipeline smoke test on 10 clips, not an evaluation",
    "fight_r3d18_v1_baseline.metrics.json": "identical copy of fight_r3d18_v1.metrics.json",
    "fight_lstm_baseline_v1.metrics.json": "identical copy of fight_lstm.metrics.json",
    "fight_lstm_v1_window_model.metrics.json": "identical copy of fight_lstm.metrics.json",
    "fight_lstm_v2_baseline.metrics.json": "identical copy of fight_lstm_v2.metrics.json",
    "fire_smoke_video_eval_baseline.summary.json":
        "same YOLO-only evaluation as the verifier file's yolo_only rows (identical counts)",
    "scene_anomaly_ae_v3_factory.metrics.json":
        "factory-footage model, reported in section 7 by anomaly.train_factory (different protocol)",
}


def load(name: str) -> dict:
    return json.loads((MODELS / name).read_text(encoding="utf-8"))


def counts(d: dict) -> dict:
    """Normalise tp/fp/fn/tn (files use both lower and upper case)."""
    get = lambda k: d.get(k, d.get(k.upper()))  # noqa: E731
    return {k: get(k) for k in ("tp", "fp", "fn", "tn")}


def row(task, model, role, protocol, source, metrics, auc=None, note=""):
    c = counts(metrics)
    n = sum(v for v in c.values()) if all(v is not None for v in c.values()) else None
    r = {
        "task": task, "model": model, "role": role, "protocol": protocol,
        "test_size": n, "precision": metrics.get("precision"), "recall": metrics.get("recall"),
        "f1": metrics.get("f1"), "auc": auc, "false_alarms": c["fp"], **c,
        "source": source, "note": note,
    }
    # consistency check: stored precision/recall must match stored counts
    if n:
        tp, fp, fn = c["tp"], c["fp"], c["fn"]
        if tp + fp and r["precision"] is not None:
            assert abs(tp / (tp + fp) - r["precision"]) < 0.002, (source, "precision mismatch")
        if tp + fn and r["recall"] is not None:
            assert abs(tp / (tp + fn) - r["recall"]) < 0.002, (source, "recall mismatch")
    return r


def collect() -> list[dict]:
    rows = []

    # ── Fight ──────────────────────────────────────────────────────────────
    rt = load("fight_r3d18_v2.runtime.json")
    proto = (f"test split, live rule: {rt['protocol']['clips_per_video']} clips/video, "
             f"{rt['protocol']['rule']}")
    src = "fight_r3d18_v2.runtime.json"
    rows.append(row("Fight", "R3D-18 v1", "baseline", proto, src + " compared_with.test_live_rule",
                    rt["compared_with"]["test_live_rule"], rt["compared_with"]["test_mean_of_clips_auc"]))
    rows.append(row("Fight", "R3D-18 v2 (deployed)", "final", proto, src + " model.test_live_rule",
                    rt["model"]["test_live_rule"], rt["model"]["test_mean_of_clips_auc"]))
    v1, v2 = load("fight_r3d18_v1.metrics.json"), load("fight_r3d18_v2.metrics.json")
    rows.append(row("Fight", "R3D-18 v1, single clip", "baseline", "test split, one clip per video",
                    "fight_r3d18_v1.metrics.json test", v1["test"]))
    rows.append(row("Fight", "R3D-18 v2, 3-clip mean", "final", "test split, mean of 3 clips per video",
                    "fight_r3d18_v2.metrics.json test", v2["test"], v2["test"].get("auc")))
    lstm, lstm2 = load("fight_lstm.metrics.json"), load("fight_lstm_v2.metrics.json")
    rows.append(row("Fight", "Pose-LSTM v1 (not deployed)", "alternative", "test split of pose windows",
                    "fight_lstm.metrics.json test", lstm["test"],
                    note="different test set (pose windows); not deployed, code removed"))
    rows.append(row("Fight", "Pose-LSTM v2", "alternative", "test split of pose windows",
                    "fight_lstm_v2.metrics.json test", lstm2["test"],
                    note="different test set (pose windows); not deployed, code removed"))

    # ── Fall ───────────────────────────────────────────────────────────────
    gru, rf = load("fall_gru_v1.metrics.json"), load("fall_rf_v1.metrics.json")
    proto = f"{gru['data']['videos']} videos, {gru['evaluation']}"
    rows.append(row("Fall", "Box rule, as deployed (5 s still)", "baseline", proto,
                    "fall_gru_v1.metrics.json rule_baseline_deployed_5s", gru["rule_baseline_deployed_5s"]))
    rows.append(row("Fall", "Box rule, relaxed (1 s)", "baseline", proto,
                    "fall_gru_v1.metrics.json rule_baseline_relaxed_1s", gru["rule_baseline_relaxed_1s"],
                    note="generous version: omits the rule's 8-px stillness check"))
    rows.append(row("Fall", "Pose + BiGRU (deployed)", "final", proto,
                    "fall_gru_v1.metrics.json pose_gru_model", gru["pose_gru_model"], gru["pose_gru_model"]["auc"]))
    for key, label in [("random_forest", "Pose features + Random Forest"),
                       ("gradient_boosting", "Pose features + Gradient Boosting"),
                       ("logistic_regression", "Pose features + Logistic Regression")]:
        m = rf["models"][key]
        rows.append(row("Fall", label, "alternative", proto, f"fall_rf_v1.metrics.json models.{key}",
                        m["video_metrics"], m["video_roc_auc"]))
    rows.append(row("Fall", "Physics score (no training)", "alternative", proto,
                    "fall_rf_v1.metrics.json baselines['physics_score (no training)']",
                    rf["baselines"]["physics_score (no training)"]))

    # ── Fire / smoke ───────────────────────────────────────────────────────
    ver = load("fire_smoke_verifier_v1.metrics.json")
    for cls in ("fire", "smoke"):
        n = ver[cls]["yolo_only"]["videos"]
        proto = f"FIRESENSE {cls} videos ({n}), {ver['evaluation']}"
        rows.append(row(cls.capitalize(), f"YOLOv8n {cls} only", "baseline", proto,
                        f"fire_smoke_verifier_v1.metrics.json {cls}.yolo_only", ver[cls]["yolo_only"]))
        rows.append(row(cls.capitalize(), f"YOLOv8n + learned verifier (deployed)", "final", proto,
                        f"fire_smoke_verifier_v1.metrics.json {cls}.yolo_plus_verifier",
                        ver[cls]["yolo_plus_verifier"]))
    rej = load("fire_smoke_calibration_v2.rejected.summary.json")
    for cls in ("fire", "smoke"):
        rows.append(row(cls.capitalize(), f"YOLOv8n, stricter thresholds (rejected)", "alternative",
                        f"FIRESENSE {cls} videos ({rej[cls]['videos']})",
                        f"fire_smoke_calibration_v2.rejected.summary.json {cls}", rej[cls],
                        note=f"fire {rej['configuration']['fire_threshold']} / smoke "
                             f"{rej['configuration']['smoke_threshold']}: lost recall, so not adopted"))

    # ── Unusual activity (unsupervised) ────────────────────────────────────
    for name, label, role, note in [
        ("scene_anomaly_ae_v1.metrics.json", "Autoencoder v1", "baseline",
         "split by file (camera angles of one event could leak); 40 abnormal test videos"),
        ("scene_anomaly_ae_v2.metrics.json", "Autoencoder v2 (deployed)", "final",
         "split by event; 79 abnormal test videos"),
    ]:
        m = load(name)
        rows.append(row("Unusual activity", label, role,
                        f"unseen normal + fall videos, {m['video_level']['rule']}",
                        f"{name} video_level", m["video_level"], m["video_level"]["roc_auc"], note=note))
    return rows


def per_video_predictions() -> dict:
    """(task, model) -> per-video labels, predictions and scores stored in the repo."""
    out = {}
    for name, model in [("scene_anomaly_ae_v1.per_video.json", "Autoencoder v1"),
                        ("scene_anomaly_ae_v2.per_video.json", "Autoencoder v2 (deployed)")]:
        items = load(name)
        out[("Unusual activity", model)] = {
            "source": name, "y": [int(i["label"]) for i in items], "pred": [int(bool(i["alert"])) for i in items],
            "score": [float(i["score"]) for i in items]}
    with (MODELS / "fire_smoke_video_eval_baseline.results.csv").open(encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    for cls in ("fire", "smoke"):
        items = [r for r in rows if r["target"] == cls]
        out[(cls.capitalize(), f"YOLOv8n {cls} only")] = {
            "source": "fire_smoke_video_eval_baseline.results.csv", "y": [int(r["expected_positive"]) for r in items],
            "pred": [int(r["confirmed"]) for r in items], "score": None}
    return out


NO_PER_VIDEO = {  # why a row has no interval, by task or model
    "Fight": "the metrics files store only aggregate confusion counts, no per-video predictions",
    "Fall": "only aggregate out-of-fold counts are stored",
    "YOLOv8n + learned verifier (deployed)": "only aggregate leave-one-video-out counts are stored",
    "YOLOv8n, stricter thresholds (rejected)": "per-video lines exist only in an untracked local log, not in the repo",
}


def add_confidence_intervals(rows: list[dict]) -> dict:
    stored = per_video_predictions()
    for r in rows:
        data = stored.get((r["task"], r["model"]))
        if data is None:
            r["ci95"] = None
            r["ci_note"] = (NO_PER_VIDEO.get(r["model"]) or NO_PER_VIDEO.get(r["task"])
                            or "only aggregate counts are stored")
            continue
        cis = classification_cis(data["y"], data["pred"], data["score"])
        for k in ("tp", "fp", "fn", "tn"):
            assert cis[k] == r[k], (data["source"], k, cis[k], r[k], "per-video predictions disagree with counts")
        if data["score"] is not None and r["auc"] is not None:
            assert abs(cis["auc"] - r["auc"]) < 0.002, (data["source"], "AUC mismatch", cis["auc"], r["auc"])
        r["ci95"] = {k: cis[f"{k}_ci95"] for k in ("precision", "recall", "f1", "auc") if f"{k}_ci95" in cis}
        r["ci_source"] = data["source"]
    # McNemar needs paired per-video predictions of both models on the same videos.
    tests = {}
    fight = ("Fight", "R3D-18 v1"), ("Fight", "R3D-18 v2 (deployed)")
    if all(k in stored for k in fight):
        a, b = stored[fight[0]], stored[fight[1]]
        tests["fight_v1_vs_v2"] = mcnemar([p == y for p, y in zip(a["pred"], a["y"])],
                                          [p == y for p, y in zip(b["pred"], b["y"])])
    else:
        tests["fight_v1_vs_v2"] = {"skipped": "per-video predictions of R3D-18 v1 and v2 are not stored "
                                              "(only confusion counts), so the paired test cannot be computed"}
    ae = stored[("Unusual activity", "Autoencoder v1")], stored[("Unusual activity", "Autoencoder v2 (deployed)")]
    tests["autoencoder_v1_vs_v2"] = {"skipped": f"v1 and v2 were tested on different video sets ({len(ae[0]['y'])} "
                                                f"vs {len(ae[1]['y'])} videos, split by file vs by event), "
                                                "so their predictions are not paired"}
    return tests


SHORT = {  # chart labels only
    "R3D-18 v1": "R3D-18 v1", "R3D-18 v2 (deployed)": "R3D-18 v2",
    "Box rule, relaxed (1 s)": "box rule (1 s)", "Pose + BiGRU (deployed)": "pose + BiGRU",
    "YOLOv8n fire only": "YOLO only", "YOLOv8n smoke only": "YOLO only",
    "YOLOv8n + learned verifier (deployed)": "YOLO + verifier",
    "Autoencoder v1": "AE v1", "Autoencoder v2 (deployed)": "AE v2",
}

PAIRS = [  # (task, baseline model, final model) for the comparison chart
    ("Fight", "R3D-18 v1", "R3D-18 v2 (deployed)"),
    ("Fall", "Box rule, relaxed (1 s)", "Pose + BiGRU (deployed)"),
    ("Fire", "YOLOv8n fire only", "YOLOv8n + learned verifier (deployed)"),
    ("Smoke", "YOLOv8n smoke only", "YOLOv8n + learned verifier (deployed)"),
    ("Unusual activity", "Autoencoder v1", "Autoencoder v2 (deployed)"),
]
FINAL_FOR_CHART = [p[2] for p in PAIRS]

# Reference palette (dataviz skill): first three categorical slots, light mode.
BLUE, ORANGE, AQUA = "#2a78d6", "#eb6834", "#1baf7a"
INK, INK2, GRID = "#0b0b0b", "#52514e", "#e4e3df"


def _find(rows, task, model):
    return next(r for r in rows if r["task"] == task and r["model"] == model)


def _style(ax):
    ax.spines[["top", "right"]].set_visible(False)
    ax.spines[["left", "bottom"]].set_color(GRID)
    ax.tick_params(colors=INK2, labelsize=9)
    ax.yaxis.grid(True, color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)


def make_figures(rows: list[dict]) -> list[str]:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np

    FIGURES.mkdir(parents=True, exist_ok=True)
    written = []

    # 1. final model per task: precision / recall / F1
    finals = [_find(rows, t, m) for t, _, m in PAIRS]
    labels = [f"{r['task']}\n{r['model'].replace(' (deployed)', '')}" for r in finals]
    x = np.arange(len(finals))
    fig, ax = plt.subplots(figsize=(10, 4.6), dpi=150)
    for i, (key, color) in enumerate([("precision", BLUE), ("recall", ORANGE), ("f1", AQUA)]):
        vals = [r[key] for r in finals]
        bars = ax.bar(x + (i - 1) * 0.26, vals, 0.24, color=color, label=key.capitalize() if key != "f1" else "F1",
                      edgecolor="white", linewidth=1)
        if key == "f1":
            for b, v in zip(bars, vals):
                ax.text(b.get_x() + b.get_width() / 2, v + 0.015, f"{v:.2f}", ha="center", fontsize=8, color=INK)
    ax.set_xticks(x, labels, fontsize=8.5)
    ax.set_ylim(0, 1.2)
    ax.set_ylabel("score", color=INK2)
    ax.set_title("Deployed model per task (test data; protocols differ per task, see RESULTS.md)",
                 fontsize=10.5, color=INK, loc="left")
    ax.legend(frameon=False, ncol=3, loc="upper left", fontsize=9)
    _style(ax)
    fig.tight_layout()
    fig.savefig(FIGURES / "model_scores.png")
    plt.close(fig)
    written.append("model_scores.png")

    # 2. baseline vs final: F1 (bars) and false alarms (annotation)
    fig, ax = plt.subplots(figsize=(10, 4.6), dpi=150)
    x = np.arange(len(PAIRS))
    for i, (which, color, name) in enumerate([(1, BLUE, "Baseline"), (2, ORANGE, "Final (deployed)")]):
        rs = [_find(rows, p[0], p[which]) for p in PAIRS]
        bars = ax.bar(x + (i - 0.5) * 0.36, [r["f1"] for r in rs], 0.34, color=color, label=name,
                      edgecolor="white", linewidth=1)
        for b, r in zip(bars, rs):
            ax.text(b.get_x() + b.get_width() / 2, r["f1"] + 0.015,
                    f"{r['f1']:.2f}\n{r['false_alarms']} FA", ha="center", fontsize=7.5, color=INK)
    ax.set_xticks(x, [f"{p[0]}\n{SHORT[p[1]]} →\n{SHORT[p[2]]}" for p in PAIRS], fontsize=8.5)
    ax.set_ylim(0, 1.25)
    ax.set_ylabel("F1", color=INK2)
    ax.set_title("Baseline vs final model: F1 (FA = false alarms on the same test videos)",
                 fontsize=10.5, color=INK, loc="left")
    ax.legend(frameon=False, ncol=2, loc="upper left", fontsize=9)
    _style(ax)
    fig.tight_layout()
    fig.savefig(FIGURES / "baseline_vs_final.png")
    plt.close(fig)
    written.append("baseline_vs_final.png")

    # 3. confusion matrices (rows with all four counts)
    cms = [_find(rows, "Fight", "R3D-18 v1")] + finals
    fig, axes = plt.subplots(2, 3, figsize=(10, 6.6), dpi=150)
    for ax, r in zip(axes.flat, cms):
        m = np.array([[r["tp"], r["fn"]], [r["fp"], r["tn"]]])
        ax.imshow(m, cmap="Blues", vmin=0, vmax=m.max() * 1.25)
        for (i, j), v in np.ndenumerate(m):
            ax.text(j, i, str(v), ha="center", va="center", fontsize=12,
                    color="white" if v > m.max() * 0.6 else INK)
        ax.set_xticks([0, 1], ["pred. event", "pred. normal"], fontsize=8)
        ax.set_yticks([0, 1], ["event", "normal"], fontsize=8)
        ax.set_title(f"{r['task']}: {r['model']}\n(n = {r['test_size']})", fontsize=8.5, color=INK)
    for ax in axes.flat[len(cms):]:
        ax.axis("off")
    fig.suptitle("Confusion matrices (rows = true class)", fontsize=10.5, color=INK, x=0.02, ha="left")
    fig.tight_layout()
    fig.savefig(FIGURES / "confusion_matrices.png")
    plt.close(fig)
    written.append("confusion_matrices.png")
    return written


def ci_markdown(rows: list[dict], tests: dict) -> list[str]:
    def c(v, ci):
        return f"{v:.2f} [{ci[0]:.2f}, {ci[1]:.2f}]" if v is not None and ci else fmt(v)
    out = ["### Bootstrap 95% confidence intervals", "",
           f"Percentile bootstrap, {N_RESAMPLES} resamples over test videos, fixed seed "
           "(`evaluation/stats.py`). Only rows whose per-video predictions are stored in the repository "
           "can be resampled; the recomputed confusion counts equal the stored ones.", "",
           "| Task | Model | n | Precision | Recall | F1 | AUC | Per-video source |", "|---|---|---|---|---|---|---|---|"]
    for r in rows:
        if r.get("ci95"):
            ci = r["ci95"]
            out.append(f"| {r['task']} | {r['model']} | {r['test_size']} | {c(r['precision'], ci.get('precision'))} | "
                       f"{c(r['recall'], ci.get('recall'))} | {c(r['f1'], ci.get('f1'))} | "
                       f"{c(r['auc'], ci.get('auc'))} | `{r['ci_source']}` |")
    out += ["", "No interval (per-video predictions not stored; not approximated):", ""]
    for r in rows:
        if not r.get("ci95"):
            out.append(f"- {r['task']} / {r['model']}: {r['ci_note']}.")
    out += ["", "Paired significance tests (exact McNemar):", ""]
    for name, t in tests.items():
        if "skipped" in t:
            out.append(f"- {name}: not computed: {t['skipped']}.")
        else:
            out.append(f"- {name}: discordant pairs {t['discordant']} ({t['a_only_correct']} / "
                       f"{t['b_only_correct']}), p = {t['p_value_exact']:.4f}.")
    return out


def markdown(rows: list[dict], figures: list[str], tests: dict | None = None) -> str:
    out = ["## 1. Model metrics", "",
           "Generated by `python -m evaluation.run_all` from `perception-service/models/*.json`.",
           "**Role:** *final* = the model the live pipeline uses; *baseline* = what it replaced or is "
           "compared against; *alternative* = evaluated but not deployed. Test-set size is the number "
           "of test videos (or pose windows for the pose-LSTM). False alarms = false positives on that "
           "test set. Protocols differ per task, so compare rows only within a task.", ""]
    head = "| Task | Model | Role | Precision | Recall | F1 | AUC | False alarms | Test size | Protocol |"
    out += [head, "|" + "---|" * 10]
    for r in rows:
        out.append(f"| {r['task']} | {r['model']} | {r['role']} | {fmt(r['precision'])} | {fmt(r['recall'])} | "
                   f"{fmt(r['f1'])} | {fmt(r['auc'])} | {fmt(r['false_alarms'])} | {fmt(r['test_size'])} | "
                   f"{r['protocol']} |")
    out += ["", "Notes:", ""]
    for r in rows:
        if r["note"]:
            out.append(f"- {r['task']} / {r['model']}: {r['note']}.")
    out += ["- AUC is left blank where the file stores none (rules, thresholded baselines).",
            "- Fire/smoke rows are video-level detection with YOLO persistence (3 of 5 sampled frames); "
            "the YOLOv8n detector's own image-level confusion matrix is "
            "`perception-service/models/fire_smoke_yolov8n_v1.confusion_matrix.png`.", "",
            "Source of every row (file and key):", ""]
    for r in rows:
        out.append(f"- {r['task']} / {r['model']}: `{r['source']}`")
    out += ["", "Files not used:", ""]
    for name, why in EXCLUDED.items():
        out.append(f"- `{name}`: {why}")
    if tests is not None:
        out += [""] + ci_markdown(rows, tests)
    out += ["", "### Figures", ""]
    captions = {
        "model_scores.png": "Deployed model per task: precision, recall and F1.",
        "baseline_vs_final.png": "Baseline vs final model: F1 and false alarms.",
        "confusion_matrices.png": "Confusion matrices of the final models (and fight v1).",
    }
    for f in figures:
        out += [f"![{captions[f]}](figures/{f})", "", f"*{captions[f]}*", ""]
    return "\n".join(out)


def main() -> None:
    rows = collect()
    used = {r["source"].split()[0] for r in rows}
    unaccounted = sorted(p.name for p in MODELS.glob("*.json")
                         if p.name not in used and p.name not in EXCLUDED and "per_video" not in p.name)
    if unaccounted:
        raise SystemExit(f"metrics files neither used nor excluded: {unaccounted}")
    tests = add_confidence_intervals(rows)
    figures = make_figures(rows)
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    (RESULTS_DIR / "model_results.json").write_text(json.dumps({
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "generated_by": "perception-service/evaluation/run_all.py",
        "rows": rows,
        "comparisons": [{"task": t, "baseline": b, "final": f} for t, b, f in PAIRS],
        "bootstrap": {"resamples": N_RESAMPLES, "unit": "test video", "interval": "percentile 95%"},
        "significance_tests": tests,
        "excluded_files": EXCLUDED,
    }, indent=2), encoding="utf-8")
    update_section("models", markdown(rows, figures, tests))
    print(f"{len(rows)} result rows -> docs/RESULTS.md, docs/results/model_results.json")
    print("figures:", ", ".join(f"docs/figures/{f}" for f in figures))


if __name__ == "__main__":
    main()
