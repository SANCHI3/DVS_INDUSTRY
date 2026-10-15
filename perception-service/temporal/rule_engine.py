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
from typing import Any, Dict, List, Optional, Tuple

from temporal.geometry import point_in_polygon
from temporal.zones import loitering_zones, zone_is_active, zone_label
from temporal.temporal_buffer import TemporalBuffer, TrackHistory


@dataclass
class EventCandidate:
    event_type: str
    track_ids: List[int]
    camera_id: str
    zone_id: Optional[str] = None
    detail: Dict[str, Any] = field(default_factory=dict)
    raw_confidence: float = 0.6  # rule-based signals get a fixed/derived confidence, not a learned score


@dataclass
class _DwellState:
    entered_at: float          # timestamp of the first sighting inside the zone
    last_inside: float         # timestamp of the latest sighting inside
    last_processed: float      # newest observation already counted
    observations: int = 0      # sightings during this visit (inside or briefly outside)
    inside: int = 0            # sightings inside the zone
    confidence_sum: float = 0.0


class RuleEngine:
    def __init__(self, camera_config: dict, thresholds: dict):
        self.camera_id = camera_config["id"]
        self.zones = camera_config.get("zones", [])
        self.rules_cfg = thresholds["rules"]
        # Per-camera, scene-level state used by the crowd rule.  Keeping this
        # here makes sustained_seconds a real duration instead of a frame count.
        self._crowd_state: Dict[str, Any] = {}
        # (track_id, zone_id) -> dwell bookkeeping for the loitering rule
        self._dwell: Dict[Tuple[int, str], _DwellState] = {}
        self._rejection_logged: Dict[str, float] = {}

    def evaluate(self, buffer: TemporalBuffer) -> List[EventCandidate]:
        candidates: List[EventCandidate] = []
        candidates += self._check_intrusion(buffer)
        candidates += self._check_loitering(buffer)
        candidates += self._check_crowd(buffer)
        candidates += self._check_fall(buffer)
        return candidates

    def _active_people(self, buffer: TemporalBuffer, key: str) -> List[TrackHistory]:
        max_age = float(self.rules_cfg.get(key, {}).get("active_track_seconds", 1.0))
        return buffer.active_tracks_by_class("person", max_age_s=max_age)

    # ---- Intrusion -----------------------------------------------------
    def _check_intrusion(self, buffer: TemporalBuffer) -> List[EventCandidate]:
        """A person whose foot point has been inside an active restricted zone
        for the last `min_frames_inside` observations. Only people in view now
        count (not tracks kept in the buffer after they left)."""
        intrusion_cfg = self.rules_cfg["intrusion"]
        if not intrusion_cfg.get("enabled", True):
            return []
        min_frames = int(intrusion_cfg["min_frames_inside"])
        out = []
        for person in self._active_people(buffer, "intrusion"):
            now = person.last_seen
            for zone in self.zones:
                if zone.get("type") != "restricted" or not zone_is_active(zone, now):
                    continue
                recent = list(person.states)[-min_frames:]
                if len(recent) < min_frames or not all(
                        point_in_polygon(s.foot_point, zone["polygon"]) for s in recent):
                    continue
                detector_conf = sum(s.confidence for s in recent) / len(recent)
                out.append(EventCandidate(
                    event_type="intrusion",
                    track_ids=[person.track_id],
                    camera_id=self.camera_id,
                    zone_id=zone["zone_id"],
                    detail={"zone_type": zone["type"], "zone_name": zone.get("name"),
                            "frames_inside": len(recent),
                            "confidence_basis": "mean person-detector confidence while inside the zone"},
                    raw_confidence=round(detector_conf, 3),
                ))
        return out

    # ---- Loitering -------------------------------------------------------
    def _update_dwell(self, person: TrackHistory, zone: dict, exit_grace: float) -> Optional[_DwellState]:
        """Advance the per-(track, zone) dwell state with the observations made
        since the last call. Dwell is measured from observation timestamps, so
        it only grows while the person is actually seen inside the zone."""
        key = (person.track_id, zone["zone_id"])
        state = self._dwell.get(key)
        for obs in person.states:
            if state is not None and obs.timestamp <= state.last_processed:
                continue
            inside = point_in_polygon(obs.foot_point, zone["polygon"])
            if state is None:
                if not inside:
                    continue
                state = _DwellState(entered_at=obs.timestamp, last_inside=obs.timestamp,
                                    last_processed=obs.timestamp)
            # A gap in observations (person hidden / track lost) or time spent
            # outside the zone longer than the grace period ends the visit.
            if obs.timestamp - state.last_inside > exit_grace:
                if not inside:
                    state = None
                    continue
                state = _DwellState(entered_at=obs.timestamp, last_inside=obs.timestamp,
                                    last_processed=obs.timestamp)
            state.last_processed = obs.timestamp
            state.observations += 1
            if inside:
                state.inside += 1
                state.last_inside = obs.timestamp
                state.confidence_sum += obs.confidence
        if state is None:
            self._dwell.pop(key, None)
        else:
            self._dwell[key] = state
        return state

    def _check_loitering(self, buffer: TemporalBuffer) -> List[EventCandidate]:
        """Lingering = one tracked person staying inside an active
        restricted/loitering zone for at least the zone's dwell threshold.

        Fixed false positives (see docs/FALSE_POSITIVE_FIXES.md):
        - only people in view now count; buffered "ghost" tracks of people who
          already left never accumulate dwell time;
        - dwell is the time between observed sightings inside the zone, with
          a short exit grace for detector flicker -- not wall-clock time since
          a single first sighting;
        - the person must have been inside for most of the visit
          (`min_inside_fraction`), so boundary flicker does not count;
        - per-zone `loitering_seconds` and `active_hours` are honoured;
        - confidence is the measured person-detector confidence, not a
          number that grows with the dwell time."""
        cfg = self.rules_cfg["loitering"]
        default_dwell = float(cfg["dwell_seconds"])
        exit_grace = float(cfg.get("exit_grace_seconds", 2.0))
        min_fraction = float(cfg.get("min_inside_fraction", 0.8))
        zones = loitering_zones(self.zones)
        people = self._active_people(buffer, "loitering")
        live_keys = set()
        out = []
        for person in people:
            now = person.last_seen
            for zone in zones:
                live_keys.add((person.track_id, zone["zone_id"]))
                state = self._update_dwell(person, zone, exit_grace)
                if state is None or not zone_is_active(zone, now):
                    continue
                # Still inside right now (allowing the short exit grace)?
                if now - state.last_inside > exit_grace:
                    continue
                dwell = state.last_inside - state.entered_at
                threshold = float(zone.get("loitering_seconds", default_dwell))
                inside_fraction = state.inside / max(state.observations, 1)
                if dwell < threshold:
                    continue
                if inside_fraction < min_fraction:
                    self._log_rejection(
                        f"loitering:{person.track_id}:{zone['zone_id']}",
                        f"loitering rejected: track {person.track_id} in zone {zone_label(zone)} only "
                        f"{inside_fraction:.0%} of {dwell:.0f}s (needs {min_fraction:.0%})")
                    continue
                detector_conf = state.confidence_sum / max(state.inside, 1)
                out.append(EventCandidate(
                    event_type="loitering",
                    track_ids=[person.track_id],
                    camera_id=self.camera_id,
                    zone_id=zone["zone_id"],
                    detail={
                        "dwell_seconds": round(dwell, 1),
                        "dwell_threshold_seconds": threshold,
                        "zone_type": zone.get("type"),
                        "zone_name": zone.get("name"),
                        "inside_fraction": round(inside_fraction, 2),
                        "observations": state.observations,
                        "confidence_basis": "mean person-detector confidence while inside the zone "
                                            "x share of the visit spent inside",
                    },
                    raw_confidence=round(detector_conf * inside_fraction, 3),
                ))
        # Forget dwell state of people no longer in view.
        for key in [k for k in self._dwell if k not in live_keys]:
            del self._dwell[key]
        return out

    def _log_rejection(self, key: str, message: str, every_s: float = 10.0) -> None:
        now = time.time()
        if now - self._rejection_logged.get(key, 0.0) >= every_s:
            self._rejection_logged[key] = now
            print(f"[{self.camera_id}] {message}")

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
        # Measured evidence, not a formula: mean person-detector confidence of
        # the people forming the group (kept from the last positive cycle).
        if count >= threshold:
            state["detector_confidence"] = sum(p.states[-1].confidence for p in best_group) / len(best_group)
        confidence = round(float(state.get("detector_confidence", 0.0)), 3)
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
                "confidence_basis": "mean person-detector confidence of the group",
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
                        "confidence_basis": "mean person-detector confidence while down "
                                            "(box-shape rule has no probability of its own)",
                    },
                    raw_confidence=round(sum(st.confidence for st in fallen_run) / len(fallen_run), 3),
                ))
        return out
