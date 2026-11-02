"""Per-camera areas: where to look, where not to, and night (infrared) pictures.

In cameras.yaml, coordinates are fractions of the picture (0-1), so they do
not depend on the stream resolution (scripts/draw_roi.py prints them):

    roi: [[0.05, 0.2], [0.95, 0.2], [0.95, 1.0], [0.05, 1.0]]   # only this area
    ignore_zones:
      - name: Welding bay              # sparks look like fire
        polygon: [[0.6, 0.1], [0.9, 0.1], [0.9, 0.5], [0.6, 0.5]]
        events: [fire_smoke]           # optional; default: every check
      - name: Window
        polygon: [...]

Outside the ROI and inside an ignore zone the picture is greyed out before the
models see it, so nothing there can raise an incident. A zone limited to
crowd / fall / fight drops those incidents when the person is standing in it
(people are still tracked there).

    night_mode: normal | strict | off    (how fire/smoke behaves at night)
    night_min_confidence: 0.7            (strict: the confidence fire/smoke needs)

Analog cameras switch to infrared at night and send a black-and-white picture;
the fire/smoke model loses confidence there (evaluation/night_ir_check.py).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Optional

import cv2
import numpy as np

EVENTS = ("crowd", "fall", "fight", "fire_smoke", "anomaly")
PERSON_EVENTS = ("crowd", "fall", "fight")
NIGHT_MODES = ("normal", "strict", "off")
MASK_GREY = 114  # the neutral grey YOLO uses for padding


def _polygon(points, where: str) -> np.ndarray:
    try:
        arr = np.asarray(points, dtype=np.float32)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{where}: polygon must be a list of [x, y] pairs") from exc
    if arr.ndim != 2 or arr.shape[1] != 2 or len(arr) < 3:
        raise ValueError(f"{where}: polygon needs at least 3 [x, y] points")
    if (arr < 0).any() or (arr > 1).any():
        raise ValueError(f"{where}: coordinates are fractions of the picture, between 0 and 1")
    return arr


@dataclass
class IgnoreZone:
    name: str
    polygon: np.ndarray  # normalised
    events: tuple[str, ...]


def is_grayscale(frame: np.ndarray, tolerance: float = 2.5) -> bool:
    """True for an infrared (black-and-white) picture: the colour channels are equal."""
    if frame.ndim == 2 or frame.shape[2] == 1:
        return True
    small = cv2.resize(frame, (64, 36), interpolation=cv2.INTER_AREA).astype(np.int16)
    b, g, r = small[..., 0], small[..., 1], small[..., 2]
    return float(np.mean(np.abs(b - g)) + np.mean(np.abs(g - r))) / 2 < tolerance


class ZoneMask:
    def __init__(self, cam_cfg: dict, width: int, height: int):
        cam = cam_cfg.get("id", "camera")
        self.size = (width, height)
        self.roi = _polygon(cam_cfg["roi"], f"{cam} roi") if cam_cfg.get("roi") else None
        self.ignore: list[IgnoreZone] = []
        for i, zone in enumerate(cam_cfg.get("ignore_zones") or []):
            name = str(zone.get("name") or f"zone {i + 1}")
            events = tuple(zone.get("events") or EVENTS)
            events = tuple("fire_smoke" if e in ("fire", "smoke") else e for e in events)
            unknown = set(events) - set(EVENTS)
            if unknown:
                raise ValueError(f"{cam} ignore zone '{name}': unknown checks {', '.join(sorted(unknown))}")
            self.ignore.append(IgnoreZone(name, _polygon(zone.get("polygon"), f"{cam} ignore zone '{name}'"), events))
        night = str(cam_cfg.get("night_mode") or "normal").lower()
        if night not in NIGHT_MODES:
            raise ValueError(f"{cam}: night_mode must be one of {', '.join(NIGHT_MODES)}")
        self.night_mode = night
        self.night_min_confidence = float(cam_cfg.get("night_min_confidence", 0.7))
        self._masks: dict[Optional[str], Optional[np.ndarray]] = {}

    @property
    def active(self) -> bool:
        return self.roi is not None or bool(self.ignore)

    def _pixels(self, poly: np.ndarray) -> np.ndarray:
        w, h = self.size
        return np.round(poly * [w - 1, h - 1]).astype(np.int32)

    def mask(self, event: Optional[str] = None) -> Optional[np.ndarray]:
        """255 where the models may look. event=None: zones that apply to every check."""
        if event not in self._masks:
            zones = [z for z in self.ignore if (set(z.events) >= set(EVENTS)) or (event is not None and event in z.events)]
            if self.roi is None and not zones:
                self._masks[event] = None
            else:
                w, h = self.size
                m = np.zeros((h, w), np.uint8) if self.roi is not None else np.full((h, w), 255, np.uint8)
                if self.roi is not None:
                    cv2.fillPoly(m, [self._pixels(self.roi)], 255)
                for z in zones:
                    cv2.fillPoly(m, [self._pixels(z.polygon)], 0)
                self._masks[event] = m
        return self._masks[event]

    def apply(self, frame: np.ndarray, event: Optional[str] = None) -> np.ndarray:
        """The frame with everything the models must not see greyed out."""
        m = self.mask(event)
        if m is None:
            return frame
        if m.shape[:2] != frame.shape[:2]:
            m = cv2.resize(m, (frame.shape[1], frame.shape[0]), interpolation=cv2.INTER_NEAREST)
        out = frame.copy()
        out[m == 0] = MASK_GREY
        return out

    def ignored_at(self, event: str, x: float, y: float) -> Optional[str]:
        """Name of an event-specific ignore zone containing the point (normalised), if any."""
        for z in self.ignore:
            if event in z.events and not set(z.events) >= set(EVENTS):
                if cv2.pointPolygonTest(z.polygon.reshape(-1, 1, 2), (float(x), float(y)), False) >= 0:
                    return z.name
        return None

    def night_filter(self, candidates: Iterable, night: bool) -> list:
        """Fire/smoke at night per night_mode; other checks unchanged."""
        out = []
        for c in candidates:
            if c.event_type == "fire_smoke" and night:
                if self.night_mode == "off":
                    continue
                if self.night_mode == "strict" and c.raw_confidence < self.night_min_confidence:
                    continue
                c.detail = {**(c.detail or {}), "night_picture": True}
            out.append(c)
        return out
