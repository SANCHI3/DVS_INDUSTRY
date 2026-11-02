"""Record normal working footage from DVR channels, in 10-minute MP4 files. READ-ONLY.

    cd perception-service
    python scripts/record_clips.py --channels 1,3,5 --hours 3           # sub stream
    python scripts/record_clips.py --channels 2 --hours 1 --stream main

Writes recordings/chN/chN_YYYYmmdd_HHMMSS.mp4 (gitignored, stays on this PC).
Used by `python -m evaluation.false_alarms_cctv recordings/` to measure false
alarms per hour on real footage. A dropped stream is reopened; the password
is never printed. Footage exported from the DVR to USB works too: copy it as
recordings/chN/*.mp4.

Disk: a sub stream is about 0.3-0.5 Mbit/s, so roughly 150-250 MB per hour
per channel.
"""
from __future__ import annotations

import argparse
import os
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional

import cv2

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from env_loader import load_env  # noqa: E402
from ingestion.dvr import DvrConfig, mask_text  # noqa: E402
from scripts.probe_dvr import parse_channels  # noqa: E402

OUT_DIR = ROOT / "recordings"


class SegmentRecorder:
    """Writes frames into files of `segment_s` seconds each."""

    def __init__(self, folder: Path, prefix: str, fps: float, segment_s: float = 600.0,
                 clock: Callable[[], float] = time.time,
                 make_writer: Optional[Callable] = None):
        self.folder, self.prefix, self.fps, self.segment_s, self.clock = folder, prefix, fps, segment_s, clock
        self.make_writer = make_writer or (lambda path, size: cv2.VideoWriter(
            str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, size))
        self.writer = None
        self.started = 0.0
        self.files: list[Path] = []

    def write(self, frame) -> None:
        now = self.clock()
        if self.writer is None or now - self.started >= self.segment_s:
            self.close()
            self.folder.mkdir(parents=True, exist_ok=True)
            path = self.folder / f"{self.prefix}_{datetime.fromtimestamp(now):%Y%m%d_%H%M%S}.mp4"
            self.writer = self.make_writer(path, (frame.shape[1], frame.shape[0]))
            self.started = now
            self.files.append(path)
        self.writer.write(frame)

    def close(self) -> None:
        if self.writer is not None:
            self.writer.release()
            self.writer = None


def record_channel(url: str, channel: int, seconds: float, out: Path, segment_s: float, password: str,
                   stop: threading.Event, open_capture: Optional[Callable] = None) -> list[Path]:
    open_capture = open_capture or (lambda u: cv2.VideoCapture(u, cv2.CAP_FFMPEG))
    deadline = time.time() + seconds
    recorder = None
    try:
        while time.time() < deadline and not stop.is_set():
            cap = open_capture(url)
            if not cap.isOpened():
                print(f"  ch{channel}: could not open the stream; retrying in 10 s")
                stop.wait(10)
                continue
            fps = cap.get(cv2.CAP_PROP_FPS) or 12.5
            fps = fps if 1 <= fps <= 60 else 12.5
            if recorder is None:
                recorder = SegmentRecorder(out / f"ch{channel}", f"ch{channel}", fps, segment_s)
            while time.time() < deadline and not stop.is_set():
                ok, frame = cap.read()
                if not ok or frame is None:
                    print(f"  ch{channel}: stream dropped; reopening")
                    break
                recorder.write(frame)
            cap.release()
    except Exception as exc:  # noqa: BLE001
        print(f"  ch{channel}: recording stopped: {mask_text(exc, password)}")
    finally:
        if recorder is not None:
            recorder.close()
    return recorder.files if recorder else []


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--channels", required=True, help="e.g. 1,3,5 or 1-8")
    parser.add_argument("--hours", type=float, default=1.0)
    parser.add_argument("--segment-minutes", type=float, default=10.0)
    parser.add_argument("--stream", choices=("sub", "main"), default="sub")
    parser.add_argument("--out", type=Path, default=OUT_DIR)
    args = parser.parse_args(argv)

    load_env()
    try:
        cfg = DvrConfig.from_env()
    except ValueError as exc:
        print(f"Setup problem: {exc}")
        return 2
    from ingestion.stream_reader import configure_ffmpeg_rtsp

    configure_ffmpeg_rtsp(15.0)
    stop = threading.Event()
    results: dict[int, list[Path]] = {}
    threads = []
    for ch in parse_channels(args.channels):
        url = cfg.rtsp_url(ch, args.stream)

        def job(ch=ch, url=url):
            results[ch] = record_channel(url, ch, args.hours * 3600, args.out, args.segment_minutes * 60,
                                         cfg.password, stop)
        t = threading.Thread(target=job, daemon=True)
        t.start()
        threads.append(t)
    print(f"Recording channels {args.channels} ({args.stream} stream) for {args.hours:g} h into {args.out} "
          "- Ctrl+C to stop early")
    try:
        for t in threads:
            while t.is_alive():
                t.join(1.0)
    except KeyboardInterrupt:
        stop.set()
        for t in threads:
            t.join(15)
    for ch, files in sorted(results.items()):
        print(f"  ch{ch}: {len(files)} file(s)")
    return 0 if any(results.values()) else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"Recording failed: {mask_text(exc, os.environ.get('DVR_PASSWORD') or '')}")
        sys.exit(1)
