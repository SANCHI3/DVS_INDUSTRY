"""Live fall detection with the pose-sequence GRU model (fall_gru/).

Per tracked person, every processed frame contributes one feature row:
box features from the tracker plus skeleton features when YOLOv8-pose finds
a matching person. Each person's last `window` rows are scored by the model;
an alert needs `required_hits` of the last `persistence_window` evaluations
above the threshold, and each person has a cooldown so one fall raises one
incident.

After a fall, the person is watched: if they are still down (torso not
upright) `serious_after_seconds` later, a second "serious" fall candidate is
raised so the incident escalates. Getting up -- or sitting up -- for
`recovered_after_seconds` cancels the watch.
"""
from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass
from typing import Deque, Dict, Optional, Tuple

import numpy as np

from detection.pose_estimator import PoseEstimator
from fall_gru.features import build_sequence, frame_features
from fall_gru.model import FallClassifier
from temporal.fight_features import match_pose_to_bbox
from temporal.rule_engine import EventCandidate
from temporal.temporal_buffer import TemporalBuffer


@dataclass
class DownWatch:
    """A fallen person being watched for whether they get back up."""
    track_id: int
    bbox: Tuple[float, float, float, float]
    fell_at: float
    last_seen_down_at: float
    score: float
    upright_since: Optional[float] = None
    escalated: bool = False


def is_upright(row: np.ndarray, max_torso_tilt: float, max_box_aspect: float) -> bool:
    """Torso near vertical (pose), or a tall box when no skeleton was found.
    Sitting up counts as upright: the person is conscious and moving."""
    if row[9] > 0:  # pose_present
        return float(row[4]) <= max_torso_tilt
    return float(row[0]) <= max_box_aspect


def fall_plausibility(row: np.ndarray, bottom_edge: float, require_down: bool,
                     max_torso_tilt: float, max_box_aspect: float) -> Optional[str]:
    """Why a high fall score cannot be a real fall right now, or None if it can.

    * truncated: the box reaches the bottom edge of the frame and no torso
      (shoulders + hips) was found -- the person is only partly in view, e.g.
      sitting close to a desk webcam. A head-and-shoulders box is wide and
      short, which looks like a lying person to the model.
    * upright: the person is standing or sitting upright at this moment.

    Not rejected for good: the next evaluation checks again, so a real fall
    that is still in progress passes once the person is down and in view.
    On the 160 labelled fall-dataset videos, the truncation rule leaves a
    passing frame in 79/79 falls, and with require_down in 77/79.
    """
    if float(row[3]) >= bottom_edge and row[9] == 0:
        return "truncated"
    if require_down and is_upright(row, max_torso_tilt, max_box_aspect):
        return "upright"
    return None


class GruFallDetector:
    def __init__(self, camera_id: str, cfg: dict, pose_estimator: Optional[PoseEstimator] = None):
        self.camera_id = camera_id
        self.classifier = FallClassifier(cfg["checkpoint"])
        self.threshold = float(cfg.get("threshold", self.classifier.threshold))
        self.window = self.classifier.window
        self.pose_stride = int(cfg.get("pose_stride_frames", 1))
        self.evaluation_stride = int(cfg.get("evaluation_stride_frames", 3))
        self.persistence_window = int(cfg.get("persistence_window", 3))
        self.required_hits = int(cfg.get("required_hits", 2))
        self.cooldown_seconds = float(cfg.get("cooldown_seconds", 30.0))
        self.max_people = int(cfg.get("max_people_for_pose", 12))
        self.pose = pose_estimator or PoseEstimator(cfg.get("pose_model_path", "yolov8n-pose.pt"))
        serious_cfg = cfg.get("serious") or {}
        self.serious_after = float(serious_cfg.get("after_seconds", 20.0))
        self.recovered_after = float(serious_cfg.get("recovered_after_seconds", 2.0))
        self.max_unseen = float(serious_cfg.get("max_unseen_seconds", 5.0))
        self.upright_tilt = float(serious_cfg.get("upright_torso_tilt", 0.35))  # ~31 degrees
        self.upright_aspect = float(serious_cfg.get("upright_box_aspect", 0.8))
        verify_cfg = cfg.get("verification") or {}
        self.verify = bool(verify_cfg.get("enabled", False))
        self.bottom_edge = float(verify_cfg.get("bottom_edge", 0.99))
        self.require_down = bool(verify_cfg.get("require_down", True))

        self.rows: Dict[int, Deque[Optional[np.ndarray]]] = {}
        self.hits: Dict[int, Deque[bool]] = {}
        self.cooldown_until: Dict[int, float] = {}
        self.watches: Dict[int, DownWatch] = {}
        self.cycles = 0
        self._stats = {"cycles": 0, "pose_runs": 0, "evaluations": 0,
                       "high_scores": 0, "candidates": 0, "max_score": 0.0,
                       "recovered": 0, "serious": 0,
                       "rejected_truncated": 0, "rejected_upright": 0}
        print(f"[{camera_id}] pose fall model loaded: {cfg['checkpoint']} threshold={self.threshold:.2f}")

    def evaluate(self, buffer: TemporalBuffer, frame) -> list:
        self.cycles += 1
        self._stats["cycles"] += 1
        now = time.time()
        people = [p for p in buffer.tracks_by_class("person") if p.states and p.last_seen >= now - 1.0]
        live_ids = {p.track_id for p in people}
        for track_id in list(self.rows):
            if track_id not in live_ids:
                self.rows.pop(track_id, None)
                self.hits.pop(track_id, None)
        if not people:
            return []

        poses = []
        if self.cycles % self.pose_stride == 0 and len(people) <= self.max_people:
            poses = self.pose.estimate(frame)
            self._stats["pose_runs"] += 1

        frame_h = frame.shape[0]
        for person in people:
            bbox = person.states[-1].bbox
            pose = match_pose_to_bbox(poses, bbox) if poses else None
            row = frame_features(pose.bbox if pose else bbox, frame_h,
                                 pose.keypoints if pose else None)
            self.rows.setdefault(person.track_id, deque(maxlen=self.window)).append(row)

        candidates = self._update_watches(people, now)

        if self.cycles % self.evaluation_stride != 0:
            return candidates

        for person in people:
            if person.track_id in self.watches:
                continue  # already fallen and being watched -- not a new fall
            rows = self.rows.get(person.track_id)
            if rows is None or len(rows) < self.window // 2:
                continue
            seq = build_sequence(list(rows), self.classifier.fps)
            score = self.classifier.score(seq)
            self._stats["evaluations"] += 1
            self._stats["max_score"] = max(self._stats["max_score"], score)
            history = self.hits.setdefault(person.track_id, deque(maxlen=self.persistence_window))
            history.append(score >= self.threshold)
            if score < self.threshold:
                continue
            self._stats["high_scores"] += 1
            if sum(history) < self.required_hits or now < self.cooldown_until.get(person.track_id, 0.0):
                continue
            latest = rows[-1]
            if self.verify and latest is not None:
                reason = fall_plausibility(latest, self.bottom_edge, self.require_down,
                                           self.upright_tilt, self.upright_aspect)
                if reason:
                    self._stats[f"rejected_{reason}"] += 1
                    continue  # no cooldown: checked again at the next evaluation
            self.cooldown_until[person.track_id] = now + self.cooldown_seconds
            self.watches[person.track_id] = DownWatch(
                person.track_id, tuple(person.states[-1].bbox), now, now, score
            )
            self._stats["candidates"] += 1
            candidates.append(EventCandidate(
                event_type="fall",
                track_ids=[person.track_id],
                camera_id=self.camera_id,
                detail={"mode": "pose_gru", "score": round(score, 3),
                        **({"box_bottom": round(float(latest[3]), 2), "torso_found": bool(latest[9]),
                            "torso_tilt": round(float(latest[4]), 2), "box_aspect": round(float(latest[0]), 2)}
                           if latest is not None else {})},
                raw_confidence=score,
            ))
        return candidates

    def _find_watched_person(self, watch: DownWatch, people: list, taken: set):
        """Same track, or -- after a tracker ID switch -- the nearest person at
        the spot where the fall happened."""
        for person in people:
            if person.track_id == watch.track_id:
                return person
        x1, y1, x2, y2 = watch.bbox
        cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
        radius = 0.75 * max(x2 - x1, y2 - y1)
        best, best_d = None, radius
        for person in people:
            if person.track_id in taken:
                continue
            bx1, by1, bx2, by2 = person.states[-1].bbox
            d = float(np.hypot((bx1 + bx2) / 2 - cx, (by1 + by2) / 2 - cy))
            if d <= best_d:
                best, best_d = person, d
        return best

    def _update_watches(self, people: list, now: float) -> list:
        candidates = []
        updated: Dict[int, DownWatch] = {}
        taken = set(self.watches)
        for watch in self.watches.values():
            person = self._find_watched_person(watch, people, taken)
            if person is not None:
                taken.add(person.track_id)
                watch.track_id = person.track_id
                watch.bbox = tuple(person.states[-1].bbox)
                rows = self.rows.get(person.track_id)
                if rows and rows[-1] is not None and is_upright(rows[-1], self.upright_tilt, self.upright_aspect):
                    watch.upright_since = watch.upright_since or now
                    if now - watch.upright_since >= self.recovered_after:
                        self._stats["recovered"] += 1
                        continue  # got back up -- watch over
                else:
                    watch.upright_since = None
                    watch.last_seen_down_at = now
            elif now - watch.last_seen_down_at > self.max_unseen:
                continue  # left the scene; we can no longer tell

            down_for = now - watch.fell_at
            if not watch.escalated and down_for >= self.serious_after and watch.upright_since is None:
                # Escalate once, but keep watching: while this person stays
                # down they must not trigger a fresh "new fall" incident.
                watch.escalated = True
                self._stats["serious"] += 1
                candidates.append(EventCandidate(
                    event_type="fall",
                    track_ids=[watch.track_id],
                    camera_id=self.camera_id,
                    detail={"mode": "pose_gru", "score": round(watch.score, 3),
                            "serious": True, "down_seconds": round(down_for, 1),
                            "requested_tier": "CONFIRMED"},
                    raw_confidence=watch.score,
                ))
            updated[watch.track_id] = watch
        self.watches = updated
        return candidates

    def diagnostics(self) -> dict:
        return dict(self._stats, tracked_people=len(self.rows), threshold=self.threshold)
