"""Dedicated fire/smoke YOLO inference with temporal persistence."""
from __future__ import annotations

import time
from collections import deque
from typing import Deque, Dict, List, Optional

import numpy as np

import os

from temporal.fire_dynamics import RegionDynamics, union_box
from temporal.fire_verifier import FireVerifier
from temporal.rule_engine import EventCandidate


def share_inside(box: tuple, others: List[tuple]) -> float:
    """Largest share of `box`'s area that lies inside any one of `others` (x1, y1, x2, y2)."""
    x1, y1, x2, y2 = box[:4]
    area = max(1e-6, (x2 - x1) * (y2 - y1))
    best = 0.0
    for o in others:
        ox1, oy1, ox2, oy2 = o[:4]
        w, h = min(x2, ox2) - max(x1, ox1), min(y2, oy2) - max(y1, oy1)
        if w > 0 and h > 0:
            best = max(best, w * h / area)
    return best


def _resolve_device(device):
    """`device: 0` (first GPU) falls back to the CPU on machines without CUDA,
    where Ultralytics would otherwise refuse to run."""
    if str(device).lower() == "cpu":
        return "cpu"
    try:
        import torch
        if torch.cuda.is_available() and torch.cuda.device_count() > 0:
            return device
    except ImportError:
        pass
    return "cpu"


class FireSmokeDetector:
    """Evaluates fire/smoke at a controlled stride and applies N-of-M persistence.

    Fire and smoke are deformable regions, so ByteTrack is intentionally not
    used. The module emits one camera-level `fire_smoke` event family.
    """

    def __init__(self, camera_id: str, cfg: dict, model=None):
        self.camera_id = camera_id
        self.cfg = cfg
        if model is None:
            from ultralytics import YOLO  # imported lazily so tests can inject a model
            model = YOLO(cfg["checkpoint"])
        self.model = model
        self.device = _resolve_device(cfg.get("device", 0))
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
        # Box of the best positive detection per evaluation (None when negative),
        # used for the static-region check below.
        self.boxes: Dict[str, Deque[Optional[tuple]]] = {
            name: deque(maxlen=self.window) for name in self.thresholds
        }
        # Static look-alike rejection (orange poster, lamp, grey wall, window):
        # a persistent detection must flicker or grow relative to the rest of
        # the scene. See temporal/fire_dynamics.py.
        self.dynamics = RegionDynamics(cfg.get("dynamics"))
        self._was_persistent = {name: False for name in self.thresholds}
        self._last_rejection_log: Dict[str, float] = {}
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
        # A smoke box lying mostly inside a person box is the person (dark hair,
        # clothes, motion blur close to the camera), not smoke. 0 disables.
        self.smoke_person_overlap = float(cfg.get("smoke_person_overlap", 0.0) or 0.0)
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
            "fire_boxes_verified": 0, "fire_boxes_suppressed": 0, "smoke_boxes_on_person": 0,
            "alarms_rejected_by_learned_verifier": 0,
            "alarms_rejected_static_region": 0,
        }
        print(
            f"[{camera_id}] fire/smoke model loaded: {cfg['checkpoint']} "
            f"fire={self.thresholds['fire']:.2f} smoke={self.thresholds['smoke']:.2f} "
            f"persistence={self.required}/{self.window} stride={self.evaluation_stride}"
        )

    def _log_rejection(self, name: str, message: str, now: float, every_s: float = 10.0) -> None:
        if now - self._last_rejection_log.get(name, -1e18) >= every_s:
            self._last_rejection_log[name] = now
            print(f"[{self.camera_id}] fire/smoke {name} rejected: {message}")

    def evaluate(self, frame: np.ndarray, now: Optional[float] = None,
                 person_boxes: Optional[List[tuple]] = None) -> List[EventCandidate]:
        self.cycles += 1
        self._stats["cycles"] += 1
        if (self.cycles - 1) % self.evaluation_stride != 0:
            return []
        now = time.time() if now is None else now
        self.dynamics.observe(frame, now)

        result = self.model.predict(
            source=frame, conf=0.01, imgsz=self.imgsz,
            device=self.device, verbose=False,
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
                if name == "smoke" and self.smoke_person_overlap > 0 and person_boxes and \
                        share_inside(tuple(xyxy), person_boxes) >= self.smoke_person_overlap:
                    if float(confidence) >= self.thresholds["smoke"]:
                        self._stats["smoke_boxes_on_person"] += 1
                    continue
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
            box = best_boxes[name][0] if positive and best_boxes[name] else None
            self.boxes[name].append(box)
            if positive:
                self._stats[f"{name}_positive_windows"] += 1
            self._stats[f"max_{name}_score"] = max(self._stats[f"max_{name}_score"], score)

        persistent = {
            name: len(self.hits[name]) >= self.required and sum(self.hits[name]) >= self.required
            for name in ("fire", "smoke")
        }
        for name in ("fire", "smoke"):
            # When YOLO persistence for a class ends, earlier verifier approvals
            # must not carry over to an unrelated later burst of detections.
            if self._was_persistent[name] and not persistent[name] and self.learned_verifier is not None:
                self.learned_verifier.reset(name)
            self._was_persistent[name] = persistent[name]
        active_classes = [name for name in ("fire", "smoke") if persistent[name]]
        dynamics = {}
        for name in list(active_classes):
            region = union_box(self.boxes[name])
            check = self.dynamics.assess(region) if region is not None else {"dynamic": False, "reason": "no box"}
            dynamics[name] = check
            if not check["dynamic"]:
                active_classes.remove(name)
                self._stats["alarms_rejected_static_region"] += 1
                self._log_rejection(name, f"{check['reason']} {check}", now)
        if self.learned_verifier is not None and active_classes:
            verified = []
            for name in active_classes:
                if self.learned_verifier.confirm(name):
                    verified.append(name)
                else:
                    self._log_rejection(name, "learned verifier has not confirmed it "
                                        f"(p={self.learned_verifier.last_probability[name]:.2f})", now)
            self._stats["alarms_rejected_by_learned_verifier"] += len(active_classes) - len(verified)
            active_classes = verified
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
        # Confidence is the mean detector score over the positive frames of the
        # persistence window -- not the single best frame.
        mean_positive = {}
        for name in ("fire", "smoke"):
            positives = [s for s, h in zip(self.scores[name], self.hits[name]) if h]
            mean_positive[name] = round(float(np.mean(positives)), 3) if positives else 0.0
        confidence = max(mean_positive[name] for name in active_classes)
        print(f"[{self.camera_id}] fire/smoke {requested_tier} {active_classes} "
              f"conf={confidence:.2f} sustained={sustained_s:.1f}s dynamics={dynamics}")
        return [EventCandidate(
            event_type="fire_smoke",
            track_ids=[],
            camera_id=self.camera_id,
            detail={
                "requested_tier": requested_tier,
                "detected_classes": active_classes,
                "sustained_seconds": round(sustained_s, 1),
                "fire_score": mean_positive["fire"],
                "smoke_score": mean_positive["smoke"],
                "fire_peak_score": recent_max["fire"],
                "smoke_peak_score": recent_max["smoke"],
                "confidence_basis": "mean YOLO score over positive frames in the persistence window",
                "dynamics": {name: dynamics[name] for name in active_classes},
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
