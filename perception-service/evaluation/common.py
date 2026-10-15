"""Shared helpers for the evaluation scripts (paths and RESULTS.md sections)."""
from __future__ import annotations

import re
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SERVICE_ROOT.parent
DOCS = REPO_ROOT / "docs"
RESULTS_MD = DOCS / "RESULTS.md"
RESULTS_DIR = DOCS / "results"
FIGURES = DOCS / "figures"

RESULTS_HEADER = """# Results

All numbers on this page are produced by scripts in
`perception-service/evaluation/` from files in the repository. None are typed
in by hand. Re-generate with:

```bash
cd perception-service
python -m evaluation.run_all              # model metrics, charts, model_results.json
python -m evaluation.false_alarms ...     # false alarms per hour on normal footage
python -m evaluation.benchmark ...        # FPS and per-stage latency
python -m evaluation.ablation run         # ablation of the verification stages (hours)
python -m evaluation.interaction_separation  # fight interaction-check thresholds
```
"""

SECTION_ORDER = ["models", "false_alarms", "benchmark", "ablation", "interaction"]


def update_section(name: str, body: str) -> None:
    """Replace one generated section of docs/RESULTS.md, keeping the others."""

    DOCS.mkdir(exist_ok=True)
    text = RESULTS_MD.read_text(encoding="utf-8") if RESULTS_MD.exists() else RESULTS_HEADER
    sections = {}
    for key in SECTION_ORDER:
        match = re.search(rf"<!-- BEGIN:{key} -->\n(.*?)<!-- END:{key} -->", text, re.S)
        if match:
            sections[key] = match.group(1)
    sections[name] = body.rstrip() + "\n"
    out = RESULTS_HEADER
    for key in SECTION_ORDER:
        if key in sections:
            out += f"\n<!-- BEGIN:{key} -->\n{sections[key]}<!-- END:{key} -->\n"
    RESULTS_MD.write_text(out, encoding="utf-8")


def fmt(value, digits: int = 2) -> str:
    if value is None:
        return "–"
    if isinstance(value, float):
        return f"{value:.{digits}f}"
    return str(value)
