"""Video-loss detection for analog cameras behind a DVR.

When a coax camera loses power or its cable, the DVR keeps streaming: a black
picture, or the same picture over and over. That is a camera problem to show
on the camera status, never a fire/smoke incident, so the pipeline skips such
frames and reports VIDEO_LOSS instead.

  black   - the picture is (almost) uniformly dark
  frozen  - the picture has not changed at all for `frozen_after_s` seconds.
            A live analog picture always has sensor noise, so even a still
            scene changes a little from frame to frame; a frozen one does not.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np

OK = "OK"
BLACK = "BLACK"
FROZEN = "FROZEN"


@dataclass
class HealthState:
    status: str = OK
    since: Optional[float] = None  # when the current problem started

    @property
    def video_loss(self) -> bool:
        return self.status != OK


def frame_signature(frame: np.ndarray) -> tuple[str, float, float]:
    """(hash, mean, std) of a small greyscale copy: cheap enough for every frame."""
    gray = frame if frame.ndim == 2 else cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    small = cv2.resize(gray, (64, 36), interpolation=cv2.INTER_AREA)
    return hashlib.md5(small.tobytes()).hexdigest(), float(small.mean()), float(small.std())


class VideoHealth:
    def __init__(self, frozen_after_s: float = 30.0, black_mean: float = 10.0,
                 black_std: float = 4.0, black_after_s: float = 5.0):
        self.frozen_after_s = frozen_after_s
        self.black_mean = black_mean
        self.black_std = black_std
        self.black_after_s = black_after_s
        self._hash: Optional[str] = None
        self._same_since: Optional[float] = None
        self._black_since: Optional[float] = None
        self.state = HealthState()

    def update(self, frame: np.ndarray, timestamp: float) -> HealthState:
        digest, mean, std = frame_signature(frame)

        if mean <= self.black_mean and std <= self.black_std:
            self._black_since = timestamp if self._black_since is None else self._black_since
        else:
            self._black_since = None

        if digest != self._hash:
            self._hash, self._same_since = digest, timestamp
        elif self._same_since is None:
            self._same_since = timestamp

        if self._black_since is not None and timestamp - self._black_since >= self.black_after_s:
            self._set(BLACK, self._black_since)
        elif self._same_since is not None and timestamp - self._same_since >= self.frozen_after_s:
            self._set(FROZEN, self._same_since)
        else:
            self._set(OK, None)
        return self.state

    def reset(self) -> None:
        self._hash = self._same_since = self._black_since = None
        self.state = HealthState()

    def _set(self, status: str, since: Optional[float]) -> None:
        if status != self.state.status:
            self.state = HealthState(status, since)
