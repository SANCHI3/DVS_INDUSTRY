"""Full-resolution pictures for an incident, from the DVR's main stream.

Detection runs on the low-resolution sub stream. When an incident fires, a
background thread opens the camera's main stream, reads a few frames, saves
up to `count` JPEGs and closes it again, so the 8 main streams (2-4 Mbit/s
each) are never kept open. Failures are logged without the URL.
"""
from __future__ import annotations

import os
import queue
import threading
import time
from typing import Callable, Optional

import cv2
import numpy as np

from ingestion.dvr import mask_text
from ingestion.stream_reader import configure_ffmpeg_rtsp


def grab_frames(url: str, count: int = 3, timeout_s: float = 10.0, spacing_s: float = 0.4,
                open_capture: Callable = None):
    """Open, read `count` frames about `spacing_s` apart, close."""
    if open_capture is None:
        configure_ffmpeg_rtsp(timeout_s)

        def open_capture(u):
            return cv2.VideoCapture(u, cv2.CAP_FFMPEG)
    cap = open_capture(url)
    frames = []
    try:
        if not cap.isOpened():
            return frames
        started = last = time.monotonic()
        # skip the first frames: an H.264 stream can start grey until a keyframe
        warmup = 3
        while len(frames) < count and time.monotonic() - started < timeout_s:
            ok, frame = cap.read()
            if not ok or frame is None:
                continue
            if warmup:
                warmup -= 1
                continue
            if not frames or time.monotonic() - last >= spacing_s:
                frames.append(frame)
                last = time.monotonic()
        return frames
    finally:
        cap.release()


def snapshot_frame(cfg, channel: Optional[int]):
    """One picture from the DVR's web port, for when the video cannot be read."""
    from ingestion.rtsp_probe import fetch_snapshot

    if channel is None:
        return None
    picture = fetch_snapshot(cfg, channel, "main", 10.0)
    if "jpeg" not in picture:
        return None
    return cv2.imdecode(np.frombuffer(picture["jpeg"], np.uint8), cv2.IMREAD_COLOR)


class MainStreamGrabber:
    def __init__(self, output_dir: str, password: str = "", count: int = 3,
                 on_saved: Optional[Callable[[str, list[str]], None]] = None,
                 grab: Callable = grab_frames, fallback: Optional[Callable] = None):
        self.output_dir = output_dir
        self.password = password
        self.count = count
        self.on_saved = on_saved
        self.grab = grab
        self.fallback = fallback
        self._jobs: queue.Queue = queue.Queue(maxsize=32)
        self._thread = threading.Thread(target=self._run, name="main-stream-grabber", daemon=True)
        self._thread.start()

    def request(self, incident_id: str, camera_id: str, url: Optional[str]) -> None:
        if not url:
            return
        try:
            self._jobs.put_nowait((incident_id, camera_id, url))
        except queue.Full:
            print(f"[{camera_id}] main-stream picture for {incident_id} skipped (busy)")

    def close(self, timeout: float = 15.0) -> None:
        self._jobs.put(None)
        self._thread.join(timeout)

    def _run(self) -> None:
        while True:
            job = self._jobs.get()
            if job is None:
                return
            incident_id, camera_id, url = job
            try:
                frames = self.grab(url, self.count)
                if not frames and self.fallback is not None:
                    picture = self.fallback(camera_id)
                    frames = [] if picture is None else [picture]
                paths = []
                os.makedirs(self.output_dir, exist_ok=True)
                for i, frame in enumerate(frames):
                    path = os.path.join(self.output_dir, f"{incident_id}_{camera_id}_main_{i}.jpg")
                    cv2.imwrite(path, frame, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
                    paths.append(path.replace("\\", "/"))
                if not paths:
                    print(f"[{camera_id}] no main-stream picture for {incident_id}")
            except Exception as exc:  # noqa: BLE001 - never let evidence break detection
                paths = []
                print(f"[{camera_id}] main-stream picture failed: {mask_text(exc, self.password)}")
            if self.on_saved:
                try:
                    self.on_saved(incident_id, paths)
                except Exception as exc:  # noqa: BLE001 - keep the grabber thread alive
                    print(f"[{camera_id}] evidence hand-off failed: {mask_text(exc, self.password)}")
