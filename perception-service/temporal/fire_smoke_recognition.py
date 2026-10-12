"""Dedicated fire/smoke YOLO inference with temporal persistence."""
from __future__ import annotations

import time
from collections import deque
from typing import Deque, Dict, List, Optional

import numpy as np
from ultralytics import YOLO

import os

from temporal.fire_verifier import FireVerifier
from temporal.rule_engine import EventCandidate


class FireSmokeDetector:
    """Evaluates fire/smoke at a controlled stride and applies N-of-M persistence.

    Fire and smoke are deformable regions, so ByteTrack is intentionally not
    used. The module emits one camera-level `fire_smoke` event family.
    """

    def __init__(self, camera_id: str, cfg: dict):
        self.camera_id = camera_id
        self.cfg = cfg
        self.model = YOLO(cfg["checkpoint"])
        self.imgsz = int(cfg.get("imgsz", 640))
        self.evaluation_stride = max(1, int(cfg.get("evaluation_stride_frames", 2)))
        self.window = max(1, int(cfg.get("persistence_window", 5)))
        self.required = max(1, int(cfg.get("required_hits", 3)))
        if self.required > self.window:
            raise ValueError("fire/smoke required_hits cannot exceed persistence_window")
        self.thresholds = {
            "fire": float(cfg.get("fire_threshold", 0.50)),
            "smoke": float(cfg.get("smoke_threshold", 0.50)),
        }
        self.hits: Dict[str, Deque[bool]] = {
            name: deque(maxlen=self.window) for name in self.thresholds
        }
        self.scores: Dict[str, Deque[float]] = {
            name: deque(maxlen=self.window) for name in self.thresholds
        }
        verifier_cfg = cfg.get("verifier", {}) or {}
        # Second stage that rejects fire/smoke look-alikes. Modes:
        #   learned - gradient-boosting verifier on flicker/colour/texture/motion
        #             (fire_verifier/), measured on FIRESENSE; gates persistent alarms
        #   rules   - hand-tuned colour / luminous-core / flicker score that
        #             down-weights each YOLO box (temporal/fire_verifier.py)
        self.verifier = None
        self.learned_verifier = None
        if verifier_cfg.get("enabled", False):
            mode = verifier_cfg.get("mode", "learned")
            checkpoint = verifier_cfg.get("checkpoint", "models/fire_smoke_verifier_v1.pkl")
            if mode == "learned" and os.path.exists(checkpoint):
                from fire_verifier.runtime import LearnedFireVerifier
                self.learned_verifier = LearnedFireVerifier(checkpoint)
            else:
                if mode == "learned":
                    print(f"[{camera_id}] learned fire verifier not found at {checkpoint}; "
                          f"using rule-based verifier")
                self.verifier = FireVerifier(verifier_cfg)
        self.single_class_confirm_seconds = float(cfg.get("single_class_confirm_seconds", 3.0))
        self.alarm_gap_seconds = float(cfg.get("alarm_gap_seconds", 1.5))
        self._alarm_since: Optional[float] = None   # start of the current sustained alarm
        self._alarm_last: Optional[float] = None
        self.cycles = 0
        self._stats = {
            "cycles": 0, "evaluations": 0,
            "fire_positive_windows": 0, "smoke_positive_windows": 0,
            "probable_candidates": 0, "confirmed_candidates": 0,
            "max_fire_score": 0.0, "max_smoke_score": 0.0,
            "fire_boxes_verified": 0, "fire_boxes_suppressed": 0,
            "alarms_rejected_by_learned_verifier": 0,
        }
        print(
            f"[{camera_id}] fire/smoke model loaded: {cfg['checkpoint']} "
            f"fire={self.thresholds['fire']:.2f} smoke={self.thresholds['smoke']:.2f} "
            f"persistence={self.required}/{self.window} stride={self.evaluation_stride}"
        )

    def evaluate(self, frame: np.ndarray) -> List[EventCandidate]:
        self.cycles += 1
        self._stats["cycles"] += 1
        if (self.cycles - 1) % self.evaluation_stride != 0:
            return []

        result = self.model.predict(
            source=frame, conf=0.01, imgsz=self.imgsz,
            device=self.cfg.get("device", 0), verbose=False,
        )[0]
        best = {"fire": 0.0, "smoke": 0.0}
        raw_best = {"fire": 0.0, "smoke": 0.0}
        best_boxes: dict = {"fire": None, "smoke": None}
        best_verification = None
        detections = []
        if result.boxes is not None:
            for cls_id, confidence, xyxy in zip(result.boxes.cls.tolist(), result.boxes.conf.tolist(),
                                                result.boxes.xyxy.tolist()):
                name = self.model.names[int(cls_id)]
                if name in best:
                    detections.append((name, float(confidence), tuple(xyxy)))
                    if float(confidence) > raw_best[name]:
                        best_boxes[name] = (tuple(xyxy), float(confidence))
                    raw_best[name] = max(raw_best[name], float(confidence))
        if self.learned_verifier is not None:
            self.learned_verifier.observe(frame, best_boxes)
        if self.verifier is not None:
            # Only boxes that could matter are verified (cheap: crops only)
            candidates = [d for d in detections if d[0] != "fire" or d[1] >= 0.5 * self.thresholds["fire"]]
            for item in self.verifier.verify(frame, candidates):
                best[item["class"]] = max(best[item["class"]], item["fused"])
                if item["class"] == "fire":
                    self._stats["fire_boxes_verified"] += 1
                    if item["yolo"] >= self.thresholds["fire"] > item["fused"]:
                        self._stats["fire_boxes_suppressed"] += 1
                    if best_verification is None or item["fused"] >= best["fire"]:
                        best_verification = item
        else:
            best = dict(raw_best)

        self._stats["evaluations"] += 1
        for name in ("fire", "smoke"):
            score = best[name]
            positive = score >= self.thresholds[name]
            self.scores[name].append(score)
            self.hits[name].append(positive)
            if positive:
                self._stats[f"{name}_positive_windows"] += 1
            self._stats[f"max_{name}_score"] = max(self._stats[f"max_{name}_score"], score)

        persistent = {
            name: len(self.hits[name]) >= self.required and sum(self.hits[name]) >= self.required
            for name in ("fire", "smoke")
        }
        active_classes = [name for name in ("fire", "smoke") if persistent[name]]
        if self.learned_verifier is not None and active_classes:
            verified = [name for name in active_classes if self.learned_verifier.confirm(name)]
            self._stats["alarms_rejected_by_learned_verifier"] += len(active_classes) - len(verified)
            active_classes = verified
        now = time.time()
        if not active_classes:
            if self._alarm_last is not None and now - self._alarm_last > self.alarm_gap_seconds:
                self._alarm_since = self._alarm_last = None
            return []
        if self._alarm_since is None:
            self._alarm_since = now
        self._alarm_last = now
        sustained_s = now - self._alarm_since

        # Fire and smoke together corroborate each other -> CONFIRMED. A single
        # verified class starts as PROBABLE and is CONFIRMED once it has stayed
        # active for `single_class_confirm_seconds` (a real flame often has no
        # visible smoke, and must still reach operators).
        sustained = sustained_s >= self.single_class_confirm_seconds
        requested_tier = "CONFIRMED" if len(active_classes) == 2 or sustained else "PROBABLE"
        self._stats["confirmed_candidates" if requested_tier == "CONFIRMED" else "probable_candidates"] += 1
        recent_max = {
            name: round(max(self.scores[name], default=0.0), 3)
            for name in ("fire", "smoke")
        }
        confidence = max(recent_max[name] for name in active_classes)
        return [EventCandidate(
            event_type="fire_smoke",
            track_ids=[],
            camera_id=self.camera_id,
            detail={
                "requested_tier": requested_tier,
                "detected_classes": active_classes,
                "sustained_seconds": round(sustained_s, 1),
                "fire_score": recent_max["fire"],
                "smoke_score": recent_max["smoke"],
                "fire_hits": int(sum(self.hits["fire"])),
                "smoke_hits": int(sum(self.hits["smoke"])),
                "persistence_window": self.window,
                "required_hits": self.required,
                "model": "fire_smoke_yolov8n_v1",
                "learned_verifier": None if self.learned_verifier is None else {
                    name: round(self.learned_verifier.last_probability[name], 3) for name in active_classes
                },
                "verifier": None if self.verifier is None else {
                    "raw_fire_score": round(raw_best["fire"], 3),
                    **({k: best_verification[k] for k in ("verification", "luminous_core", "flicker", "colour")}
                       if best_verification else {}),
                },
            },
            raw_confidence=confidence,
        )]

    def diagnostics(self) -> dict:
        return dict(
            self._stats,
            fire_hits=int(sum(self.hits["fire"])),
            smoke_hits=int(sum(self.hits["smoke"])),
            persistence_window=self.window,
            required_hits=self.required,
            fire_threshold=self.thresholds["fire"],
            smoke_threshold=self.thresholds["smoke"],
        )
