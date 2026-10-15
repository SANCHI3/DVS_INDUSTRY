"""Gated pose-sequence fight detection.

The motion gate is only a compute trigger. Once opened, it remains active for a
short hold window so the classifier receives a contiguous pose sequence. The
sequence is camera-level rather than ByteTrack-pair-level, allowing it to
survive the ID switches that are common when people overlap during a fight.
"""
from __future__ import annotations

import time
from collections import deque
from typing import Deque, List, Optional, Tuple

import numpy as np

from detection.pose_estimator import PersonPose, PoseEstimator
from temporal.fight_features import FEATURE_DIM, match_pose_to_bbox, pair_feature_vector
from temporal.interaction import InteractionValidator
from temporal.motion_gate import MotionOfInterestGate
from temporal.rule_engine import EventCandidate
from temporal.temporal_buffer import TemporalBuffer


class FightDetector:
    def __init__(self, camera_id: str, cfg: dict):
        self.camera_id = camera_id
        self.enabled = cfg.get("enabled", True)
        self.mode = cfg.get("mode", "heuristic")
        self.window_frames = int(cfg.get("window_frames", 32))
        self.min_frames_for_eval = int(cfg.get("min_frames_for_eval", 16))
        self.confidence_threshold = float(cfg.get("confidence_threshold", 0.6))
        self.sequence_stale_after_s = float(cfg.get("pair_stale_after_s", 5.0))
        self.gate_hold_seconds = float(cfg.get("gate_hold_seconds", 1.5))
        self.interaction = InteractionValidator(cfg.get("interaction"))
        self.gate = MotionOfInterestGate(
            proximity_px=cfg["gate"]["proximity_px"],
            velocity_threshold_px_s=cfg["gate"]["velocity_threshold_px_s"],
        )
        self._pose_estimator: Optional[PoseEstimator] = None
        self._pose_model_path = cfg.get("pose_model_path", "yolov8n-pose.pt")
        self._model = None
        self._use_checkpoint_threshold = cfg.get("use_checkpoint_threshold", True)
        if self.mode == "model":
            checkpoint = cfg.get("model_checkpoint")
            if checkpoint:
                self._model = self._load_model(checkpoint)
                self.window_frames = self._model.max_frames
                if self._use_checkpoint_threshold:
                    self.confidence_threshold = self._model.threshold
            else:
                print(f"[{camera_id}] model mode has no checkpoint; falling back to heuristic")
                self.mode = "heuristic"

        self._frames: Deque[np.ndarray] = deque(maxlen=self.window_frames)
        self._active_pair: Optional[Tuple[int, int]] = None
        self._gate_active_until = 0.0
        self._last_feature_at = 0.0
        self._previous_centers: Optional[Tuple[np.ndarray, np.ndarray]] = None
        self._stats = {"cycles": 0, "gate_open": 0, "pose_pair": 0,
                       "scored": 0, "candidates": 0, "max_score": 0.0}

    def _load_model(self, checkpoint_path: str):
        from fight_model.infer import FightSequenceClassifier
        model = FightSequenceClassifier(checkpoint_path)
        if model.input_dim != FEATURE_DIM:
            raise ValueError(
                f"fight checkpoint expects {model.input_dim} features, "
                f"but runtime produces {FEATURE_DIM}"
            )
        return model

    def _get_pose_estimator(self) -> PoseEstimator:
        if self._pose_estimator is None:
            self._pose_estimator = PoseEstimator(self._pose_model_path)
        return self._pose_estimator

    def _reset_sequence(self):
        self._frames.clear()
        self._previous_centers = None
        self._last_feature_at = 0.0

    def evaluate(self, buffer: TemporalBuffer, frame: np.ndarray) -> List[EventCandidate]:
        self._stats["cycles"] += 1
        if not self.enabled:
            return []
        now = time.time()
        gate_pairs = self.gate.find_candidate_pairs(buffer)
        if gate_pairs:
            self._active_pair = self._select_pair(buffer, gate_pairs)
            self._gate_active_until = now + self.gate_hold_seconds
        elif now > self._gate_active_until:
            if self._last_feature_at and now - self._last_feature_at > self.sequence_stale_after_s:
                self._reset_sequence()
            return []

        pair = self._active_pair
        if pair is None:
            return []
        hist_a, hist_b = buffer.get(pair[0]), buffer.get(pair[1])
        if hist_a is None or hist_b is None or not hist_a.states or not hist_b.states:
            return []
        self._stats["gate_open"] += 1

        poses = self._get_pose_estimator().estimate(frame)
        if len(poses) < 2:
            return []
        pose_a = match_pose_to_bbox(poses, hist_a.states[-1].bbox)
        pose_b = match_pose_to_bbox(poses, hist_b.states[-1].bbox)
        if pose_a is None or pose_b is None or pose_a is pose_b:
            # IDs may have switched. Fall back to the closest confident pose pair,
            # just as the offline feature extractor does.
            fallback = self._choose_pose_pair(poses)
            if fallback is None:
                return []
            pose_a, pose_b = fallback

        pose_a, pose_b = self._preserve_pose_order(pose_a, pose_b)
        center_a, center_b = self._pose_center(pose_a), self._pose_center(pose_b)
        speed = 0.0
        if self._previous_centers is not None and self._last_feature_at:
            dt = max(now - self._last_feature_at, 1e-6)
            speed = float(
                (np.linalg.norm(center_a - self._previous_centers[0]) +
                 np.linalg.norm(center_b - self._previous_centers[1])) / dt
            )
        feature = pair_feature_vector(pose_a, pose_b).astype(np.float32, copy=False)
        feature[-1] = speed
        self._frames.append(feature)
        self._previous_centers = (center_a, center_b)
        self._last_feature_at = now
        self._stats["pose_pair"] += 1

        if len(self._frames) < self.min_frames_for_eval:
            return []
        score = self._score_sequence(np.stack(self._frames))
        self._stats["scored"] += 1
        self._stats["max_score"] = max(self._stats["max_score"], float(score))
        if score < self.confidence_threshold:
            return []
        interacting, evidence = self.interaction.validate(buffer)
        if not interacting:
            self._stats["rejected_no_interaction"] = self._stats.get("rejected_no_interaction", 0) + 1
            print(f"[{self.camera_id}] fight rejected despite score {score:.2f}: {evidence.get('reason')}")
            return []
        self._stats["candidates"] += 1
        return [EventCandidate(
            event_type="fight",
            track_ids=list(pair),
            camera_id=self.camera_id,
            detail={"mode": self.mode, "score": round(float(score), 2),
                    "frames_evaluated": len(self._frames),
                    "interaction": evidence,
                    "confidence_basis": "pose-sequence fight classifier score"},
            raw_confidence=float(score),
        )]

    def _select_pair(self, buffer: TemporalBuffer, pairs) -> Tuple[int, int]:
        if self._active_pair in pairs:
            return self._active_pair
        def cost(pair):
            a, b = buffer.get(pair[0]), buffer.get(pair[1])
            if a is None or b is None or not a.states or not b.states:
                return float("inf")
            sa, sb = a.states[-1], b.states[-1]
            distance = np.hypot(sa.center[0] - sb.center[0], sa.center[1] - sb.center[1])
            return float(distance / max((sa.height + sb.height) / 2.0, 1.0))
        return tuple(min(pairs, key=cost))

    @staticmethod
    def _pose_center(pose: PersonPose) -> np.ndarray:
        x1, y1, x2, y2 = pose.bbox
        return np.asarray(((x1 + x2) / 2.0, (y1 + y2) / 2.0), dtype=np.float32)

    def _choose_pose_pair(self, poses: List[PersonPose]):
        best, best_cost = None, float("inf")
        for i in range(len(poses)):
            for j in range(i + 1, len(poses)):
                a, b = poses[i], poses[j]
                ah = max(a.bbox[3] - a.bbox[1], 1.0)
                bh = max(b.bbox[3] - b.bbox[1], 1.0)
                distance = np.linalg.norm(self._pose_center(a) - self._pose_center(b))
                cost = float(distance / ((ah + bh) / 2.0) - 0.25 * (a.confidence + b.confidence))
                if cost < best_cost:
                    best, best_cost = (a, b), cost
        return best

    def _preserve_pose_order(self, a: PersonPose, b: PersonPose):
        ca, cb = self._pose_center(a), self._pose_center(b)
        if self._previous_centers is None:
            return (a, b) if ca[0] <= cb[0] else (b, a)
        pa, pb = self._previous_centers
        direct = np.linalg.norm(ca - pa) + np.linalg.norm(cb - pb)
        swapped = np.linalg.norm(cb - pa) + np.linalg.norm(ca - pb)
        return (a, b) if direct <= swapped else (b, a)

    def _score_sequence(self, sequence: np.ndarray) -> float:
        if self.mode == "model" and self._model is not None:
            return self._model.score(sequence)
        return self._score_heuristic(sequence)

    def _score_heuristic(self, sequence: np.ndarray) -> float:
        kp_part = sequence[:, :FEATURE_DIM - 2]
        diffs = np.diff(kp_part, axis=0)
        if len(diffs) == 0:
            return 0.0
        frame_motion = np.linalg.norm(diffs, axis=1)
        mean_motion = float(np.mean(frame_motion))
        jerk = float(np.std(np.diff(frame_motion))) if len(frame_motion) > 1 else 0.0
        avg_distance = float(np.mean(sequence[:, -2]))
        proximity = max(0.0, 1.0 - avg_distance / 200.0)
        motion = min(mean_motion * 6.0 + jerk * 12.0, 1.0)
        return float(np.clip(0.65 * motion + 0.35 * proximity, 0.0, 1.0))

    def diagnostics(self) -> dict:
        return dict(self._stats, sequence_frames=len(self._frames),
                    threshold=round(self.confidence_threshold, 3))
