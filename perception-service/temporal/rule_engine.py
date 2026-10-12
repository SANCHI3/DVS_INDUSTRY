"""
Rule-based event candidate generation, evaluated every processing cycle
against the current TemporalBuffer for a camera. This is the cheap, fast
path described in the design doc -- pure geometry/kinematics on top of
YOLO + ByteTrack, no extra model inference.

Each rule returns zero or more EventCandidate objects. Candidates are NOT
incidents yet -- they still have to pass through event confirmation
(confirmation/event_confirmation.py) before becoming Confirmed/Probable.
"""
from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from temporal.geometry import point_in_polygon
from temporal.temporal_buffer import TemporalBuffer, TrackHistory


@dataclass
class EventCandidate:
    event_type: str
    track_ids: List[int]
    camera_id: str
    zone_id: Optional[str] = None
    detail: Dict[str, Any] = field(default_factory=dict)
    raw_confidence: float = 0.6  # rule-based signals get a fixed/derived confidence, not a learned score


class RuleEngine:
    def __init__(self, camera_config: dict, thresholds: dict):
        self.camera_id = camera_config["id"]
        self.zones = camera_config.get("zones", [])
        self.rules_cfg = thresholds["rules"]
        # Per-camera, scene-level state used by the crowd rule.  Keeping this
        # here makes sustained_seconds a real duration instead of a frame count.
        self._crowd_state: Dict[str, Any] = {}

    def evaluate(self, buffer: TemporalBuffer) -> List[EventCandidate]:
        candidates: List[EventCandidate] = []
        candidates += self._check_intrusion(buffer)
        candidates += self._check_loitering(buffer)
        candidates += self._check_crowd(buffer)
        candidates += self._check_fall(buffer)
        return candidates

    # ---- Intrusion -----------------------------------------------------
    def _check_intrusion(self, buffer: TemporalBuffer) -> List[EventCandidate]:
        """Also maintains per-person zone entry times, which loitering reads --
        so it always runs, and `rules.intrusion.enabled: false` only stops it
        from raising intrusion candidates."""
        out = []
        restricted_zones = [z for z in self.zones if z["type"] == "restricted"]
        if not restricted_zones:
            return out

        intrusion_cfg = self.rules_cfg["intrusion"]
        report_intrusion = intrusion_cfg.get("enabled", True)
        min_frames = intrusion_cfg["min_frames_inside"]

        for person in buffer.tracks_by_class("person"):
            for zone in restricted_zones:
                foot = person.states[-1].foot_point
                inside_now = point_in_polygon(foot, zone["polygon"])
                if not inside_now:
                    person.zone_entry_times.pop(zone["zone_id"], None)
                    continue

                if zone["zone_id"] not in person.zone_entry_times:
                    person.zone_entry_times[zone["zone_id"]] = time.time()
                if not report_intrusion:
                    continue

                # count how many of the last few states were also inside -- filters
                # single-frame detection flicker right at the zone boundary
                recent = list(person.states)[-min_frames:]
                inside_count = sum(1 for s in recent if point_in_polygon(s.foot_point, zone["polygon"]))
                if inside_count >= min_frames:
                    out.append(EventCandidate(
                        event_type="intrusion",
                        track_ids=[person.track_id],
                        camera_id=self.camera_id,
                        zone_id=zone["zone_id"],
                        detail={"zone_type": zone["type"]},
                        raw_confidence=0.85,
                    ))
        return out

    # ---- Loitering -------------------------------------------------------
    def _check_loitering(self, buffer: TemporalBuffer) -> List[EventCandidate]:
        out = []
        dwell_threshold = self.rules_cfg["loitering"]["dwell_seconds"]
        now = time.time()

        for person in buffer.tracks_by_class("person"):
            for zone_id, entry_time in person.zone_entry_times.items():
                dwell = now - entry_time
                if dwell >= dwell_threshold:
                    out.append(EventCandidate(
                        event_type="loitering",
                        track_ids=[person.track_id],
                        camera_id=self.camera_id,
                        zone_id=zone_id,
                        detail={"dwell_seconds": round(dwell, 1)},
                        raw_confidence=min(0.5 + dwell / (dwell_threshold * 4), 0.95),
                    ))
        return out

    # ---- Crowd gathering ---------------------------------------------
    @staticmethod
    def _largest_person_cluster(persons: List[TrackHistory], cfg: dict) -> List[TrackHistory]:
        """Return the largest spatially connected group of people.

        Distance is scaled by bounding-box height so the same starter values
        work reasonably well for near and far parts of a CCTV image.  This is
        intentionally explainable and dependency-free; it can later be
        replaced by calibrated ground-plane clustering for a fixed camera.
        """
        if not persons:
            return []

        height_factor = float(cfg.get("proximity_height_factor", 1.5))
        min_px = float(cfg.get("min_proximity_px", 55))
        max_px = float(cfg.get("max_proximity_px", 180))
        neighbours = {i: set() for i in range(len(persons))}

        for i, a in enumerate(persons):
            ax, ay = a.states[-1].foot_point
            ah = max(a.states[-1].height, 1.0)
            for j in range(i + 1, len(persons)):
                b = persons[j]
                bx, by = b.states[-1].foot_point
                bh = max(b.states[-1].height, 1.0)
                allowed = height_factor * ((ah + bh) / 2.0)
                allowed = max(min_px, min(max_px, allowed))
                if math.hypot(ax - bx, ay - by) <= allowed:
                    neighbours[i].add(j)
                    neighbours[j].add(i)

        largest: List[int] = []
        unseen = set(neighbours)
        while unseen:
            seed = unseen.pop()
            component = [seed]
            stack = [seed]
            while stack:
                current = stack.pop()
                linked = neighbours[current] & unseen
                unseen.difference_update(linked)
                stack.extend(linked)
                component.extend(linked)
            if len(component) > len(largest):
                largest = component

        return [persons[i] for i in largest]

    def _check_crowd(self, buffer: TemporalBuffer) -> List[EventCandidate]:
        cfg = self.rules_cfg["crowd"]
        threshold = int(cfg["person_count_threshold"])
        sustained_needed = float(cfg.get("sustained_seconds", 5.0))
        active_seconds = float(cfg.get("active_track_seconds", 1.0))
        min_track_age = float(cfg.get("minimum_track_age_seconds", 0.5))
        min_confidence = float(cfg.get("minimum_person_confidence", 0.35))
        exit_grace = float(cfg.get("exit_grace_seconds", 2.0))

        all_persons = buffer.tracks_by_class("person")
        # In the live pipeline, at least one track is updated on the current
        # cycle.  Its timestamp gives us a testable clock while excluding
        # ByteTrack histories that remain buffered after a person disappears.
        now = max((p.last_seen for p in all_persons), default=time.time())
        active = [
            p for p in all_persons
            if now - p.last_seen <= active_seconds
            and now - p.first_seen >= min_track_age
            and p.states[-1].confidence >= min_confidence
        ]

        # A camera may define an explicit crowd area with either type: crowd
        # or crowd_enabled: true.  Without one, evaluate the whole frame.
        crowd_zones = [
            z for z in self.zones
            if z.get("type") == "crowd" or z.get("crowd_enabled") is True
        ]
        regions = []
        if crowd_zones:
            for zone in crowd_zones:
                members = [
                    p for p in active
                    if point_in_polygon(p.states[-1].foot_point, zone["polygon"])
                ]
                regions.append((zone.get("zone_id", "crowd-zone"), members))
        else:
            regions.append(("full-frame", active))

        best_region = "full-frame"
        best_group: List[TrackHistory] = []
        for region_id, members in regions:
            group = self._largest_person_cluster(members, cfg)
            if len(group) > len(best_group):
                best_region, best_group = region_id, group

        count = len(best_group)
        state = self._crowd_state
        if count >= threshold:
            ids = sorted(p.track_id for p in best_group)
            if state.get("started_at") is None:
                state["started_at"] = now
            state.update({
                "last_positive_at": now,
                "last_count": count,
                "last_track_ids": ids,
                "region_id": best_region,
            })
            sustained = max(0.0, now - state["started_at"])
            if sustained < sustained_needed:
                return []
            state["emitted"] = True
        else:
            last_positive = state.get("last_positive_at")
            # Preserve an already-established episode across brief detector or
            # tracker flicker.  Do not use grace time to establish a new crowd.
            if not state.get("emitted") or last_positive is None or now - last_positive > exit_grace:
                self._crowd_state = {}
                return []
            sustained = max(0.0, last_positive - state.get("started_at", last_positive))
            ids = state.get("last_track_ids", [])
            best_region = state.get("region_id", "full-frame")

        reported_count = int(state.get("last_count", count))
        overflow = max(0, reported_count - threshold)
        duration_bonus = min(max(0.0, sustained - sustained_needed) * 0.015, 0.12)
        confidence = min(0.62 + overflow * 0.07 + duration_bonus, 0.95)
        return [EventCandidate(
            event_type="crowd",
            track_ids=ids,
            camera_id=self.camera_id,
            zone_id=None if best_region == "full-frame" else best_region,
            detail={
                "count": reported_count,
                "observed_count": count,
                "threshold": threshold,
                "sustained_seconds": round(sustained, 1),
                "region_id": best_region,
                "clustered": True,
                "within_exit_grace": count < threshold,
            },
            raw_confidence=confidence,
        )]

    # ---- Fall (aspect-ratio flip + stillness heuristic) ------------------
    def _check_fall(self, buffer: TemporalBuffer) -> List[EventCandidate]:
        """
        A fall candidate requires two things, evaluated separately so the
        "was standing then flipped" check and the "has stayed down" check
        don't fight over the same time window:
          1. A transition: a standing (tall, ar<0.8) state shortly followed
             by a fallen (wide, ar>1.2) state, within `flip_window` seconds.
          2. Persistence: the person has remained in that fallen pose,
             roughly stationary, for at least `stillness_seconds` since the
             transition -- NOT measured against the whole rolling buffer
             (which would still contain the pre-fall standing states and
             could never satisfy "stillness").
        """
        out = []
        cfg = self.rules_cfg["fall"]
        flip_window = cfg["aspect_ratio_flip_seconds"]
        stillness_needed = cfg["stillness_seconds"]

        for person in buffer.tracks_by_class("person"):
            states = list(person.states)
            if len(states) < 2:
                continue

            last = states[-1]
            if last.aspect_ratio <= 1.2:
                continue  # not currently in a "fallen" pose

            # walk backwards to find the contiguous run of "fallen" states
            fallen_run = []
            for s in reversed(states):
                if s.aspect_ratio > 1.2:
                    fallen_run.append(s)
                else:
                    break
            fallen_run.reverse()
            onset = fallen_run[0]

            # require a standing state shortly before the fall onset -- this
            # is what distinguishes "just fell" from "has been lying/sitting
            # there the whole time" (e.g. a bench, not an incident)
            pre_onset = [s for s in states if onset.timestamp - flip_window <= s.timestamp < onset.timestamp]
            was_standing_before = any(s.aspect_ratio < 0.8 for s in pre_onset)
            if not was_standing_before:
                continue

            duration_fallen = last.timestamp - onset.timestamp
            xs = [s.center[0] for s in fallen_run]
            ys = [s.center[1] for s in fallen_run]
            stayed_put = (max(xs) - min(xs) <= 8.0) and (max(ys) - min(ys) <= 8.0)

            if stayed_put and duration_fallen >= stillness_needed:
                out.append(EventCandidate(
                    event_type="fall",
                    track_ids=[person.track_id],
                    camera_id=self.camera_id,
                    detail={
                        "aspect_ratio_before": round(pre_onset[-1].aspect_ratio, 2) if pre_onset else None,
                        "aspect_ratio_after": round(last.aspect_ratio, 2),
                        "still_seconds": round(duration_fallen, 1),
                    },
                    raw_confidence=0.7,
                ))
        return out
