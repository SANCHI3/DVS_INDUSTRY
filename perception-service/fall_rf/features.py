"""Biomechanical fall features computed from a short sequence of body keypoints.

Input: a time-ordered list of PoseSample (timestamp, 17x3 COCO keypoints,
person bbox) for ONE person covering roughly the last 2 seconds.

Output: a fixed-length vector of 16 interpretable features. They describe
the physics of a fall rather than how the person looks, so they transfer
across cameras, clothing and lighting much better than raw pixels:

    torso orientation  - is the trunk rotating from vertical to horizontal?
    descent dynamics   - how fast do the hips and head drop (in body heights / s)?
    final posture      - is the head now close to floor level?
    after-fall state   - is the person lying still afterwards?

COCO keypoint order: 0 nose, 1-2 eyes, 3-4 ears, 5-6 shoulders, 7-8 elbows,
9-10 wrists, 11-12 hips, 13-14 knees, 15-16 ankles.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Sequence, Tuple

import numpy as np

KP_CONF = 0.30

FEATURE_NAMES: List[str] = [
    "torso_angle_end",          # deg from vertical at the end of the window (0 upright, 90 lying)
    "torso_angle_max",
    "torso_angle_change",       # end angle minus most upright angle earlier in the window
    "torso_angular_speed_max",  # deg / s
    "hip_drop",                 # body heights the hip centre dropped
    "hip_down_speed_max",       # body heights / s
    "head_drop",
    "head_down_speed_max",
    "head_height_end",          # head height above the feet line, in body heights (1 upright, ~0.2 lying)
    "head_height_min",
    "bbox_aspect_end",          # width / height of the person box
    "bbox_aspect_change",
    "stillness_end",            # centre speed in the last 25% of the window (body heights / s)
    "centre_accel_max",         # body heights / s^2
    "keypoint_visibility",
    "vertical_spread_end",      # keypoint y-range / x-range (tall & narrow vs. flat & wide)
]
FEATURE_DIM = len(FEATURE_NAMES)


@dataclass
class PoseSample:
    timestamp: float
    keypoints: np.ndarray                        # (17, 3)
    bbox: Tuple[float, float, float, float]      # x1, y1, x2, y2


def _mid(kp: np.ndarray, a: int, b: int) -> Optional[np.ndarray]:
    pts = [kp[i, :2] for i in (a, b) if kp[i, 2] >= KP_CONF]
    return np.mean(pts, axis=0) if pts else None


def _head(kp: np.ndarray) -> Optional[np.ndarray]:
    pts = [kp[i, :2] for i in (0, 1, 2, 3, 4) if kp[i, 2] >= KP_CONF]
    return np.mean(pts, axis=0) if pts else None


def _frame_measures(sample: PoseSample) -> dict:
    kp = np.asarray(sample.keypoints, dtype=float)
    x1, y1, x2, y2 = sample.bbox
    w, h = max(x2 - x1, 1.0), max(y2 - y1, 1.0)
    shoulders, hips = _mid(kp, 5, 6), _mid(kp, 11, 12)
    head = _head(kp)
    ankles = _mid(kp, 15, 16)
    foot_y = ankles[1] if ankles is not None else y2

    torso_angle = np.nan
    if shoulders is not None and hips is not None:
        dx, dy = shoulders - hips  # image y grows downward: upright => dy < 0
        # 0 deg = trunk vertical, 90 deg = horizontal; head-down (>90) is clamped to 90
        torso_angle = min(float(np.degrees(np.arctan2(abs(dx), -dy))), 90.0)

    visible = kp[:, 2] >= KP_CONF
    if visible.sum() >= 3:
        ys, xs = kp[visible, 1], kp[visible, 0]
        spread = float((ys.max() - ys.min()) / max(xs.max() - xs.min(), 1.0))
    else:
        spread = h / w

    return {
        "t": sample.timestamp,
        "torso_angle": torso_angle,
        "hip_y": hips[1] if hips is not None else (y1 + y2) / 2.0,
        "head_y": head[1] if head is not None else y1,
        "foot_y": foot_y,
        "centre": np.array([(x1 + x2) / 2.0, (y1 + y2) / 2.0]),
        "aspect": w / h,
        "height": h,
        "visibility": float(visible.mean()),
        "spread": spread,
    }


def _max_rate(values: np.ndarray, times: np.ndarray) -> float:
    if len(values) < 2:
        return 0.0
    dt = np.maximum(np.diff(times), 1e-3)
    return float(np.max(np.diff(values) / dt))


def window_features(samples: Sequence[PoseSample]) -> Optional[np.ndarray]:
    """Feature vector for one person's pose sequence, or None if too little data."""
    if len(samples) < 4:
        return None
    m = [_frame_measures(s) for s in samples]
    t = np.array([x["t"] for x in m])
    if t[-1] - t[0] < 0.3:
        return None

    # Reference body height: tallest box seen in the window (standing height)
    ref_h = max(float(np.max([x["height"] for x in m])), 1.0)
    n = len(m)
    tail = max(1, n // 4)
    early = max(1, n - tail)

    angles = np.array([x["torso_angle"] for x in m], dtype=float)
    if np.all(np.isnan(angles)):
        angles = np.where(np.array([x["aspect"] for x in m]) > 1.0, 80.0, 10.0)
    angles = np.where(np.isnan(angles), np.nanmean(angles), angles)

    hip_y = np.array([x["hip_y"] for x in m]) / ref_h
    head_y = np.array([x["head_y"] for x in m]) / ref_h
    foot_y = np.array([x["foot_y"] for x in m]) / ref_h
    head_height = np.clip(foot_y - head_y, -0.5, 1.5)
    aspect = np.array([x["aspect"] for x in m])
    centre = np.stack([x["centre"] for x in m]) / ref_h
    dt = np.maximum(np.diff(t), 1e-3)
    centre_speed = np.linalg.norm(np.diff(centre, axis=0), axis=1) / dt if n > 1 else np.zeros(1)
    accel = np.abs(np.diff(centre_speed)) / dt[1:] if len(centre_speed) > 1 else np.zeros(1)

    feats = np.array([
        float(np.mean(angles[-tail:])),
        float(np.max(angles)),
        float(np.mean(angles[-tail:]) - np.min(angles[:early])),
        max(_max_rate(angles, t), 0.0),
        float(np.mean(hip_y[-tail:]) - np.min(hip_y[:early])),
        max(_max_rate(hip_y, t), 0.0),
        float(np.mean(head_y[-tail:]) - np.min(head_y[:early])),
        max(_max_rate(head_y, t), 0.0),
        float(np.mean(head_height[-tail:])),
        float(np.min(head_height)),
        float(np.mean(aspect[-tail:])),
        float(np.mean(aspect[-tail:]) - np.min(aspect[:early])),
        float(np.mean(centre_speed[-tail:])),
        float(np.max(accel)) if len(accel) else 0.0,
        float(np.mean([x["visibility"] for x in m])),
        float(np.mean([x["spread"] for x in m[-tail:]])),
    ], dtype=np.float32)
    return np.nan_to_num(feats, nan=0.0, posinf=0.0, neginf=0.0)


def physics_score(features: np.ndarray) -> float:
    """Training-free fall score (0..1) from the same features.

    Used when no trained checkpoint is available, and as the weak-label source
    that marks which windows of a fall video contain the person on the ground.
    """
    f = dict(zip(FEATURE_NAMES, features))
    lying = np.clip((f["torso_angle_end"] - 35.0) / 40.0, 0.0, 1.0)
    low_head = np.clip((0.65 - f["head_height_end"]) / 0.4, 0.0, 1.0)
    on_ground = 0.5 * lying + 0.5 * low_head
    # A fall is "ended up on the ground" AND "got there fast". Lying down
    # deliberately reaches the same posture slowly, so descent speed gates it.
    descent = np.clip(max(f["hip_down_speed_max"], f["head_down_speed_max"]) / 1.2, 0.0, 1.0)
    still = np.clip(1.0 - f["stillness_end"] / 0.6, 0.0, 1.0)
    return float(np.clip(on_ground * (0.25 + 0.60 * descent + 0.15 * still), 0.0, 1.0))


def explain(features: np.ndarray) -> List[str]:
    """Plain-language reasons for an operator / incident report."""
    f = dict(zip(FEATURE_NAMES, features))
    reasons = []
    if f["torso_angle_change"] > 30:
        reasons.append(f"torso rotated {f['torso_angle_change']:.0f} deg towards horizontal "
                       f"(now {f['torso_angle_end']:.0f} deg)")
    if f["hip_down_speed_max"] > 0.6:
        reasons.append(f"hips dropped at {f['hip_down_speed_max']:.1f} body-heights/s")
    if f["head_drop"] > 0.3:
        reasons.append(f"head dropped {f['head_drop']:.2f} body-heights")
    if f["head_height_end"] < 0.45:
        reasons.append("head is close to floor level")
    if f["stillness_end"] < 0.15:
        reasons.append("little movement after the drop")
    return reasons or ["pose pattern matches the trained fall model"]
