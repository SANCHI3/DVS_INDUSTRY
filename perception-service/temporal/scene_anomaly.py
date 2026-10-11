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
"""
from __future__ import annotations

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
                       "candidates": 0, "max_ratio": 0.0}
        print(f"[{camera_id}] scene-anomaly model loaded: {cfg['checkpoint']} "
              f"threshold={self.model.threshold:.3f}x{self.threshold_scale:g} "
              f"persistence={self.required}/{self.window}")

    def _explain(self, vector: np.ndarray, top_k: int = 3) -> List[dict]:
        per_feature = self.model.feature_errors(vector)[0]
        total = float(per_feature.sum()) or 1.0
        shares = {g: float(per_feature[idx].sum()) / total for g, idx in FEATURE_GROUPS.items()}
        ranked = sorted(shares.items(), key=lambda kv: kv[1], reverse=True)[:top_k]
        return [{"factor": g, "share": round(s, 2)} for g, s in ranked]

    def evaluate(self, frame: np.ndarray) -> List[EventCandidate]:
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

        ratio = float(self.model.anomaly_ratio(vector)[0]) / self.threshold_scale
        self.ratios.append(ratio)
        self._stats["evaluations"] += 1
        self._stats["max_ratio"] = max(self._stats["max_ratio"], ratio)
        if ratio > 1.0:
            self._stats["positive_windows"] += 1

        now = time.time()
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
            },
            raw_confidence=NumpyAutoencoder.ratio_to_confidence(sustained),
        )
        return [self._active]

    def diagnostics(self) -> dict:
        return dict(self._stats, threshold=round(self.model.threshold, 4),
                    recent_ratios=[round(r, 2) for r in self.ratios])
