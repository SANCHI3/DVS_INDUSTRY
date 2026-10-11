"""Live fall detection with the pose-sequence GRU model (fall_gru/).

Per tracked person, every processed frame contributes one feature row:
box features from the tracker plus skeleton features when YOLOv8-pose finds
a matching person. Each person's last `window` rows are scored by the model;
an alert needs `required_hits` of the last `persistence_window` evaluations
above the threshold, and each person has a cooldown so one fall raises one
incident.
"""
from __future__ import annotations

import time
from collections import deque
from typing import Deque, Dict, Optional

import numpy as np

from detection.pose_estimator import PoseEstimator
from fall_gru.features import build_sequence, frame_features
from fall_gru.model import FallClassifier
from temporal.fight_features import match_pose_to_bbox
from temporal.rule_engine import EventCandidate
from temporal.temporal_buffer import TemporalBuffer


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

        self.rows: Dict[int, Deque[Optional[np.ndarray]]] = {}
        self.hits: Dict[int, Deque[bool]] = {}
        self.cooldown_until: Dict[int, float] = {}
        self.cycles = 0
        self._stats = {"cycles": 0, "pose_runs": 0, "evaluations": 0,
                       "high_scores": 0, "candidates": 0, "max_score": 0.0}
        print(f"[{camera_id}] pose fall model loaded: {cfg['checkpoint']} threshold={self.threshold:.2f}")

    def evaluate(self, buffer: TemporalBuffer, frame) -> list:
        self.cycles += 1
        self._stats["cycles"] += 1
        now = time.time()
        people = [p for p in buffer.tracks_by_class("person") if p.states and p.last_seen() >= now - 1.0]
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

        if self.cycles % self.evaluation_stride != 0:
            return []

        candidates = []
        for person in people:
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
            self.cooldown_until[person.track_id] = now + self.cooldown_seconds
            self._stats["candidates"] += 1
            candidates.append(EventCandidate(
                event_type="fall",
                track_ids=[person.track_id],
                camera_id=self.camera_id,
                detail={"mode": "pose_gru", "score": round(score, 3)},
                raw_confidence=score,
            ))
        return candidates

    def diagnostics(self) -> dict:
        return dict(self._stats, tracked_people=len(self.rows), threshold=self.threshold)
