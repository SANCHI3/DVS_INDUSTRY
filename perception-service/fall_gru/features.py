"""Per-frame fall features shared by offline extraction and the live detector.

Two feature groups describe one person per frame:

* Box features (always available from the tracker): aspect ratio, box height,
  vertical centre and bottom edge, all normalised by frame height.
* Pose features (YOLOv8-pose keypoints, may be missing): torso tilt from
  vertical, hip/head height inside the box, shoulder-hip and hip-ankle
  vertical extents, and a "pose present" flag.

Velocities (per second) of height, centre, bottom and torso tilt are added by
`build_sequence`, so a fall reads as "box collapses + torso tips over + body
drops quickly, then stays low".
"""
from __future__ import annotations

import math
from typing import Optional, Sequence

import numpy as np

# COCO keypoint indices
NOSE, L_SHOULDER, R_SHOULDER, L_HIP, R_HIP = 0, 5, 6, 11, 12
L_KNEE, R_KNEE, L_ANKLE, R_ANKLE = 13, 14, 15, 16

KP_CONF = 0.3

FRAME_FEATURES = [
    "aspect", "box_h", "center_y", "bottom_y",          # box (0-3)
    "torso_tilt", "hip_in_box", "head_in_box",          # pose (4-6)
    "shoulder_hip_dy", "hip_ankle_dy", "pose_present",  # pose (7-9)
]
POSE_SLICE = slice(4, 10)
VELOCITY_OF = [1, 2, 3, 4]  # box_h, center_y, bottom_y, torso_tilt
FEATURE_NAMES = FRAME_FEATURES + [f"d_{FRAME_FEATURES[i]}" for i in VELOCITY_OF] + ["person_present"]
NUM_FEATURES = len(FEATURE_NAMES)


def _mid(kps: np.ndarray, a: int, b: int) -> Optional[np.ndarray]:
    pts = [kps[i, :2] for i in (a, b) if kps[i, 2] >= KP_CONF]
    return np.mean(pts, axis=0) if pts else None


def frame_features(bbox: Sequence[float], frame_h: float,
                   keypoints: Optional[np.ndarray] = None) -> np.ndarray:
    """Features for one person in one frame. keypoints: (17, 3) or None."""
    x1, y1, x2, y2 = (float(v) for v in bbox)
    w, h = max(x2 - x1, 1.0), max(y2 - y1, 1.0)
    fh = max(float(frame_h), 1.0)
    out = np.zeros(len(FRAME_FEATURES), dtype=np.float32)
    out[0] = min(w / h, 5.0)
    out[1] = h / fh
    out[2] = ((y1 + y2) / 2) / fh
    out[3] = y2 / fh

    if keypoints is None:
        return out
    shoulders = _mid(keypoints, L_SHOULDER, R_SHOULDER)
    hips = _mid(keypoints, L_HIP, R_HIP)
    if shoulders is None or hips is None:
        return out

    dx, dy = shoulders[0] - hips[0], shoulders[1] - hips[1]
    # Image y grows downwards, so an upright torso has shoulders above hips
    # (dy < 0). Tilt / 90°: 0 = upright, 1 = horizontal, 2 = upside down.
    out[4] = math.atan2(abs(dx), -dy) / (math.pi / 2)
    out[5] = (hips[1] - y1) / h
    head = keypoints[NOSE, :2] if keypoints[NOSE, 2] >= KP_CONF else shoulders
    out[6] = (head[1] - y1) / h
    out[7] = (hips[1] - shoulders[1]) / h
    ankles = _mid(keypoints, L_ANKLE, R_ANKLE)
    if ankles is None:
        ankles = _mid(keypoints, L_KNEE, R_KNEE)
    out[8] = ((ankles[1] - hips[1]) / h) if ankles is not None else 0.0
    out[9] = 1.0
    return out


def build_sequence(frames: Sequence[Optional[np.ndarray]], fps: float) -> np.ndarray:
    """Stack per-frame features into a [T, NUM_FEATURES] sequence.

    `None` entries (no person found) carry the previous features forward with
    person_present = 0, so short detector dropouts do not look like motion.
    """
    rows = []
    last = np.zeros(len(FRAME_FEATURES), dtype=np.float32)
    present = []
    for f in frames:
        if f is None:
            rows.append(last.copy())
            present.append(0.0)
        else:
            rows.append(f.astype(np.float32))
            last = rows[-1]
            present.append(1.0)
    base = np.stack(rows) if rows else np.zeros((0, len(FRAME_FEATURES)), np.float32)
    vel = np.zeros((len(base), len(VELOCITY_OF)), dtype=np.float32)
    if len(base) > 1:
        vel[1:] = (base[1:, VELOCITY_OF] - base[:-1, VELOCITY_OF]) * fps
    return np.concatenate([base, vel, np.asarray(present, np.float32)[:, None]], axis=1)
