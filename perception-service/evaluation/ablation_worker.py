"""Worker for evaluation/ablation.py: plays clips one by one through main.run().

Started by ablation.py as a subprocess with the working directory set to the
perception-service folder of the code under test (the current tree, or a git
worktree of an older commit). It imports *that* tree's main.py and calls its
unchanged run() once per clip, so every clip starts with fresh tracker,
detector, confirmation and dedup state, while Python, torch and the CUDA
context are loaded only once.

Configuration changes are applied by wrapping main.load_config (the YAML is
read as usual, then the dotted-key overrides are set); no pipeline code is
modified. Runs are headless with the dashboard, LLM and incident API off.
With --no-zones the camera's zones are removed (the CAM-01 polygons are demo
examples drawn for one room; dataset clips come from other cameras).
--warmup plays one clip first and discards it, so the first measured clip is
not slowed by CUDA start-up.

Deliberately imports nothing from the evaluation package: older commits do
not have it.

Modes
  play       append one JSON line per clip to --results: the incident records
             and incident updates main.run() wrote for that clip.
  calibrate  scene-anomaly camera calibration from many short normal clips.
             The real detector observes every clip (calibration on, never
             finishing inside a clip); its recorded windows are pooled and the
             detector's own _finish_calibration() writes the calibration file.
             This avoids concatenating clips, whose scene cuts would look
             abnormal and inflate the threshold.
"""
from __future__ import annotations

import argparse
import inspect
import json
import os
import shutil
import sys
import time
from pathlib import Path

QUIET_ENV = {"DASHBOARD_BACKEND_URL": "", "DASHBOARD_API_TOKEN": "", "DASHBOARD_SERVICE_EMAIL": "",
             "LLM_API_KEY": "", "LEGACY_INCIDENT_API_URL": "", "CCTV_RTSP_URL": "", "CAMERA_ID": ""}
CAMERA = "CAM-01"


def set_dotted(cfg: dict, key: str, value) -> None:
    node = cfg
    *parents, leaf = key.split(".")
    for part in parents:
        node = node.setdefault(part, {})
    node[leaf] = value


def read_jsonl(path: Path) -> list:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["play", "calibrate"], default="play")
    parser.add_argument("--clips", type=Path, required=True, help="JSON list of video paths")
    parser.add_argument("--overrides", default="{}", help="JSON {dotted.key: value}")
    parser.add_argument("--work", type=Path, required=True, help="scratch folder for per-clip output")
    parser.add_argument("--results", type=Path, help="play: JSONL appended per clip")
    parser.add_argument("--calibration", type=Path, help="play: calibration file copied into every clip's "
                                                          "output; calibrate: file to write")
    parser.add_argument("--no-zones", action="store_true", help="remove the camera's zones")
    parser.add_argument("--warmup", help="clip played once before the measured clips, result discarded")
    args = parser.parse_args()

    os.environ.update(QUIET_ENV)
    here = str(Path(__file__).resolve().parent)
    sys.path[:] = [p for p in sys.path if Path(p or ".").resolve() != Path(here)]
    sys.path.insert(0, os.getcwd())
    import main as pipeline  # the tree under test (cwd)

    overrides = json.loads(args.overrides)
    original_load = pipeline.load_config

    def load_config(config_dir: str = "config"):
        cameras_cfg, thresholds_cfg = original_load(config_dir)
        for key, value in overrides.items():
            set_dotted(thresholds_cfg, key, value)
        if args.no_zones:
            for cam in cameras_cfg["cameras"]:
                cam["zones"] = []
        return cameras_cfg, thresholds_cfg

    pipeline.load_config = load_config
    has_output_dir = "output_dir" in inspect.signature(pipeline.run).parameters
    clips = json.loads(args.clips.read_text(encoding="utf-8"))
    args.work.mkdir(parents=True, exist_ok=True)

    instances = []
    if args.mode == "calibrate":
        from temporal.scene_anomaly import SceneAnomalyDetector
        original_init = SceneAnomalyDetector.__init__

        def init(self, *a, **kw):
            original_init(self, *a, **kw)
            instances.append(self)

        SceneAnomalyDetector.__init__ = init

    done = set()
    if args.mode == "play" and args.results and args.results.exists():
        done = {json.loads(line)["clip"] for line in args.results.read_text(encoding="utf-8").splitlines()
                if line.strip()}

    if args.warmup:
        warm = args.work / "warmup"
        kwargs = dict(camera_id=CAMERA, source_override=args.warmup, display=False, max_seconds=None)
        if has_output_dir:
            kwargs["output_dir"] = str(warm)
        pipeline.run(**kwargs)
        shutil.rmtree(warm, ignore_errors=True)
        instances.clear()

    pooled, observed_seconds = [], 0.0
    for i, clip in enumerate(clips):
        if clip in done:
            continue
        out = args.work / f"clip_{i:04d}"
        shutil.rmtree(out, ignore_errors=True)
        out.mkdir(parents=True)
        if has_output_dir:
            output_dir = out
        else:  # older code always writes to output/
            output_dir = Path("output")
            for name in ("incidents.jsonl", "incident_updates.jsonl"):
                (output_dir / name).unlink(missing_ok=True)
        if args.mode == "play" and args.calibration and args.calibration.exists():
            cal_dir = output_dir / "calibration"
            cal_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy(args.calibration, cal_dir / f"scene_anomaly_{CAMERA}.json")

        kwargs = dict(camera_id=CAMERA, source_override=clip, display=False, max_seconds=None)
        if args.mode == "calibrate":
            kwargs["only_events"] = {"anomaly"}
        if has_output_dir:
            kwargs["output_dir"] = str(output_dir)
        started = time.time()
        pipeline.run(**kwargs)
        elapsed = round(time.time() - started, 2)

        if args.mode == "calibrate":
            detector = instances[-1]
            pooled.extend(detector._calibration_ratios)
            observed_seconds += elapsed
            print(f"calibration clip {i + 1}/{len(clips)}: {len(detector._calibration_ratios)} windows "
                  f"(pooled {len(pooled)}, {observed_seconds:.0f}s)", flush=True)
            continue
        record = {"clip": clip, "seconds": elapsed,
                  "incidents": read_jsonl(output_dir / "incidents.jsonl"),
                  "updates": read_jsonl(output_dir / "incident_updates.jsonl")}
        with args.results.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, default=str) + "\n")
        print(f"clip {i + 1}/{len(clips)} done in {elapsed}s: "
              f"{[r['event_type'] + '/' + r['confidence_tier'] for r in record['incidents']]}", flush=True)
        shutil.rmtree(out, ignore_errors=True)

    if args.mode == "calibrate":
        detector = instances[-1]
        if observed_seconds < detector.calibration_seconds or len(pooled) < detector.calibration_min_windows:
            raise SystemExit(f"not enough normal footage to calibrate: {observed_seconds:.0f}s, "
                             f"{len(pooled)} windows (need {detector.calibration_seconds:.0f}s, "
                             f"{detector.calibration_min_windows} windows)")
        detector._calibration_ratios = pooled
        detector.calibration_path = str(args.calibration)
        detector._finish_calibration()


if __name__ == "__main__":
    main()
