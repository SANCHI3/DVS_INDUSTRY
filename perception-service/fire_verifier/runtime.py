"""Live use of the learned fire/smoke verifier (trained by fire_verifier/train.py).

It sees the same inputs as in training: the last `window` YOLO evaluations
(frames downscaled to 480 px wide, best box per class). When YOLO's own
persistence fires for a class, the verifier scores that window; the alarm is
allowed only after `required_verified` verified windows, which is the rule
measured in models/fire_smoke_verifier_v1.metrics.json.
"""
from __future__ import annotations

import pickle
from collections import deque
from pathlib import Path
from typing import Deque, Dict, Optional, Tuple

import cv2
import numpy as np

from fire_verifier.features import stack_window, window_features

TRAIN_WIDTH = 480


class LearnedFireVerifier:
    def __init__(self, checkpoint: str | Path, recent_windows: int = 10):
        with Path(checkpoint).open("rb") as handle:
            bundle = pickle.load(handle)
        self.model = bundle["model"]
        self.threshold = float(bundle["threshold"])
        self.required = int(bundle.get("required_verified", 2))
        self.history: Deque[dict] = deque(maxlen=int(bundle.get("window", 5)))
        self.verdicts: Dict[str, Deque[bool]] = {
            name: deque(maxlen=recent_windows) for name in ("fire", "smoke")
        }
        self.last_probability: Dict[str, float] = {"fire": 0.0, "smoke": 0.0}

    def observe(self, frame: np.ndarray, best: Dict[str, Optional[Tuple[tuple, float]]]) -> None:
        """Record one YOLO evaluation: best (box, conf) per class or None."""
        scale = TRAIN_WIDTH / max(frame.shape[1], 1)
        if scale < 1:
            frame = cv2.resize(frame, (TRAIN_WIDTH, int(frame.shape[0] * scale)))
            best = {k: (tuple(c * scale for c in v[0]), v[1]) if v else None for k, v in best.items()}
        self.history.append({"frame": frame, **best})

    def reset(self, name: str) -> None:
        """Forget verdicts for a class once its YOLO persistence has ended, so
        approvals from an earlier episode cannot pass a later, unrelated one."""
        self.verdicts[name].clear()
        self.last_probability[name] = 0.0

    def confirm(self, name: str) -> bool:
        """Score the current window for a class YOLO considers persistent."""
        if len(self.history) < self.history.maxlen:
            return False
        frames, boxes, confs = stack_window(list(self.history), name)
        features = window_features(frames, boxes, confs, name == "fire")
        if features is None:
            return False
        probability = float(self.model.predict_proba(features[None])[0, 1])
        self.last_probability[name] = probability
        self.verdicts[name].append(probability >= self.threshold)
        return sum(self.verdicts[name]) >= self.required
