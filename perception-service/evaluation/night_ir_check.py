"""How the fire/smoke detector behaves on black-and-white (IR night) video.

Analog cameras switch to infrared at night and send a greyscale picture. The
fire model was trained on colour video, and its verifier uses flame colour,
so this runs the detector on the same clips in colour and converted to
greyscale and compares detections and confidence.

    python -m evaluation.night_ir_check demo_videos/03_fire.avi demo_videos/01_normal_activity.mp4
    python -m evaluation.night_ir_check recordings/night/*.mp4 --gray-only   # real IR footage

Writes nothing; prints a table. With real night recordings (already grey),
use --gray-only.
"""
from __future__ import annotations

import argparse
import copy
import sys
from pathlib import Path

import cv2
import numpy as np
import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def to_ir(frame: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    return cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)


def run_clip(path: str, gray: bool, cfg: dict, fps: float, size: tuple[int, int]) -> dict:
    from temporal.fire_smoke_recognition import FireSmokeDetector

    detector = FireSmokeDetector("night-check", copy.deepcopy(cfg))
    cap = cv2.VideoCapture(path)
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    stride = max(1, round(src_fps / fps))
    n, frames, candidates, confs = 0, 0, 0, []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        n += 1
        if n % stride:
            continue
        frame = cv2.resize(frame, size)
        if gray:
            frame = to_ir(frame)
        out = detector.evaluate(frame, person_boxes=[])
        frames += 1
        candidates += len(out)
        confs += [c.raw_confidence for c in out]
    cap.release()
    return {"frames": frames, "candidates": candidates,
            "mean_conf": round(float(np.mean(confs)), 2) if confs else None,
            "max_conf": round(float(np.max(confs)), 2) if confs else None}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("clips", nargs="+")
    parser.add_argument("--gray-only", action="store_true", help="clips are real IR footage")
    args = parser.parse_args(argv)
    import sklearn  # noqa: F401 - load before torch (OpenMP clash on Windows)

    cfg_all = yaml.safe_load((ROOT / "config" / "thresholds.yaml").read_text(encoding="utf-8"))
    perception = cfg_all["perception"]
    cfg = cfg_all["fire_smoke_detection"]
    size = (perception["process_width"], perception["process_height"])
    fps = float(perception["detection_fps"])
    print(f"{'clip':40} {'mode':6} {'frames':>6} {'fire/smoke signals':>18} {'mean conf':>9} {'max conf':>8}")
    for clip in args.clips:
        for gray in ([True] if args.gray_only else [False, True]):
            r = run_clip(clip, gray, cfg, fps, size)
            print(f"{Path(clip).name:40} {'IR' if gray else 'colour':6} {r['frames']:>6} {r['candidates']:>18} "
                  f"{str(r['mean_conf']):>9} {str(r['max_conf']):>8}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
