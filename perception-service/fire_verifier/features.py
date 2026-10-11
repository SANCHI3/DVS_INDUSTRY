"""Hand-crafted physical features that verify a YOLO fire/smoke detection.

YOLO looks at single frames, so bright orange objects (vests, lamps, sunsets)
or grey haze can fool it. Real fire flickers at a few Hz and is fire-coloured;
smoke is low-saturation, blurry (little texture) and drifts upwards. These
cues are computed over the last few frames of the detected region and fed to
a gradient-boosting classifier (fire_verifier/train.py).
"""
from __future__ import annotations

from typing import List, Optional, Sequence, Tuple

import cv2
import numpy as np

PATCH = 64  # region is resampled to PATCH x PATCH for temporal comparison

FEATURE_NAMES = [
    "is_fire_class", "yolo_conf_mean", "yolo_conf_max", "yolo_hit_rate",
    "box_area_frac", "box_area_change",
    "fire_color_frac", "smoke_color_frac", "sat_mean", "val_mean", "red_dominance",
    "laplacian_var", "edge_density",
    "temporal_diff_mean", "brightness_std", "flicker_hf_ratio", "flicker_pixel_frac",
    "flow_mag_mean", "flow_up_ratio",
]
NUM_FEATURES = len(FEATURE_NAMES)

Box = Tuple[float, float, float, float]


def _crop(frame: np.ndarray, box: Box, pad: float = 0.1) -> np.ndarray:
    h, w = frame.shape[:2]
    x1, y1, x2, y2 = box
    bw, bh = x2 - x1, y2 - y1
    x1, x2 = int(max(0, x1 - pad * bw)), int(min(w, x2 + pad * bw))
    y1, y2 = int(max(0, y1 - pad * bh)), int(min(h, y2 + pad * bh))
    if x2 - x1 < 2 or y2 - y1 < 2:
        return np.zeros((PATCH, PATCH, 3), np.uint8)
    return cv2.resize(frame[y1:y2, x1:x2], (PATCH, PATCH), interpolation=cv2.INTER_AREA)


def window_features(frames: Sequence[np.ndarray], boxes: Sequence[Optional[Box]],
                    confs: Sequence[float], is_fire: bool) -> Optional[np.ndarray]:
    """Features for one class over the last K frames (BGR). The region used for
    every frame is the most confident box in the window, so the temporal
    statistics compare the same physical area."""
    valid = [i for i, b in enumerate(boxes) if b is not None]
    if not valid or len(frames) < 2:
        return None
    anchor = max(valid, key=lambda i: confs[i])
    box = boxes[anchor]
    frame_area = frames[0].shape[0] * frames[0].shape[1]
    areas = [(b[2] - b[0]) * (b[3] - b[1]) for b in (boxes[i] for i in valid)]

    patches = [_crop(f, box) for f in frames]
    grays = [cv2.cvtColor(p, cv2.COLOR_BGR2GRAY).astype(np.float32) for p in patches]
    current = patches[anchor]
    hsv = cv2.cvtColor(current, cv2.COLOR_BGR2HSV)
    hue, sat, val = hsv[..., 0], hsv[..., 1].astype(np.float32), hsv[..., 2].astype(np.float32)
    fire_mask = (((hue <= 25) | (hue >= 165)) & (sat > 90) & (val > 140))
    smoke_mask = (sat < 60) & (val > 70) & (val < 230)
    b, g, r = (current[..., i].astype(np.float32) for i in range(3))
    red_dominance = float(np.mean((r > g) & (g > b)))

    gray_now = grays[anchor]
    lap_var = float(cv2.Laplacian(gray_now, cv2.CV_32F).var())
    edges = cv2.Canny(gray_now.astype(np.uint8), 50, 150)

    stack = np.stack(grays)  # [K, P, P]
    diffs = np.abs(np.diff(stack, axis=0))
    brightness = stack.mean(axis=(1, 2))
    spectrum = np.abs(np.fft.rfft(brightness - brightness.mean()))
    hf_ratio = float(spectrum[len(spectrum) // 2:].sum() / (spectrum.sum() + 1e-6)) if len(spectrum) > 2 else 0.0
    pixel_std = stack.std(axis=0)

    flow = cv2.calcOpticalFlowFarneback(stack[-2].astype(np.uint8), stack[-1].astype(np.uint8),
                                        None, 0.5, 2, 9, 2, 5, 1.1, 0)
    mag = np.linalg.norm(flow, axis=2)
    moving = mag > 0.5
    up_ratio = float(np.mean(flow[..., 1][moving] < 0)) if moving.any() else 0.0

    return np.asarray([
        float(is_fire),
        float(np.mean([confs[i] for i in valid])), float(max(confs)), len(valid) / len(boxes),
        areas[-1] / frame_area if frame_area else 0.0,
        (max(areas) / max(min(areas), 1.0)) if areas else 1.0,
        float(fire_mask.mean()), float(smoke_mask.mean()), float(sat.mean() / 255), float(val.mean() / 255),
        red_dominance,
        lap_var / 1000.0, float((edges > 0).mean()),
        float(diffs.mean() / 255), float(brightness.std() / 255), hf_ratio, float((pixel_std > 12).mean()),
        float(mag.mean()), up_ratio,
    ], dtype=np.float32)


def best_boxes(result, names: dict) -> dict:
    """{'fire': (box, conf) | None, 'smoke': ...} from an Ultralytics result."""
    best: dict = {"fire": None, "smoke": None}
    if result.boxes is None:
        return best
    for xyxy, cls_id, conf in zip(result.boxes.xyxy.tolist(), result.boxes.cls.tolist(),
                                  result.boxes.conf.tolist()):
        name = names[int(cls_id)]
        if name in best and (best[name] is None or conf > best[name][1]):
            best[name] = (tuple(xyxy), float(conf))
    return best


def stack_window(history: List[dict], name: str):
    """Split a per-frame history [{frame, fire, smoke}] into the lists
    window_features expects for one class."""
    frames = [h["frame"] for h in history]
    boxes = [h[name][0] if h[name] is not None else None for h in history]
    confs = [h[name][1] if h[name] is not None else 0.0 for h in history]
    return frames, boxes, confs
