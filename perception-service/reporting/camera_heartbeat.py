"""Camera status and pictures for the website's Cameras tab.

Every 30 s one heartbeat lists every camera's status (ONLINE / CONNECTING /
OFFLINE / VIDEO_LOSS), last frame time, achieved fps and inference time.
Every 2 minutes each camera's newest picture goes up as a small JPEG
(<= 640 px wide, <= 100 KB); the website keeps only the latest one.

All sending happens on one background thread with a tiny queue: a slow or
sleeping server never stalls detection, and a missed heartbeat is simply
replaced by the next one. Only outbound HTTPS to DASHBOARD_BACKEND_URL;
stream URLs are never part of a payload.
"""
from __future__ import annotations

import os
import queue
import re
import socket
import threading
import time
from datetime import datetime, timezone
from typing import Callable, Optional

import cv2
import numpy as np

from reporting.dashboard_client import DashboardClient, DashboardClientError

HEARTBEAT_EVERY_S = 30.0
SNAPSHOT_EVERY_S = 120.0
SNAPSHOT_MAX_WIDTH = 640
SNAPSHOT_MAX_BYTES = 100 * 1024


def instance_identity(env: Optional[dict] = None) -> tuple[str, str]:
    """(instance id, 'live' | 'dev') of this perception service.

    PERCEPTION_INSTANCE_ID names the machine (factory-pc, dev-laptop; default:
    the host name). PERCEPTION_SOURCE=dev marks test detections, which the
    website hides by default; REMOTE_MODE=true implies dev unless set.
    """
    env = os.environ if env is None else env
    raw = (env.get("PERCEPTION_INSTANCE_ID") or socket.gethostname() or "perception").strip()
    instance = re.sub(r"[^A-Za-z0-9._-]", "-", raw)[:64] or "perception"
    source = (env.get("PERCEPTION_SOURCE") or "").strip().lower()
    if source not in ("live", "dev"):
        source = "dev" if str(env.get("REMOTE_MODE", "")).strip().lower() in ("1", "true", "yes", "on") else "live"
    return instance, source


def encode_snapshot(frame: np.ndarray, max_width: int = SNAPSHOT_MAX_WIDTH,
                    max_bytes: int = SNAPSHOT_MAX_BYTES) -> Optional[bytes]:
    """Resize to max_width and lower the JPEG quality until it fits max_bytes."""
    h, w = frame.shape[:2]
    if w > max_width:
        frame = cv2.resize(frame, (max_width, max(1, round(h * max_width / w))), interpolation=cv2.INTER_AREA)
    for quality in (80, 70, 60, 50, 40, 30):
        ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
        if ok and len(buf) <= max_bytes:
            return buf.tobytes()
    return None


def _iso(ts: Optional[float]) -> Optional[str]:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat() if ts else None


class CameraHeartbeat:
    def __init__(self, cameras, client: Optional[DashboardClient] = None, identity: Optional[tuple] = None,
                 every_s: float = HEARTBEAT_EVERY_S, snapshot_every_s: float = SNAPSHOT_EVERY_S,
                 clock: Callable[[], float] = time.monotonic, info: Optional[Callable[[], dict]] = None,
                 start_thread: bool = True):
        self.cameras = {c.id: c for c in cameras}
        self.client = client or DashboardClient()
        self.instance_id, self.source = identity or instance_identity()
        self.every_s = every_s
        self.snapshot_every_s = snapshot_every_s
        self.clock = clock
        self.info = info
        self._next_beat = clock()  # first heartbeat right away
        # stagger first pictures so 8 uploads don't go at once
        self._next_snapshot = {cid: clock() + 5 + 7 * i for i, cid in enumerate(self.cameras)}
        self._last_counts: dict[str, tuple[float, int, float, int]] = {}
        self._jobs: queue.Queue = queue.Queue(maxsize=4)
        self._last_error_log = -1e9
        self.sent = 0
        if start_thread:
            threading.Thread(target=self._run, name="camera-heartbeat", daemon=True).start()

    # ── building ──────────────────────────────────────────────────────────
    def _rates(self, cam_id: str, pipeline) -> tuple[Optional[float], Optional[float]]:
        """Frames per second and mean inference ms since the previous heartbeat."""
        now = self.clock()
        frames = pipeline.frames_processed if pipeline else 0
        total_ms = pipeline.timer.total_ms["cycle_total"] if pipeline else 0.0
        calls = pipeline.timer.calls["cycle_total"] if pipeline else 0
        prev = self._last_counts.get(cam_id)
        self._last_counts[cam_id] = (now, frames, total_ms, calls)
        if prev is None:
            return None, None
        span = max(now - prev[0], 1e-6)
        fps = round((frames - prev[1]) / span, 2)
        d_calls = calls - prev[3]
        infer = round((total_ms - prev[2]) / d_calls, 1) if d_calls > 0 else None
        return fps, infer

    def build_payload(self, readers: dict, pipelines: dict) -> dict:
        cameras = []
        for cam_id, cam in self.cameras.items():
            reader = readers.get(cam_id)
            status = reader.status() if reader else {"status": "OFFLINE", "detail": "", "last_frame_at": None}
            fps, infer = self._rates(cam_id, pipelines.get(cam_id))
            cameras.append({
                "id": cam_id,
                "channel": cam.channel,
                "name": cam.name,
                "zone": cam.zone or None,
                "enabled": cam.enabled,
                "status": status["status"],
                "statusDetail": {"black": "Black picture", "frozen": "Picture frozen"}.get(status.get("detail") or "")
                or None,
                "lastFrameAt": _iso(status.get("last_frame_at")),
                "achievedFps": fps,
                "inferMs": infer,
            })
        payload = {"instanceId": self.instance_id, "source": self.source, "cameras": cameras}
        if self.info is not None:
            try:
                payload["info"] = {k: v for k, v in self.info().items() if v is not None}
            except Exception:  # noqa: BLE001 - info is best effort
                pass
        return payload

    # ── scheduling (called from the inference loop, must be cheap) ────────
    def tick(self, readers: dict, pipelines: dict) -> None:
        now = self.clock()
        if now >= self._next_beat:
            self._next_beat = now + self.every_s
            self._submit(("heartbeat", self.build_payload(readers, pipelines)))
        for cam_id, due in self._next_snapshot.items():
            if now < due:
                continue
            self._next_snapshot[cam_id] = now + self.snapshot_every_s
            reader = readers.get(cam_id)
            sample = reader.get_latest() if reader and not reader._is_file_source() else None
            if sample is not None and isinstance(sample.frame, np.ndarray):
                self._submit(("snapshot", cam_id, sample.frame.copy()))

    def _submit(self, job) -> None:
        try:
            self._jobs.put_nowait(job)
        except queue.Full:
            pass  # the server is slow; the next heartbeat / picture replaces this one

    # ── sending (background thread) ──────────────────────────────────────
    def send(self, job) -> None:
        if job[0] == "heartbeat":
            self.client.request("/api/v1/cameras/heartbeat", job[1], "POST")
        else:
            _, cam_id, frame = job
            jpeg = encode_snapshot(frame)
            if jpeg is None:
                return
            self.client.request(f"/api/v1/cameras/{cam_id}/snapshot", None, "POST",
                                data=jpeg, content_type="image/jpeg")
        self.sent += 1

    def _run(self) -> None:
        while True:
            job = self._jobs.get()
            try:
                self.send(job)
            except DashboardClientError as exc:
                if time.monotonic() - self._last_error_log > 300:
                    self._last_error_log = time.monotonic()
                    print(f"[heartbeat] could not reach the website ({exc}); will keep trying")
            except Exception as exc:  # noqa: BLE001 - never stop the heartbeat thread
                print(f"[heartbeat] {type(exc).__name__}: {exc}")
