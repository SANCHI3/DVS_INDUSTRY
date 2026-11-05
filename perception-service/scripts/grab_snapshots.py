"""Save one main-stream picture per DVR channel. READ-ONLY.

    cd perception-service
    python scripts/grab_snapshots.py                 # channels 1-8
    python scripts/grab_snapshots.py --channels 3 --stream sub

Writes calibration/snapshots/chN.jpg (gitignored). Use the pictures to say
which area each camera sees and to draw zones (scripts/draw_roi.py).
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from env_loader import load_env  # noqa: E402
from ingestion.dvr import FORMAT_FALLBACKS, DvrConfig, mask_text  # noqa: E402
from ingestion.rtsp_probe import OPENCV_TCP_OPTIONS, diagnose_unreachable, tcp_reachable  # noqa: E402
from scripts.probe_dvr import parse_channels  # noqa: E402

SNAPSHOT_DIR = ROOT / "calibration" / "snapshots"


def grab_frame(url: str, timeout_s: float, skip: int = 5):
    """Open, read a few frames (the first can be grey on H.264), close."""
    import cv2

    cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
    try:
        if not cap.isOpened():
            return None
        frame, good, started = None, 0, time.monotonic()
        while time.monotonic() - started < timeout_s and good <= skip:
            ok, img = cap.read()
            if ok and img is not None:
                frame, good = img, good + 1
        return frame
    finally:
        cap.release()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--channels", default="1-8")
    parser.add_argument("--stream", choices=("main", "sub"), default="main")
    parser.add_argument("--timeout", type=float, default=15.0)
    parser.add_argument("--out", type=Path, default=SNAPSHOT_DIR)
    args = parser.parse_args(argv)

    load_env()
    try:
        cfg = DvrConfig.from_env()
    except ValueError as exc:
        print(f"Setup problem: {exc}")
        return 2
    if not tcp_reachable(cfg.host, cfg.rtsp_port, 5.0):
        print(f"FAIL: nothing answers at {cfg.host}:{cfg.rtsp_port}.")
        print(diagnose_unreachable(cfg.host))
        return 1

    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = OPENCV_TCP_OPTIONS.format(timeout_us=int(args.timeout * 1e6))
    os.environ.setdefault("OPENCV_FFMPEG_LOGLEVEL", "-8")
    os.environ.setdefault("OPENCV_LOG_LEVEL", "SILENT")
    import cv2

    args.out.mkdir(parents=True, exist_ok=True)
    formats = [cfg.url_format, *FORMAT_FALLBACKS[cfg.url_format]]
    saved = 0
    for channel in parse_channels(args.channels):
        frame = None
        for fmt in formats:
            frame = grab_frame(cfg.rtsp_url(channel, args.stream, fmt), args.timeout)
            if frame is not None:
                break
        if frame is None:
            print(f"  ch{channel}: no picture (run scripts/probe_dvr.py for the reason)")
            continue
        path = args.out / f"ch{channel}.jpg"
        cv2.imwrite(str(path), frame, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
        saved += 1
        print(f"  ch{channel}: {frame.shape[1]}x{frame.shape[0]} -> {path}", flush=True)
    print(f"\nSaved {saved} picture(s) to {args.out}")
    return 0 if saved else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"Snapshot failed: {mask_text(exc, os.environ.get('DVR_PASSWORD') or '')}")
        sys.exit(1)
