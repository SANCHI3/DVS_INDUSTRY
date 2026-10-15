"""Physical-plausibility check for persistent fire/smoke detections.

YOLO scores each frame independently, so a static object that happens to
look like fire or smoke (an orange poster, a lamp, a grey wall, a white
ceiling, a window) produces the SAME detection frame after frame -- and frame
persistence alone turns that into an alarm.

Real fire and smoke are never static:
  * flames flicker: pixels inside the region change from frame to frame far
    more than the rest of the scene;
  * smoke drifts and grows: compared with how the scene looked several
    seconds earlier, the region has changed far more than the rest of it.

This check compares change INSIDE the detected box with change in the rest
of the frame (median over pixels, so people walking elsewhere do not inflate
it). Using the rest of the frame as the reference makes it independent of
sensor noise and of camera auto-exposure, which shift every pixel together.
A detection passes when either the flicker ratio or the growth ratio reaches
`min_ratio`; a region that changes no more than the background is rejected.
It adds no delay: it is computed on the frames already used for persistence.
"""
from __future__ import annotations

from collections import deque
from typing import Deque, Optional, Sequence, Tuple

import cv2
import numpy as np

Box = Tuple[float, float, float, float]
WORK_WIDTH = 160  # analysis resolution; enough for region statistics, cheap


class RegionDynamics:
    def __init__(self, cfg: Optional[dict] = None):
        cfg = cfg or {}
        self.enabled = bool(cfg.get("enabled", True))
        self.min_ratio = float(cfg.get("min_ratio", 2.0))
        self.noise_floor = float(cfg.get("noise_floor_gray", 1.0))
        self.reference_min_age = float(cfg.get("reference_min_age_seconds", 8.0))
        self.reference_max_age = float(cfg.get("reference_max_age_seconds", 30.0))
        self.reference_interval = float(cfg.get("reference_interval_seconds", 1.0))
        self.recent: Deque[Tuple[float, np.ndarray]] = deque(maxlen=int(cfg.get("recent_frames", 5)))
        self.references: Deque[Tuple[float, np.ndarray]] = deque()
        self._scale = 1.0

    def _gray(self, frame: np.ndarray) -> np.ndarray:
        h, w = frame.shape[:2]
        self._scale = WORK_WIDTH / float(max(w, 1))
        small = cv2.resize(frame, (WORK_WIDTH, max(1, int(round(h * self._scale)))),
                           interpolation=cv2.INTER_AREA)
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY) if small.ndim == 3 else small
        return cv2.GaussianBlur(gray, (3, 3), 0).astype(np.float32)

    def observe(self, frame: np.ndarray, now: float) -> None:
        """Call once per fire/smoke evaluation, with the same frame YOLO saw."""
        gray = self._gray(frame)
        self.recent.append((now, gray))
        if not self.references or now - self.references[-1][0] >= self.reference_interval:
            self.references.append((now, gray))
        while self.references and now - self.references[0][0] > self.reference_max_age:
            self.references.popleft()

    def _mask(self, shape, box: Box) -> np.ndarray:
        h, w = shape
        x1, y1, x2, y2 = (int(round(v * self._scale)) for v in box)
        x1, y1 = max(0, min(x1, w - 1)), max(0, min(y1, h - 1))
        x2, y2 = max(x1 + 1, min(x2, w)), max(y1 + 1, min(y2, h))
        mask = np.zeros((h, w), bool)
        mask[y1:y2, x1:x2] = True
        return mask

    def _ratio(self, diff: np.ndarray, mask: np.ndarray) -> Tuple[float, float, float]:
        inside = float(diff[mask].mean())
        outside_pixels = diff[~mask]
        background = float(np.median(outside_pixels)) if outside_pixels.size else 0.0
        return inside / max(background, self.noise_floor), inside, background

    def _reference(self, now: float) -> Optional[np.ndarray]:
        """Newest snapshot at least `reference_min_age` seconds old."""
        chosen = None
        for stamp, gray in self.references:
            if now - stamp >= self.reference_min_age:
                chosen = gray
            else:
                break
        return chosen

    def assess(self, box: Box) -> dict:
        """Evidence that the region inside `box` (process-frame pixels) is a
        live, changing phenomenon rather than a static look-alike."""
        if not self.enabled:
            return {"dynamic": True, "reason": "check disabled"}
        if len(self.recent) < 2:
            return {"dynamic": False, "reason": "not enough frames yet"}
        now, current = self.recent[-1]
        mask = self._mask(current.shape, box)

        flicker_values, inside_values, background_values = [], [], []
        frames = [g for _, g in self.recent]
        for previous, nxt in zip(frames[:-1], frames[1:]):
            ratio, inside, background = self._ratio(np.abs(nxt - previous), mask)
            flicker_values.append(ratio)
            inside_values.append(inside)
            background_values.append(background)
        flicker = float(np.median(flicker_values))

        growth = None
        reference = self._reference(now)
        if reference is not None:
            growth, _, _ = self._ratio(np.abs(current - reference), mask)

        dynamic = flicker >= self.min_ratio or (growth is not None and growth >= self.min_ratio)
        if dynamic:
            reason = "region flickers" if flicker >= self.min_ratio else "region changed since earlier"
        else:
            reason = "region is static (changes no more than the rest of the scene)"
        return {
            "dynamic": bool(dynamic),
            "reason": reason,
            "flicker_ratio": round(flicker, 2),
            "growth_ratio": None if growth is None else round(float(growth), 2),
            "inside_change": round(float(np.median(inside_values)), 2),
            "background_change": round(float(np.median(background_values)), 2),
            "min_ratio": self.min_ratio,
        }


def union_box(boxes: Sequence[Optional[Box]]) -> Optional[Box]:
    present = [b for b in boxes if b is not None]
    if not present:
        return None
    return (min(b[0] for b in present), min(b[1] for b in present),
            max(b[2] for b in present), max(b[3] for b in present))
