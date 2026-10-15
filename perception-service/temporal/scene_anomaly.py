"""Runtime wrapper for the unsupervised scene-anomaly autoencoder.

Every pipeline cycle the processed frame is pushed into a
SceneFeatureExtractor. Each time a 2-second window is complete (every
`evaluation_stride_frames` cycles) the autoencoder scores it; the error
ratio (error / calibrated threshold) must exceed 1.0 on `required_hits` of the
last `persistence_window` evaluations before a camera-level `anomaly`
candidate is emitted.

The candidate carries an explanation: the feature groups (e.g. "downward
motion", "motion burst followed by stillness") that contributed most to the
reconstruction error, so an operator can see *why* the scene looked unusual.

Per-camera calibration
----------------------
The autoencoder's threshold was learned on its training footage. On a new
camera (different viewpoint, lighting, amount of normal movement) ordinary
activity can sit above that threshold permanently, so every few minutes an
"Unusual activity" incident appears although nothing is happening. With
`calibration.enabled`, the detector first observes the camera for
`calibration.seconds` WITHOUT alerting, records the error ratio of every
window, and sets the camera's threshold to the `percentile` of what it saw
(never lower than the model's own threshold). The result is saved per camera
and per checkpoint and reused on restart; delete the file or set
`calibration.recalibrate: true` to redo it (e.g. after moving the camera).
Calibrate while the scene shows normal activity only.

Confidence is an anomaly *score*, not a probability: ratio/(ratio+1) of the
error relative to this camera's calibrated threshold, so 0.5 means "at the
edge of what is normal here", 0.67 means twice that, 0.75 three times.
"""
from __future__ import annotations

import json
import os
import time
from collections import deque
from typing import Deque, List, Optional

import numpy as np

from anomaly.autoencoder import NumpyAutoencoder
from anomaly.scene_features import FEATURE_GROUPS, SceneFeatureExtractor
from temporal.rule_engine import EventCandidate


class SceneAnomalyDetector:
    def __init__(self, camera_id: str, cfg: dict, fps: float):
        self.camera_id = camera_id
        self.cfg = cfg
        self.model = NumpyAutoencoder.load(cfg["checkpoint"])
        meta = self.model.metadata or {}
        window_frames = int(cfg.get("window_frames", meta.get("window_frames", 10)))
        # Feed frames at the model's training rate so a window spans the same
        # wall-clock duration it did during training (e.g. 10 frames @ 5 FPS = 2 s).
        model_fps = float(meta.get("sample_fps", fps))
        self.frame_step = max(1, int(round(float(fps) / model_fps)))
        self.extractor = SceneFeatureExtractor(fps=float(fps) / self.frame_step, window_frames=window_frames)
        self.pushed = 0
        # MOG2 background model and flow history need a few seconds after start-up
        # (or a camera reconnect) before windows are representative.
        self.warmup_frames = int(cfg.get("warmup_frames", 3 * window_frames))
        self.stride = max(1, int(cfg.get("evaluation_stride_frames", 2)))
        self.threshold_scale = float(cfg.get("threshold_scale", 1.0))
        self.window = max(1, int(cfg.get("persistence_window", 3)))
        self.required = max(1, int(cfg.get("required_hits", 2)))
        if self.required > self.window:
            raise ValueError("anomaly required_hits cannot exceed persistence_window")
        self.confirm_ratio = float(cfg.get("confirmed_ratio", 2.0))
        self.cooldown = float(cfg.get("cooldown_seconds", 30.0))
        self._cooldown_until = 0.0
        self._active: Optional[EventCandidate] = None
        self.ratios: Deque[float] = deque(maxlen=self.window)
        self.cycles = 0
        self._stats = {"cycles": 0, "evaluations": 0, "positive_windows": 0,
                       "candidates": 0, "max_ratio": 0.0, "calibration_windows": 0}
        cal = cfg.get("calibration") or {}
        self.calibration_enabled = bool(cal.get("enabled", False))
        self.calibration_seconds = float(cal.get("seconds", 300))
        self.calibration_percentile = float(cal.get("percentile", 99))
        self.calibration_min_windows = int(cal.get("min_windows", 50))
        self.calibration_path = os.path.join(
            cal.get("dir", "output/calibration"), f"scene_anomaly_{camera_id}.json")
        self.camera_scale = 1.0          # camera threshold / model threshold
        self.calibrated = not self.calibration_enabled
        self._calibration_ratios: List[float] = []
        self._calibration_started: Optional[float] = None
        if self.calibration_enabled and not cal.get("recalibrate", False):
            self._load_calibration()
        print(f"[{camera_id}] scene-anomaly model loaded: {cfg['checkpoint']} "
              f"threshold={self.model.threshold:.3f}x{self.threshold_scale:g} "
              f"persistence={self.required}/{self.window}")
        if self.calibration_enabled:
            print(f"[{camera_id}] scene-anomaly camera calibration: " + (
                f"loaded from {self.calibration_path} (camera threshold = {self.camera_scale:.2f}x model)"
                if self.calibrated else
                f"observing {self.calibration_seconds:.0f}s of normal activity before alerting"))

    # ------------------------------------------------------------ calibration
    def _checkpoint_key(self) -> dict:
        return {"checkpoint": os.path.basename(str(self.cfg["checkpoint"])),
                "model_threshold": round(float(self.model.threshold), 6)}

    def _load_calibration(self) -> None:
        try:
            with open(self.calibration_path, encoding="utf-8") as handle:
                data = json.load(handle)
        except (OSError, ValueError):
            return
        if {k: data.get(k) for k in ("checkpoint", "model_threshold")} != self._checkpoint_key():
            print(f"[{self.camera_id}] scene-anomaly calibration in {self.calibration_path} is for "
                  f"another checkpoint; recalibrating")
            return
        self.camera_scale = max(1.0, float(data["camera_scale"]))
        self.calibrated = True

    def _finish_calibration(self) -> None:
        ratios = np.asarray(self._calibration_ratios, dtype=np.float64)
        observed = float(np.percentile(ratios, self.calibration_percentile))
        # Never more sensitive than the trained model; only raise the bar when
        # this camera's NORMAL activity already exceeds the training threshold.
        self.camera_scale = max(1.0, observed)
        self.calibrated = True
        data = {**self._checkpoint_key(), "camera_id": self.camera_id,
                "camera_scale": round(self.camera_scale, 4),
                "percentile": self.calibration_percentile,
                "observed_percentile_ratio": round(observed, 4),
                "windows": int(ratios.size),
                "median_ratio": round(float(np.median(ratios)), 4),
                "created_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
        try:
            os.makedirs(os.path.dirname(self.calibration_path) or ".", exist_ok=True)
            with open(self.calibration_path, "w", encoding="utf-8") as handle:
                json.dump(data, handle, indent=2)
        except OSError as exc:
            print(f"[{self.camera_id}] could not save anomaly calibration: {exc}")
        print(f"[{self.camera_id}] scene-anomaly calibrated on {ratios.size} windows: "
              f"p{self.calibration_percentile:g} ratio {observed:.2f} -> camera threshold "
              f"{self.camera_scale:.2f}x model threshold; alerts enabled")

    @staticmethod
    def score_to_confidence(ratio: float) -> float:
        """Anomaly score in 0..1 (not a probability): 1x camera threshold -> 0.5."""
        ratio = max(float(ratio), 0.0)
        return ratio / (ratio + 1.0)

    def _explain(self, vector: np.ndarray, top_k: int = 3) -> List[dict]:
        per_feature = self.model.feature_errors(vector)[0]
        total = float(per_feature.sum()) or 1.0
        shares = {g: float(per_feature[idx].sum()) / total for g, idx in FEATURE_GROUPS.items()}
        ranked = sorted(shares.items(), key=lambda kv: kv[1], reverse=True)[:top_k]
        return [{"factor": g, "share": round(s, 2)} for g, s in ranked]

    def evaluate(self, frame: np.ndarray, now: Optional[float] = None) -> List[EventCandidate]:
        self.cycles += 1
        self._stats["cycles"] += 1
        evaluated = False
        vector = None
        if (self.cycles - 1) % self.frame_step == 0:
            vector = self.extractor.push(frame)
            self.pushed += 1
            evaluated = (vector is not None and self.pushed > self.warmup_frames
                         and self.pushed % self.stride == 0)
        if not evaluated:
            # Between model evaluations keep re-asserting an active episode so the
            # confirmation stage does not count skipped cycles as "event ended"
            # (which would split one episode into several incidents).
            return [self._active] if self._active is not None else []

        now = time.time() if now is None else now
        model_ratio = float(self.model.anomaly_ratio(vector)[0])
        if not self.calibrated:
            # Learn what NORMAL looks like on this camera; never alert meanwhile.
            if self._calibration_started is None:
                self._calibration_started = now
            self._calibration_ratios.append(model_ratio)
            self._stats["calibration_windows"] += 1
            if (now - self._calibration_started >= self.calibration_seconds
                    and len(self._calibration_ratios) >= self.calibration_min_windows):
                self._finish_calibration()
            return []
        ratio = model_ratio / self.threshold_scale / self.camera_scale
        self.ratios.append(ratio)
        self._stats["evaluations"] += 1
        self._stats["max_ratio"] = max(self._stats["max_ratio"], ratio)
        if ratio > 1.0:
            self._stats["positive_windows"] += 1

        hits = sum(1 for r in self.ratios if r > 1.0)
        if hits < self.required:
            if self._active is not None:
                self._cooldown_until = now + self.cooldown  # episode over
            self._active = None
            return []
        if self._active is None and now < self._cooldown_until:
            return []  # same scene re-triggering right after an episode

        sustained = sorted(self.ratios, reverse=True)[self.required - 1]
        tier = "CONFIRMED" if sustained >= self.confirm_ratio else "PROBABLE"
        if self._active is not None and self._active.detail.get("requested_tier") == "CONFIRMED":
            tier = "CONFIRMED"  # never downgrade within an episode
        factors = self._explain(vector)
        self._stats["candidates"] += 1
        self._active = EventCandidate(
            event_type="anomaly",
            track_ids=[],
            camera_id=self.camera_id,
            detail={
                "requested_tier": tier,
                "anomaly_ratio": round(sustained, 2),
                "abnormal_windows": hits,
                "persistence_window": self.window,
                "top_factors": factors,
                "factors": ", ".join(f["factor"] for f in factors),
                "model": "scene_anomaly_autoencoder",
                "camera_calibrated": self.calibration_enabled,
                "camera_threshold_scale": round(self.camera_scale, 3),
                "confidence_basis": "anomaly score ratio/(ratio+1) of reconstruction error vs this "
                                    "camera's calibrated threshold (0.5 = edge of normal); not a probability",
            },
            raw_confidence=self.score_to_confidence(sustained),
        )
        return [self._active]

    def diagnostics(self) -> dict:
        return dict(self._stats, threshold=round(self.model.threshold, 4),
                    calibrated=self.calibrated, camera_scale=round(self.camera_scale, 3),
                    recent_ratios=[round(r, 2) for r in self.ratios])
