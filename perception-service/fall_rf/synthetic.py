"""Synthetic COCO-17 skeleton sequences for unit tests and a training smoke-test.

These are NOT a substitute for real footage -- they only check that the
feature code, training script and runtime detector are wired correctly.
"""
from __future__ import annotations

from typing import List

import numpy as np

from fall_rf.features import PoseSample


def _skeleton(hx: float, hy: float, torso_deg: float, leg_deg: float, height: float,
              lean_sign: float = 1.0) -> np.ndarray:
    t = np.radians(torso_deg) * lean_sign
    l = np.radians(leg_deg) * -lean_sign
    up = np.array([np.sin(t), -np.cos(t)])
    down = np.array([np.sin(l), np.cos(l)])
    side = np.array([np.cos(t), np.sin(t)]) * 0.06 * height
    hip = np.array([hx, hy])
    shoulder = hip + up * 0.30 * height
    head = shoulder + up * 0.13 * height
    knee = hip + down * 0.25 * height
    ankle = knee + down * 0.25 * height
    elbow = shoulder + down * 0.15 * height
    wrist = elbow + down * 0.13 * height
    pts = [head, head + side * 0.3, head - side * 0.3, head + side * 0.6, head - side * 0.6,
           shoulder + side, shoulder - side, elbow + side * 1.3, elbow - side * 1.3,
           wrist + side * 1.4, wrist - side * 1.4, hip + side * 0.7, hip - side * 0.7,
           knee + side * 0.6, knee - side * 0.6, ankle + side * 0.6, ankle - side * 0.6]
    kp = np.zeros((17, 3))
    kp[:, :2] = np.array(pts)
    kp[:, 2] = 0.9
    return kp


def _bbox(kp: np.ndarray, pad: float = 8.0):
    xs, ys = kp[:, 0], kp[:, 1]
    return (float(xs.min() - pad), float(ys.min() - pad), float(xs.max() + pad), float(ys.max() + pad))


def _ease(x: np.ndarray) -> np.ndarray:
    return np.clip(x, 0.0, 1.0) ** 2 * (3 - 2 * np.clip(x, 0.0, 1.0))


def make_sequence(kind: str, fps: float = 10.0, seconds: float = 3.0, seed: int = 0,
                  height: float = 220.0) -> List[PoseSample]:
    """kind: fall | walk | sit | bend | lie_down | squat"""
    rng = np.random.default_rng(seed)
    n = int(round(fps * seconds))
    times = np.arange(n) / fps
    floor = 420.0
    x0 = rng.uniform(150, 450)
    start = rng.uniform(0.6, 1.2)
    out: List[PoseSample] = []
    for t in times:
        if kind == "fall":
            p = _ease((t - start) / rng.uniform(0.5, 0.8))
            torso, legs = 85.0 * p, 75.0 * p
            hip_height = 0.5 - 0.42 * p
            x = x0 + 60 * p
        elif kind == "lie_down":  # deliberate, slow
            p = _ease((t - 0.3) / 2.5)
            torso, legs = 85.0 * p, 75.0 * p
            hip_height = 0.5 - 0.42 * p
            x = x0 + 40 * p
        elif kind == "sit":
            p = _ease((t - start) / 1.2)
            torso, legs = 12.0 * p, 70.0 * p
            hip_height = 0.5 - 0.25 * p
            x = x0
        elif kind == "bend":
            p = np.sin(np.clip((t - start) / 1.6, 0, 1) * np.pi)
            torso, legs = 70.0 * p, 5.0 * p
            hip_height = 0.5 - 0.03 * p
            x = x0
        elif kind == "squat":
            p = np.sin(np.clip((t - start) / 1.4, 0, 1) * np.pi)
            torso, legs = 20.0 * p, 60.0 * p
            hip_height = 0.5 - 0.22 * p
            x = x0
        else:  # walk
            torso, legs = 5.0, 10.0 * np.sin(t * 2 * np.pi)
            hip_height = 0.5
            x = x0 + 80 * t
        hy = floor - hip_height * height
        kp = _skeleton(x, hy, torso, legs, height)
        kp[:, :2] += rng.normal(0, 1.5, size=(17, 2))
        out.append(PoseSample(timestamp=float(t), keypoints=kp, bbox=_bbox(kp)))
    return out
