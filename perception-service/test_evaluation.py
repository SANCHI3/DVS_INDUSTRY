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
