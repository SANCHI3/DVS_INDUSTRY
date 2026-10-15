"""
Keeps a rolling history of tracked-object states per camera, per track.
This is what lets the rule engine reason over *sequences* of frames
(dwell time, velocity, aspect-ratio changes) instead of single detections.
"""
from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass, field
from typing import Deque, Dict, Optional, Tuple


@dataclass
class TrackState:
    timestamp: float
    bbox: Tuple[float, float, float, float]  # x1, y1, x2, y2
    class_name: str
    confidence: float

    @property
    def width(self) -> float:
        return self.bbox[2] - self.bbox[0]

    @property
    def height(self) -> float:
        return self.bbox[3] - self.bbox[1]

    @property
    def aspect_ratio(self) -> float:
        return self.width / max(self.height, 1e-6)

    @property
    def center(self) -> Tuple[float, float]:
        return ((self.bbox[0] + self.bbox[2]) / 2, (self.bbox[1] + self.bbox[3]) / 2)

    @property
    def foot_point(self) -> Tuple[float, float]:
        # bottom-center of the bbox -- used for zone/ground-plane tests
        return ((self.bbox[0] + self.bbox[2]) / 2, self.bbox[3])


@dataclass
class TrackHistory:
    track_id: int
    class_name: str
    first_seen: float
    states: Deque[TrackState] = field(default_factory=lambda: deque(maxlen=512))
    zone_entry_times: Dict[str, float] = field(default_factory=dict)  # zone_id -> entry timestamp

    def push(self, state: TrackState):
        self.states.append(state)

    @property
    def last_seen(self) -> float:
        return self.states[-1].timestamp if self.states else self.first_seen

    def velocity(self) -> Optional[Tuple[float, float]]:
        """Pixels/second over the last two samples."""
        if len(self.states) < 2:
            return None
        a, b = self.states[-2], self.states[-1]
        dt = max(b.timestamp - a.timestamp, 1e-6)
        cax, cay = a.center
        cbx, cby = b.center
        return ((cbx - cax) / dt, (cby - cay) / dt)

    def states_within(self, seconds: float) -> list:
        cutoff = time.time() - seconds
        return [s for s in self.states if s.timestamp >= cutoff]

    def is_still(self, seconds: float, pixel_tolerance: float = 8.0) -> bool:
        """True if center position hasn't moved more than `pixel_tolerance`
        px over the last `seconds` of history."""
        recent = self.states_within(seconds)
        if len(recent) < 2:
            return False
        xs = [s.center[0] for s in recent]
        ys = [s.center[1] for s in recent]
        return (max(xs) - min(xs) <= pixel_tolerance) and (max(ys) - min(ys) <= pixel_tolerance)


class TemporalBuffer:
    """Per-camera collection of TrackHistory, with stale-track eviction."""

    def __init__(self, window_seconds: float = 30.0, stale_after_seconds: float = 15.0):
        self.window_seconds = window_seconds
        self.stale_after_seconds = stale_after_seconds
        self.tracks: Dict[int, TrackHistory] = {}

    def update(self, track_id: int, class_name: str, bbox, confidence: float,
               timestamp: float | None = None):
        now = time.time() if timestamp is None else float(timestamp)
        if track_id not in self.tracks:
            self.tracks[track_id] = TrackHistory(track_id=track_id, class_name=class_name, first_seen=now)
        self.tracks[track_id].push(TrackState(timestamp=now, bbox=tuple(bbox), class_name=class_name, confidence=confidence))

    def evict_stale(self, now: float | None = None):
        now = time.time() if now is None else float(now)
        stale_ids = [tid for tid, hist in self.tracks.items() if now - hist.last_seen > self.stale_after_seconds]
        for tid in stale_ids:
            del self.tracks[tid]

    def get(self, track_id: int) -> Optional[TrackHistory]:
        return self.tracks.get(track_id)

    def all_tracks(self):
        return self.tracks.values()

    def tracks_by_class(self, class_name: str):
        """Every buffered track of a class, INCLUDING ones not seen for up to
        `stale_after_seconds`. Use active_tracks_by_class() for decisions about
        what is in view right now."""
        return [h for h in self.tracks.values() if h.class_name == class_name]

    def latest_timestamp(self) -> Optional[float]:
        """Timestamp of the newest observation in the buffer (the pipeline's
        current frame time); None when the buffer is empty."""
        return max((h.last_seen for h in self.tracks.values()), default=None)

    def active_tracks_by_class(self, class_name: str, max_age_s: float = 1.0,
                               now: Optional[float] = None):
        """Tracks of a class observed within the last `max_age_s` seconds.

        A track stays buffered for `stale_after_seconds` (15 s) after the
        person leaves view or ByteTrack switches their ID. Rules that count
        people, time a dwell or pair people up must ignore those "ghost"
        tracks, otherwise someone who already left keeps accumulating dwell
        time and one person's old and new IDs look like two people."""
        if now is None:
            now = self.latest_timestamp()
            if now is None:
                return []
        return [h for h in self.tracks.values()
                if h.class_name == class_name and h.states and now - h.last_seen <= max_age_s]
