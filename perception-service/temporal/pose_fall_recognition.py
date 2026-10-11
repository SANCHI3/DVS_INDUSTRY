"""Pose-based fall detection at run time.

Replaces the bounding-box aspect-ratio rule with a learned classifier on
body-keypoint dynamics (see fall_rf/features.py and fall_rf/train.py).

Cost control (pose estimation is the expensive part):
- While people are visible but nothing looks unusual, pose runs only every
  `idle_stride_frames` cycles, so a short pre-fall history is always available.
- A cheap gate on the existing ByteTrack boxes (sudden height loss, widening box,
  fast downward motion) switches pose to every cycle for `gate_hold_seconds`.

Decision:
- Each tracked person keeps a ~2-second pose history.
- The window is scored by the trained model (mode "model") or by the
  training-free physics score (mode "physics", used automatically when the
  checkpoint is missing).
- `required_hits` positive windows out of the last `persistence_window`
  produce a PROBABLE fall; if the person is still down after
  `confirm_still_seconds` it becomes CONFIRMED.
"""
from __future__ import annotations

import os
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Deque, Dict, List, Optional

import numpy as np

from fall_rf.features import FEATURE_NAMES, PoseSample, explain, physics_score, window_features
from temporal.rule_engine import EventCandidate
from temporal.temporal_buffer import TemporalBuffer, TrackHistory


def _iou(a, b) -> float:
    x1, y1, x2, y2 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def _match_pose(poses, bbox, min_iou: float = 0.1):
    """Associate a pose detection with a ByteTrack person box by IoU."""
    best, best_iou = None, min_iou
    for pose in poses:
        score = _iou(pose.bbox, bbox)
        if score > best_iou:
            best, best_iou = pose, score
    return best


@dataclass
class _TrackFallState:
    poses: Deque[PoseSample] = field(default_factory=lambda: deque(maxlen=64))
    scores: Deque[float] = field(default_factory=lambda: deque(maxlen=8))
    first_positive_at: Optional[float] = None
    episode_peak: float = 0.0
    last_seen_at: float = 0.0


class PoseFallDetector:
    def __init__(self, camera_id: str, cfg: dict, pose_estimator=None):
        self.camera_id = camera_id
        self.cfg = cfg
        self.window_seconds = float(cfg.get("window_seconds", 2.0))
        self.idle_stride = max(1, int(cfg.get("idle_stride_frames", 3)))
        self.eval_stride = max(1, int(cfg.get("evaluation_stride_frames", 2)))
        self.gate_hold = float(cfg.get("gate_hold_seconds", 4.0))
        self.persistence_window = max(1, int(cfg.get("persistence_window", 3)))
        self.required = max(1, int(cfg.get("required_hits", 2)))
        self.confirm_still = float(cfg.get("confirm_still_seconds", 3.0))
        gate = cfg.get("gate", {})
        self.gate_height_drop = float(gate.get("height_drop_ratio", 0.20))
        self.gate_aspect = float(gate.get("aspect_ratio", 0.90))
        self.gate_down_speed = float(gate.get("down_speed_heights_per_s", 0.5))

        self.mode = cfg.get("mode", "model")
        self.threshold = float(cfg.get("physics_threshold", 0.75))
        self._model = None
        checkpoint = cfg.get("checkpoint")
        if self.mode == "model":
            if checkpoint and os.path.exists(checkpoint):
                from fall_rf.infer import FallClassifier
                self._model = FallClassifier(checkpoint)
                if cfg.get("use_checkpoint_threshold", True):
                    self.threshold = self._model.threshold
                else:
                    self.threshold = float(cfg.get("threshold", self._model.threshold))
            else:
                print(f"[{camera_id}] fall checkpoint '{checkpoint}' not found -> using physics score")
                self.mode = "physics"
        self._pose_estimator = pose_estimator
        self._pose_model_path = cfg.get("pose_model_path", "yolov8n-pose.pt")
        self._tracks: Dict[int, _TrackFallState] = {}
        self._gate_until = 0.0
        self.cycles = 0
        self._stats = {"cycles": 0, "pose_runs": 0, "gate_open_cycles": 0, "evaluations": 0,
                       "candidates": 0, "max_score": 0.0}
        print(f"[{camera_id}] pose fall detector: mode={self.mode} threshold={self.threshold:.2f} "
              f"persistence={self.required}/{self.persistence_window}")

    # ----------------------------------------------------------------- pose
    def _get_pose_estimator(self):
        if self._pose_estimator is None:
            from detection.pose_estimator import PoseEstimator
            self._pose_estimator = PoseEstimator(self._pose_model_path)
        return self._pose_estimator

    # ----------------------------------------------------------------- gate
    def _suspicious(self, person: TrackHistory, now: float) -> bool:
        recent = [s for s in person.states if s.timestamp >= now - 2.0]
        if len(recent) < 2:
            return False
        last = recent[-1]
        tallest = max(s.height for s in recent)
        if tallest > 0 and (tallest - last.height) / tallest >= self.gate_height_drop:
            return True
        if last.aspect_ratio >= self.gate_aspect:
            return True
        first = recent[0]
        dt = max(last.timestamp - first.timestamp, 1e-3)
        down_speed = (last.center[1] - first.center[1]) / dt / max(tallest, 1.0)
        return down_speed >= self.gate_down_speed

    # ------------------------------------------------------------- scoring
    def _score(self, feats: np.ndarray) -> float:
        if self._model is not None:
            return self._model.score(feats)
        return physics_score(feats)

    @staticmethod
    def _still_down(feats: np.ndarray) -> bool:
        f = dict(zip(FEATURE_NAMES, feats))
        return f["torso_angle_end"] > 45.0 or f["head_height_end"] < 0.5

    # ------------------------------------------------------------- evaluate
    def evaluate(self, buffer: TemporalBuffer, frame: np.ndarray) -> List[EventCandidate]:
        self.cycles += 1
        self._stats["cycles"] += 1
        persons = buffer.tracks_by_class("person")
        now = time.time()
        if not persons:
            self._tracks.clear()
            return []

        if any(self._suspicious(p, now) for p in persons):
            self._gate_until = now + self.gate_hold
        gate_open = now <= self._gate_until or any(
            s.first_positive_at is not None for s in self._tracks.values())
        if gate_open:
            self._stats["gate_open_cycles"] += 1
        if not gate_open and (self.cycles - 1) % self.idle_stride != 0:
            return []

        poses = self._get_pose_estimator().estimate(frame)
        self._stats["pose_runs"] += 1
        live_ids = set()
        for person in persons:
            if not person.states or now - person.last_seen > 1.0:
                continue
            pose = _match_pose(poses, person.states[-1].bbox)
            if pose is None:
                continue
            state = self._tracks.setdefault(person.track_id, _TrackFallState())
            state.poses.append(PoseSample(timestamp=now, keypoints=pose.keypoints, bbox=tuple(pose.bbox)))
            state.last_seen_at = now
            live_ids.add(person.track_id)

        for tid in [t for t, s in self._tracks.items() if now - s.last_seen_at > 5.0]:
            del self._tracks[tid]

        if not gate_open or (self.cycles - 1) % self.eval_stride != 0:
            return []

        out: List[EventCandidate] = []
        for tid in live_ids:
            state = self._tracks[tid]
            window = [p for p in state.poses if p.timestamp >= now - self.window_seconds]
            feats = window_features(window)
            if feats is None:
                continue
            score = self._score(feats)
            self._stats["evaluations"] += 1
            self._stats["max_score"] = max(self._stats["max_score"], score)
            state.scores.append(score)
            recent = list(state.scores)[-self.persistence_window:]
            hits = sum(1 for s in recent if s >= self.threshold)

            down = self._still_down(feats)
            if hits >= self.required and state.first_positive_at is None:
                state.first_positive_at = now          # fall detected: episode starts
                state.episode_peak = 0.0
            if state.first_positive_at is not None and not down and hits == 0:
                state.first_positive_at = None         # person got back up: episode over
            if state.first_positive_at is None:
                continue
            # The 2-s window slides past the drop itself, so the classifier score
            # falls afterwards; the episode continues while the person stays down.
            state.episode_peak = max(state.episode_peak, max(recent))

            still_seconds = now - state.first_positive_at
            tier = "CONFIRMED" if still_seconds >= self.confirm_still and down else "PROBABLE"
            f = dict(zip(FEATURE_NAMES, feats))
            self._stats["candidates"] += 1
            out.append(EventCandidate(
                event_type="fall",
                track_ids=[tid],
                camera_id=self.camera_id,
                detail={
                    "requested_tier": tier,
                    "mode": self.mode,
                    "score": round(float(state.episode_peak), 2),
                    "still_seconds": round(still_seconds, 1),
                    "torso_angle_deg": round(f["torso_angle_end"], 1),
                    "head_height_ratio": round(f["head_height_end"], 2),
                    "reasons": explain(feats),
                    "model": self._model.name if self._model is not None else "physics_score",
                },
                raw_confidence=float(state.episode_peak),
            ))
        return out

    def diagnostics(self) -> dict:
        return dict(self._stats, mode=self.mode, threshold=round(self.threshold, 3),
                    tracked_people=len(self._tracks))
