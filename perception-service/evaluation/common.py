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
    """Replace one generated section of docs/RESULTS.md in place. Everything
    else in the file (the header, other sections, hand-written sections
    without markers) is kept as it is."""

    DOCS.mkdir(exist_ok=True)
    text = RESULTS_MD.read_text(encoding="utf-8") if RESULTS_MD.exists() else RESULTS_HEADER
    block = f"<!-- BEGIN:{name} -->\n{body.rstrip()}\n<!-- END:{name} -->"
    pattern = re.compile(rf"<!-- BEGIN:{name} -->\n.*?<!-- END:{name} -->", re.S)
    if pattern.search(text):
        text = pattern.sub(lambda _: block, text, count=1)
    else:
        # New section: before the first later section already in the file, else at the end
        later = [f"<!-- BEGIN:{key} -->" for key in SECTION_ORDER[SECTION_ORDER.index(name) + 1:]]
        positions = [text.find(marker) for marker in later if marker in text]
        if positions:
            at = min(positions)
            text = text[:at] + block + "\n\n" + text[at:]
        else:
            text = text.rstrip("\n") + "\n\n" + block + "\n"
    RESULTS_MD.write_text(text, encoding="utf-8")


def fmt(value, digits: int = 2) -> str:
    if value is None:
        return "–"
    if isinstance(value, float):
        return f"{value:.{digits}f}"
    return str(value)
