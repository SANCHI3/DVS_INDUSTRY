"""False alarms per hour on normal footage, before vs after the false-positive fixes.

    cd perception-service
    python -m evaluation.false_alarms --video path/to/normal_15min.mp4

Every incident raised on footage that contains no real incident is a false
alarm. The script runs the same video through

  * after:  the current code (records carry detail.validation_version = 2)
  * before: the code at --before-ref (default: the commit before
            "Fix false-positive CCTV detections"), checked out into a
            temporary git worktree. Its records have no validation_version.

Both runs process the video in real time (the detectors use wall-clock time),
headless, with the dashboard and LLM disabled, so nothing reaches the database.
A 15-minute video therefore takes about 30 minutes.

Counts are reported for every local record and for "dashboard" incidents
(CONFIRMED, or PROBABLE later escalated to CONFIRMED: the ones staff would see).
Writes the "false_alarms" section of docs/RESULTS.md and
docs/results/false_alarms.json (use --no-write to only print).
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import cv2

from evaluation.common import REPO_ROOT, RESULTS_DIR, SERVICE_ROOT, update_section

DEFAULT_BEFORE_REF = "85315cc~1"   # parent of "Fix false-positive CCTV detections"
QUIET_ENV = {"DASHBOARD_BACKEND_URL": "", "DASHBOARD_API_TOKEN": "", "DASHBOARD_SERVICE_EMAIL": "",
             "LLM_API_KEY": "", "LEGACY_INCIDENT_API_URL": ""}

RECORD_HELP = """
No normal-activity video given. Record one and re-run:

  * 10-15 minutes of ORDINARY activity from the demo camera (CAM-01), at the
    place and angle used in the demo: people walking past, sitting, standing
    and talking, working at a desk/bench, lights on as usual.
  * No fights, falls, fire/smoke or crowds of 4+ people; otherwise those
    are not false alarms.
  * Save as MP4 (e.g. with the Windows Camera app) and run:
        python -m evaluation.false_alarms --video <file>.mp4
"""


def video_minutes(path: Path) -> float:
    cap = cv2.VideoCapture(str(path))
    frames, fps = cap.get(cv2.CAP_PROP_FRAME_COUNT), cap.get(cv2.CAP_PROP_FPS)
    cap.release()
    if not fps or not frames:
        raise SystemExit(f"cannot read duration of {path}")
    return frames / fps / 60.0


def count_incidents(output_dir: Path) -> dict:
    log = output_dir / "incidents.jsonl"
    records = [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines() if line.strip()] \
        if log.exists() else []
    escalated = set()
    updates = output_dir / "incident_updates.jsonl"
    if updates.exists():
        for line in updates.read_text(encoding="utf-8").splitlines():
            if line.strip():
                u = json.loads(line)
                if u.get("confidence_tier") == "CONFIRMED":
                    escalated.add(u["incident_id"])
    all_types, dashboard = Counter(), Counter()
    versions = Counter()
    for r in records:
        all_types[r["event_type"]] += 1
        versions[str((r.get("detail") or {}).get("validation_version", "none"))] += 1
        if r["confidence_tier"] == "CONFIRMED" or r["incident_id"] in escalated:
            dashboard[r["event_type"]] += 1
    return {"all": dict(all_types), "dashboard": dict(dashboard), "validation_versions": dict(versions)}


def run_pipeline(workdir: Path, video: Path, output_dir: Path | None, max_seconds: float | None,
                 log_path: Path) -> None:
    cmd = [sys.executable, "main.py", "--camera", "CAM-01", "--source", str(video), "--no-display"]
    if output_dir is not None:
        cmd += ["--output-dir", str(output_dir)]
    if max_seconds:
        cmd += ["--max-seconds", str(max_seconds)]
    env = {**os.environ, **QUIET_ENV}
    print(f"running: {' '.join(cmd)}  (cwd={workdir})")
    with log_path.open("w", encoding="utf-8") as log:
        result = subprocess.run(cmd, cwd=workdir, env=env, stdout=log, stderr=subprocess.STDOUT)
    if result.returncode != 0:
        raise SystemExit(f"pipeline failed (exit {result.returncode}); see {log_path}")


def run_before(ref: str, video: Path, max_seconds: float | None, work: Path) -> dict:
    tree = work / "before_tree"
    subprocess.run(["git", "worktree", "add", "--detach", str(tree), ref], cwd=REPO_ROOT, check=True)
    try:
        service = tree / "perception-service"
        run_pipeline(service, video, None, max_seconds, work / "before.log")
        return count_incidents(service / "output")
    finally:
        subprocess.run(["git", "worktree", "remove", "--force", str(tree)], cwd=REPO_ROOT, check=False)


def per_hour(count: int, minutes: float) -> float:
    return round(count * 60.0 / minutes, 1)


def markdown(result: dict) -> str:
    m = result["footage_minutes"]
    out = ["## 2. False alarms per hour on normal footage", "",
           f"Generated by `python -m evaluation.false_alarms` on `{result['video']}` "
           f"({m:.1f} min of normal activity, no real incidents). Run on {result['run_at'][:10]}. "
           f"Before = `{result['before_ref']}` (no validation_version), after = current code "
           f"(validation_version {', '.join(result['after']['validation_versions']) or '–'}).", "",
           "Dashboard incidents = CONFIRMED (or PROBABLE later escalated to CONFIRMED); "
           "these are the alerts staff see.", "",
           "| Event type | Before: dashboard | Before: per hour | After: dashboard | After: per hour |",
           "|---|---|---|---|---|"]
    before, after = result.get("before") or {"dashboard": {}, "all": {}}, result["after"]
    types = sorted(set(before["all"]) | set(after["all"]) | set(before["dashboard"]) | set(after["dashboard"]))
    tb = ta = 0
    for t in types:
        b, a = before["dashboard"].get(t, 0), after["dashboard"].get(t, 0)
        tb, ta = tb + b, ta + a
        out.append(f"| {t} | {b} | {per_hour(b, m)} | {a} | {per_hour(a, m)} |")
    out.append(f"| **total** | **{tb}** | **{per_hour(tb, m)}** | **{ta}** | **{per_hour(ta, m)}** |")
    out += ["", f"All local records (incl. PROBABLE never confirmed): before {sum(before['all'].values())}, "
                f"after {sum(after['all'].values())}.", "",
            "Caveat: after the fixes the unusual-activity detector is silent for its first 5 minutes "
            "on a camera while it calibrates, by design. Footage of only one camera and one scene "
            "was used; rates on other cameras will differ."]
    if result.get("before") is None:
        out[2] += " The before run was skipped."
    return "\n".join(out)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--video", type=Path, help="normal-activity video (10-15 min recommended)")
    parser.add_argument("--before-ref", default=DEFAULT_BEFORE_REF)
    parser.add_argument("--skip-before", action="store_true", help="only measure the current code")
    parser.add_argument("--max-seconds", type=float, default=None, help="cap each run (testing)")
    parser.add_argument("--no-write", action="store_true", help="print only; don't touch docs/")
    args = parser.parse_args()
    if args.video is None:
        print(RECORD_HELP)
        return
    video = args.video.resolve()
    minutes = video_minutes(video)
    if args.max_seconds:
        minutes = min(minutes, args.max_seconds / 60.0)
    if minutes < 10:
        print(f"note: {minutes:.1f} min of footage; 10-15 min gives a more reliable rate")

    work = Path(tempfile.mkdtemp(prefix="false_alarms_"))
    try:
        run_pipeline(SERVICE_ROOT, video, work / "after", args.max_seconds, work / "after.log")
        after = count_incidents(work / "after")
        before = None if args.skip_before else run_before(args.before_ref, video, args.max_seconds, work)
    finally:
        print(f"logs kept in {work}") if args.no_write else shutil.rmtree(work, ignore_errors=True)

    result = {"video": video.name, "footage_minutes": round(minutes, 2), "before_ref": args.before_ref,
              "run_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
              "before": before, "after": after}
    text = markdown(result)
    print(text)
    if not args.no_write:
        RESULTS_DIR.mkdir(parents=True, exist_ok=True)
        (RESULTS_DIR / "false_alarms.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
        update_section("false_alarms", text)
        print("written to docs/RESULTS.md and docs/results/false_alarms.json")


if __name__ == "__main__":
    main()
