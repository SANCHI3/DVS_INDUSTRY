"""Round-robin frame scheduling for several cameras on one inference loop.

Each camera asks for `fps` frames a second; together they may not exceed
MAX_INFER_FPS_TOTAL. When the PC cannot keep up, cameras take turns (the one
waited on longest goes next) instead of the first camera starving the rest,
and every camera simply gets fewer frames a second. The newest frame is always
used, so detection never runs behind real time.
"""
from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass, field
from typing import Callable, Optional


@dataclass
class CameraRate:
    interval: float
    next_due: float = 0.0
    frames: int = 0
    infer_ms: float = 0.0
    window_frames: int = 0
    window_ms: float = 0.0
    window_start: float = 0.0


@dataclass
class FrameScheduler:
    camera_fps: dict[str, float]
    max_total_fps: float = 10.0
    clock: Callable[[], float] = time.monotonic
    _rates: dict[str, CameraRate] = field(default_factory=dict, init=False)
    _order: deque = field(default_factory=deque, init=False)
    _next_global: float = field(default=0.0, init=False)
    # 1.0 normally; the CPU guard halves it when the computer is busy
    speed: float = field(default=1.0, init=False)

    def __post_init__(self) -> None:
        if self.max_total_fps <= 0:
            raise ValueError("MAX_INFER_FPS_TOTAL must be positive")
        now = self.clock()
        for cam_id, fps in self.camera_fps.items():
            if fps <= 0:
                raise ValueError(f"{cam_id}: fps must be positive")
            self._rates[cam_id] = CameraRate(interval=1.0 / fps, next_due=now, window_start=now)
            self._order.append(cam_id)
        self._next_global = now

    def next_camera(self) -> Optional[str]:
        """The camera to process now, or None if nothing is due yet."""
        now = self.clock()
        if now < self._next_global:
            return None
        for _ in range(len(self._order)):
            cam_id = self._order[0]
            self._order.rotate(-1)
            if self._rates[cam_id].next_due <= now:
                return cam_id
        return None

    def wait_time(self) -> float:
        """Seconds until something can be due (for sleeping)."""
        now = self.clock()
        soonest = min((r.next_due for r in self._rates.values()), default=now)
        return max(0.0, max(soonest, self._next_global) - now)

    def done(self, cam_id: str, infer_ms: float) -> None:
        """A frame of cam_id was processed."""
        now = self.clock()
        rate = self._rates[cam_id]
        # Never schedule in the past: a slow PC lowers the rate instead of piling up
        rate.next_due = max(rate.next_due + rate.interval / self.speed, now)
        self._next_global = max(self._next_global + 1.0 / (self.max_total_fps * self.speed), now)
        rate.frames += 1
        rate.window_frames += 1
        rate.window_ms += infer_ms
        rate.infer_ms = infer_ms

    def skip(self, cam_id: str, retry_after: float = 0.2) -> None:
        """No new frame (or video loss): look again shortly without using a slot."""
        self._rates[cam_id].next_due = self.clock() + retry_after

    def take_stats(self) -> dict[str, dict]:
        """Achieved fps and mean inference time per camera since the last call."""
        now = self.clock()
        out = {}
        for cam_id, rate in self._rates.items():
            span = max(now - rate.window_start, 1e-6)
            out[cam_id] = {
                "fps": round(rate.window_frames / span, 2),
                "infer_ms": round(rate.window_ms / rate.window_frames, 1) if rate.window_frames else None,
            }
            rate.window_frames, rate.window_ms, rate.window_start = 0, 0.0, now
        return out
