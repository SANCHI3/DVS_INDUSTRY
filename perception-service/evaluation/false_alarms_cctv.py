"""False alarms per hour on real factory footage, per camera and per type.

    cd perception-service
    python -m evaluation.false_alarms_cctv recordings/              # recordings/chN/*.mp4
    python -m evaluation.false_alarms_cctv recordings/ --night recordings_night/
    python -m evaluation.false_alarms_cctv recordings/ --no-write   # print only

Footage must be NORMAL work (no real fights, falls, fires): every incident it
raises is a false alarm. Each channel folder is played through the current
pipeline with that camera's settings from config/cameras.yaml, twice:

  * with zones + cooldown    (what runs in the factory)
  * without zones + cooldown (--no-zones --no-cooldown: the Phase 4 baseline)

in real time (the detectors use wall-clock time), headless, nothing sent to
the website. Counts "website" incidents (CONFIRMED, or escalated to it) and
cooldown repeats. Writes docs/evaluation/false_alarms_real_cctv.md.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT.parent / "docs" / "evaluation" / "false_alarms_real_cctv.md"
QUIET_ENV = {"DASHBOARD_BACKEND_URL": "", "DASHBOARD_API_TOKEN": "", "DASHBOARD_SERVICE_EMAIL": "",
             "LLM_API_KEY": "", "LEGACY_INCIDENT_API_URL": ""}
VIDEO_EXT = {".mp4", ".avi", ".mkv", ".mov"}


def video_hours(path: Path) -> float:
    cap = cv2.VideoCapture(str(path))
    frames, fps = cap.get(cv2.CAP_PROP_FRAME_COUNT), cap.get(cv2.CAP_PROP_FPS)
    cap.release()
    return frames / fps / 3600 if fps and frames > 0 else 0.0


def channel_folders(root: Path) -> dict[int, list[Path]]:
    out: dict[int, list[Path]] = {}
    for folder in sorted(p for p in root.iterdir() if p.is_dir() and p.name.lower().startswith("ch")):
        try:
            ch = int(folder.name[2:])
        except ValueError:
            continue
        files = sorted(f for f in folder.iterdir() if f.suffix.lower() in VIDEO_EXT)
        if files:
            out[ch] = files
    return out


def count_incidents(output_dir: Path) -> tuple[Counter, int]:
    """Website-visible incidents by type, and cooldown repeats."""
    reports, escalated, repeats = {}, set(), 0
    inc = output_dir / "incidents.jsonl"
    upd = output_dir / "incident_updates.jsonl"
    if inc.exists():
        for line in inc.read_text(encoding="utf-8").splitlines():
            if line.strip():
                r = json.loads(line)
                reports[r["incident_id"]] = r
    if upd.exists():
        for line in upd.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            u = json.loads(line)
            if u.get("repeat"):
                repeats += 1
            if str(u.get("confidence_tier", "")).upper() == "CONFIRMED":
                escalated.add(u["incident_id"])
    shown = Counter(r["event_type"] for i, r in reports.items()
                    if str(r.get("confidence_tier")).upper() == "CONFIRMED" or i in escalated)
    return shown, repeats


def run_files(camera_id: str, files: list[Path], baseline: bool) -> tuple[Counter, int]:
    total, repeats = Counter(), 0
    for f in files:
        with tempfile.TemporaryDirectory(prefix="dvs-fa-") as tmp:
            cmd = [sys.executable, str(ROOT / "main.py"), "--camera", camera_id, "--source", str(f),
                   "--no-display", "--output-dir", tmp]
            if baseline:
                cmd += ["--no-zones", "--no-cooldown"]
            subprocess.run(cmd, cwd=ROOT, env={**os.environ, **QUIET_ENV},
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
            shown, rep = count_incidents(Path(tmp))
            total += shown
            repeats += rep
    return total, repeats


def per_hour(n: float, hours: float) -> str:
    return f"{n / hours:.2f}" if hours > 0 else "-"


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("day", type=Path, help="folder with chN/ subfolders of normal daytime footage")
    parser.add_argument("--night", type=Path, help="the same for night (infrared) footage")
    parser.add_argument("--no-write", action="store_true")
    args = parser.parse_args(argv)

    rows = []
    for label, root in (("day", args.day), ("night", args.night)):
        if root is None:
            continue
        for ch, files in channel_folders(root).items():
            hours = sum(video_hours(f) for f in files)
            print(f"{label} ch{ch}: {len(files)} file(s), {hours:.2f} h - running (real time, twice)…", flush=True)
            after, repeats = run_files(f"dvr-ch{ch}", files, baseline=False)
            before, _ = run_files(f"dvr-ch{ch}", files, baseline=True)
            rows.append((label, ch, hours, before, after, repeats))

    lines = ["# False alarms on real factory footage", "",
             f"Generated {datetime.now():%d %b %Y %H:%M} by `python -m evaluation.false_alarms_cctv`.",
             "Footage: normal work only, so every incident is a false alarm. Counts are incidents staff",
             "would see on the website, per hour of footage. Before = without zones and cooldown.", "",
             "| Time | Camera | Hours | Before (per h) | After (per h) | By type (after) | Cooldown repeats |",
             "|---|---|---|---|---|---|---|"]
    for label, ch, hours, before, after, repeats in rows:
        types = ", ".join(f"{t} {n}" for t, n in sorted(after.items())) or "none"
        lines.append(f"| {label} | ch{ch} | {hours:.2f} | {per_hour(sum(before.values()), hours)} | "
                     f"{per_hour(sum(after.values()), hours)} | {types} | {repeats} |")
    totals = defaultdict(float)
    for label, _, hours, before, after, _ in rows:
        totals[(label, "h")] += hours
        totals[(label, "b")] += sum(before.values())
        totals[(label, "a")] += sum(after.values())
    for label in ("day", "night"):
        if totals[(label, "h")]:
            lines.append(f"| **{label} total** | | {totals[(label, 'h')]:.2f} | "
                         f"{per_hour(totals[(label, 'b')], totals[(label, 'h')])} | "
                         f"{per_hour(totals[(label, 'a')], totals[(label, 'h')])} | | |")
    text = "\n".join(lines) + "\n"
    print(text)
    if not args.no_write and rows:
        REPORT.parent.mkdir(parents=True, exist_ok=True)
        REPORT.write_text(text, encoding="utf-8")
        print(f"Written to {REPORT}")
    return 0 if rows else 1


if __name__ == "__main__":
    sys.exit(main())
