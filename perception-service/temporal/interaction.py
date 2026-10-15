"""Track-level evidence that two people are physically interacting.

The R3D-18 fight classifier scores whole video clips. On a camera whose scene
differs from its training data it can score ordinary activity (people
walking, standing or talking near each other) above threshold, and the
motion gate in front of it is deliberately permissive. Before a fight
incident is created, this module therefore requires evidence a fight
physically needs, measured from the ByteTrack tracks:

  1. two DISTINCT people in view now -- tracks not seen for `active_track_seconds`
     (people who left, or an old ID after an ID switch) are ignored, and two
     boxes that overlap almost completely are one person tracked twice;
  2. who stay close -- centre distance <= `proximity_heights` x their mean box
     height (scale-independent, unlike a fixed pixel radius) -- for at least
     `min_interaction_seconds` within the last `lookback_seconds`;
  3. with agitated motion -- erratic movement that is NOT explained by walking
     from A to B, of at least `min_agitation` body heights for the more active
     person. Agitation = spread of the box centre around a smooth (quadratic)
     path over the window + spread of box width and height, all divided by
     body height. Walking, turning or stopping follows a smooth path and keeps
     the box shape, standing still leaves only detector jitter (a few pixels);
     punching, shoving and grappling make the box jump and change shape.

People grappling are often merged into one box by the detector, so a pair
that qualified within the last `merged_hold_seconds` stays valid even if one
of the two tracks is momentarily lost.

Everything here is pure Python over TemporalBuffer, so it is unit-tested
without torch or a camera (test_false_positives.py).
"""
from __future__ import annotations

import math
from itertools import combinations
from typing import List, Optional, Sequence, Tuple

import numpy as np

from temporal.temporal_buffer import TemporalBuffer, TrackHistory, TrackState

SAMPLE_STEP_S = 0.2  # proximity is sampled at this step


def box_iou(a: Sequence[float], b: Sequence[float]) -> float:
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def distinct_people(tracks: List[TrackHistory], duplicate_iou: float) -> List[TrackHistory]:
    """Drop tracks whose current box nearly coincides with an older track's box
    (ByteTrack occasionally keeps two IDs on one person)."""
    kept: List[TrackHistory] = []
    for track in sorted(tracks, key=lambda t: t.first_seen):
        if all(box_iou(track.states[-1].bbox, other.states[-1].bbox) < duplicate_iou for other in kept):
            kept.append(track)
    return kept


def _resample(states: Sequence[TrackState], start: float) -> List[TrackState]:
    """States at least SAMPLE_STEP_S apart, from `start` on."""
    out: List[TrackState] = []
    for state in states:
        if state.timestamp < start:
            continue
        if not out or state.timestamp - out[-1].timestamp >= SAMPLE_STEP_S:
            out.append(state)
    return out


def agitation(states: Sequence[TrackState]) -> float:
    """Erratic motion in body heights (see module doc). Uses standard
    deviations, so per-frame detector jitter does not add up over time."""
    if len(states) < 5:
        return 0.0
    t = np.array([s.timestamp for s in states], dtype=np.float64)
    t -= t[0]
    if t[-1] <= 0:
        return 0.0
    cx = np.array([s.center[0] for s in states])
    cy = np.array([s.center[1] for s in states])
    widths = np.array([s.width for s in states])
    heights = np.array([s.height for s in states])
    height = float(np.median(heights)) or 1.0

    def residual(values: np.ndarray) -> np.ndarray:
        return values - np.polyval(np.polyfit(t, values, 2), t)

    centre_spread = math.hypot(float(np.std(residual(cx))), float(np.std(residual(cy))))
    shape_spread = float(np.std(widths)) + float(np.std(heights))
    return (centre_spread + shape_spread) / height


def _nearest(states: Sequence[TrackState], when: float, tolerance: float) -> Optional[TrackState]:
    best = min(states, key=lambda s: abs(s.timestamp - when), default=None)
    if best is None or abs(best.timestamp - when) > tolerance:
        return None
    return best


class InteractionValidator:
    def __init__(self, cfg: Optional[dict] = None):
        cfg = cfg or {}
        self.enabled = bool(cfg.get("enabled", True))
        self.active_track_seconds = float(cfg.get("active_track_seconds", 1.0))
        self.duplicate_iou = float(cfg.get("duplicate_iou", 0.7))
        self.proximity_heights = float(cfg.get("proximity_heights", 1.2))
        self.min_interaction_seconds = float(cfg.get("min_interaction_seconds", 1.0))
        self.lookback_seconds = float(cfg.get("lookback_seconds", 3.0))
        self.min_agitation = float(cfg.get("min_agitation_heights", 0.1))
        self.merged_hold_seconds = float(cfg.get("merged_hold_seconds", 2.0))
        self._last_valid: Optional[Tuple[float, dict]] = None

    def pair_evidence(self, a: TrackHistory, b: TrackHistory, now: float) -> dict:
        start = now - self.lookback_seconds
        sa = _resample(a.states, start)
        sb = [s for s in b.states if s.timestamp >= start - SAMPLE_STEP_S]
        close_samples, distances = 0, []
        for state in sa:
            other = _nearest(sb, state.timestamp, SAMPLE_STEP_S)
            if other is None:
                continue
            mean_height = max((state.height + other.height) / 2.0, 1.0)
            distance = math.dist(state.center, other.center) / mean_height
            distances.append(distance)
            if distance <= self.proximity_heights:
                close_samples += 1
        agitation_a = agitation([s for s in a.states if s.timestamp >= start])
        agitation_b = agitation([s for s in b.states if s.timestamp >= start])
        return {
            "track_ids": [a.track_id, b.track_id],
            "close_seconds": round(close_samples * SAMPLE_STEP_S, 2),
            "min_distance_heights": round(float(min(distances)), 2) if distances else None,
            "agitation": round(float(max(agitation_a, agitation_b)), 3),
        }

    def validate(self, buffer: TemporalBuffer, now: Optional[float] = None) -> Tuple[bool, dict]:
        """(is_interaction, evidence). Evidence is logged and stored in the incident."""
        if not self.enabled:
            return True, {"reason": "interaction check disabled"}
        if now is None:
            now = buffer.latest_timestamp()
        if now is None:
            return False, {"reason": "no people tracked"}
        people = distinct_people(
            buffer.active_tracks_by_class("person", self.active_track_seconds, now), self.duplicate_iou)
        best = None
        for a, b in combinations(people, 2):
            evidence = self.pair_evidence(a, b, now)
            evidence["close_enough"] = evidence["close_seconds"] >= self.min_interaction_seconds
            evidence["agitated"] = evidence["agitation"] >= self.min_agitation
            if evidence["close_enough"] and evidence["agitated"]:
                evidence["reason"] = "two people close together with agitated motion"
                self._last_valid = (now, evidence)
                return True, evidence
            rank = (evidence["close_enough"], evidence["close_seconds"], evidence["agitation"])
            if best is None or rank > best[0]:
                best = (rank, evidence)
        if self._last_valid is not None and now - self._last_valid[0] <= self.merged_hold_seconds:
            evidence = dict(self._last_valid[1], reason="pair qualified moments ago (people may be merged into one box)")
            return True, evidence
        if len(people) < 2:
            return False, {"reason": f"{len(people)} distinct person(s) in view; a fight needs two",
                           "people_in_view": len(people)}
        evidence = best[1]
        if not evidence["close_enough"]:
            evidence["reason"] = (f"people were close for {evidence['close_seconds']}s "
                                  f"(< {self.min_interaction_seconds}s within {self.lookback_seconds}s)")
        else:
            evidence["reason"] = (f"motion is not agitated (agitation {evidence['agitation']} "
                                  f"< {self.min_agitation} body heights): normal walking/standing")
        return False, evidence
