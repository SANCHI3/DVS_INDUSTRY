"""The results collector only reports numbers found in models/*.json.

    python -m pytest test_evaluation.py
"""
from __future__ import annotations

from evaluation import run_all


def test_every_row_has_a_source_and_consistent_counts():
    rows = run_all.collect()  # asserts precision/recall match the stored counts
    assert rows
    for r in rows:
        assert (run_all.MODELS / r["source"].split()[0]).exists()
        assert r["role"] in {"final", "baseline", "alternative"}
    # one deployed ("final") model per comparison pair
    for task, baseline, final in run_all.PAIRS:
        assert run_all._find(rows, task, baseline)["role"] == "baseline"
        assert run_all._find(rows, task, final)["role"] == "final"


def test_section_update_keeps_other_sections(tmp_path, monkeypatch):
    from evaluation import common

    monkeypatch.setattr(common, "DOCS", tmp_path)
    monkeypatch.setattr(common, "RESULTS_MD", tmp_path / "RESULTS.md")
    common.update_section("benchmark", "B1")
    common.update_section("models", "M1")
    common.update_section("benchmark", "B2")
    text = (tmp_path / "RESULTS.md").read_text(encoding="utf-8")
    assert "M1" in text and "B2" in text and "B1" not in text
    assert text.index("BEGIN:models") < text.index("BEGIN:benchmark")


def test_bootstrap_ci_is_reproducible_and_brackets_the_estimate():
    import numpy as np
    from evaluation.stats import bootstrap_ci

    hits = np.array([1] * 30 + [0] * 10)
    stat = lambda idx: float(hits[idx].mean())  # noqa: E731
    lo, hi = bootstrap_ci(len(hits), stat)
    assert lo < 0.75 < hi and 0 <= lo and hi <= 1
    assert bootstrap_ci(len(hits), stat) == [lo, hi]          # fixed seed
    assert bootstrap_ci(5, lambda idx: None) is None          # undefined everywhere


def test_auc_and_classification_cis_match_counts():
    from evaluation.stats import classification_cis, roc_auc
    import numpy as np

    y = np.array([1, 1, 1, 0, 0, 0])
    assert roc_auc(y, np.array([0.9, 0.8, 0.7, 0.3, 0.2, 0.1])) == 1.0
    assert roc_auc(y, np.array([0.5] * 6)) == 0.5             # ties count one half
    out = classification_cis(y, [1, 1, 0, 1, 0, 0], [0.9, 0.8, 0.4, 0.6, 0.2, 0.1])
    assert (out["tp"], out["fp"], out["fn"], out["tn"]) == (2, 1, 1, 2)
    assert abs(out["precision"] - 2 / 3) < 1e-9 and out["auc_ci95"] is not None


def test_mcnemar_exact():
    from evaluation.stats import mcnemar

    same = mcnemar([True, False, True], [True, False, True])
    assert same["discordant"] == 0 and same["p_value_exact"] == 1.0
    # 10 videos only model B gets right, 0 the other way: p = 2 * 0.5**10
    t = mcnemar([False] * 10 + [True] * 5, [True] * 15)
    assert t["b_only_correct"] == 10 and abs(t["p_value_exact"] - 2 * 0.5 ** 10) < 1e-12


def test_confidence_intervals_only_where_per_video_predictions_exist():
    rows = run_all.collect()
    tests = run_all.add_confidence_intervals(rows)  # asserts recomputed counts == stored counts
    with_ci = {(r["task"], r["model"]) for r in rows if r["ci95"]}
    assert ("Unusual activity", "Autoencoder v2 (deployed)") in with_ci
    assert not any(task in ("Fight", "Fall") for task, _ in with_ci)
    assert "skipped" in tests["fight_v1_vs_v2"]


def test_ablation_overrides_and_summary():
    from evaluation.ablation import summarise
    from evaluation.ablation_worker import set_dotted

    cfg = {"fight_detection": {"interaction": {"enabled": True}}}
    set_dotted(cfg, "fight_detection.interaction.enabled", False)
    set_dotted(cfg, "confirmation.default.probable_hits", 1)
    assert cfg["fight_detection"]["interaction"]["enabled"] is False
    assert cfg["confirmation"]["default"]["probable_hits"] == 1

    alarm = {"event_type": "fight", "tier": "CONFIRMED", "dashboard": True}
    review = {"event_type": "fight", "tier": "PROBABLE", "dashboard": False}
    rows = [{"set": "normal", "minutes": 30.0, "incidents": [alarm, review]},
            {"set": "normal", "minutes": 30.0, "incidents": []},
            {"set": "fight", "minutes": 0.1, "incidents": [alarm]},
            {"set": "fight", "minutes": 0.1, "incidents": [review]}]
    out = summarise(rows)
    assert out["normal"]["false_alarms"]["total"]["count"] == 1      # PROBABLE-only is not an alarm
    assert out["normal"]["false_alarms"]["total"]["per_hour"] == 1.0
    assert out["fight"]["detected"] == 1 and out["fight"]["recall"] == 0.5
