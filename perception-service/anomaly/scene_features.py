"""Scene-level motion + silhouette features for unsupervised anomaly detection.

Two cheap, model-free signals are computed on every processed frame:

1. Dense optical flow (Farneback) between consecutive frames
   - how fast things move, how much of the scene moves,
   - which way the motion energy points (down / up / sideways),
   - how coherent it is, and where it happens vertically.
2. Background subtraction (MOG2) silhouettes
   - foreground area and the shape (height, aspect ratio) of the largest blob,
     which changes sharply when a person collapses or an object falls.

A *window* (default 10 frames = 2 s at 5 FPS) of per-frame vectors is then
aggregated into one fixed-length vector that captures both levels and
*temporal structure*: how far the motion centroid travelled downwards, how
much the silhouette shrank / widened, whether a burst of motion was followed
by sudden stillness, and the peak acceleration.

Design notes
- Speeds are expressed in "frame widths per second", so the same model works
  at 5 or 10 FPS and at any processing resolution.
- Heavy-tailed quantities are log-compressed so a single extreme frame does
  not dominate training.
- Only OpenCV + NumPy are required (no GPU, no torch, no YOLO).
"""
from __future__ import annotations

from collections import deque
from typing import Deque, Dict, List, Optional, Tuple

import cv2
import numpy as np

MOVING_SPEED = 0.05  # frame-widths / second; below this a pixel counts as static
MIN_BLOB_FRACTION = 0.004  # ignore foreground blobs smaller than 0.4% of the frame

PER_FRAME_NAMES: List[str] = [
    "speed_mean", "speed_p95", "moving_area",
    "down_share", "up_share", "side_share", "coherence",
    "motion_centroid_y", "energy_top", "energy_middle", "energy_bottom",
    "frame_diff", "brightness_change",
    "fg_area", "blob_height", "blob_aspect",
]
PER_FRAME_DIM = len(PER_FRAME_NAMES)  # 16
_IDX = {n: i for i, n in enumerate(PER_FRAME_NAMES)}

TEMPORAL_NAMES: List[str] = [
    "centroid_drop",        # downward travel of the motion centroid across the window
    "blob_height_drop",     # max height earlier in the window minus height at the end
    "blob_aspect_rise",     # widening of the silhouette (standing -> lying)
    "burst_then_still",     # peak speed minus speed in the last frames
    "speed_acceleration",   # largest frame-to-frame change in mean speed
    "down_burst",           # peak downward share x peak speed
]

FEATURE_NAMES: List[str] = (
    [f"mean_{n}" for n in PER_FRAME_NAMES]
    + [f"max_{n}" for n in PER_FRAME_NAMES]
    + TEMPORAL_NAMES
)
FEATURE_DIM = len(FEATURE_NAMES)  # 38
FEATURE_VERSION = "2"  # bump whenever feature maths changes (invalidates caches)

# Human-readable groups used to explain *why* a window looked abnormal.
_GROUP_OF = {
    "speed_mean": "fast motion", "speed_p95": "fast motion", "speed_acceleration": "sudden acceleration",
    "moving_area": "widespread motion",
    "down_share": "downward (falling / collapsing) motion", "centroid_drop": "downward (falling / collapsing) motion",
    "down_burst": "downward (falling / collapsing) motion",
    "up_share": "unusual motion direction", "side_share": "unusual motion direction",
    "coherence": "chaotic vs. uniform motion",
    "motion_centroid_y": "motion in an unusual part of the scene",
    "energy_top": "motion in an unusual part of the scene",
    "energy_middle": "motion in an unusual part of the scene",
    "energy_bottom": "motion in an unusual part of the scene",
    "frame_diff": "visual change (smoke, flash, lighting)",
    "brightness_change": "visual change (smoke, flash, lighting)",
    "fg_area": "silhouette / object shape change", "blob_height": "silhouette / object shape change",
    "blob_aspect": "silhouette / object shape change", "blob_height_drop": "silhouette / object shape change",
    "blob_aspect_rise": "silhouette / object shape change",
    "burst_then_still": "motion burst followed by stillness",
}


def _group_for(name: str) -> str:
    base = name.split("_", 1)[1] if name.startswith(("mean_", "max_")) else name
    return _GROUP_OF.get(base, "other")


FEATURE_GROUPS: Dict[str, List[int]] = {}
for _i, _n in enumerate(FEATURE_NAMES):
    FEATURE_GROUPS.setdefault(_group_for(_n), []).append(_i)


def _largest_blob(mask: np.ndarray) -> Tuple[float, float, float]:
    """(foreground_fraction, blob_height_fraction, log_aspect) of the largest blob."""
    h, w = mask.shape[:2]
    fg_fraction = float(np.count_nonzero(mask)) / float(h * w)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return fg_fraction, 0.0, 0.0
    largest = max(contours, key=cv2.contourArea)
    if cv2.contourArea(largest) < MIN_BLOB_FRACTION * h * w:
        return fg_fraction, 0.0, 0.0
    _, _, bw, bh = cv2.boundingRect(largest)
    return fg_fraction, bh / float(h), float(np.log(max(bw, 1) / max(bh, 1)))


def compute_frame_features(prev_gray: np.ndarray, gray: np.ndarray, fps: float,
                           fg_mask: Optional[np.ndarray] = None) -> np.ndarray:
    """Per-frame feature vector (PER_FRAME_DIM,) from two consecutive grayscale frames."""
    h, w = gray.shape[:2]
    flow = cv2.calcOpticalFlowFarneback(prev_gray, gray, None, 0.5, 3, 15, 3, 5, 1.2, 0)
    fx, fy = flow[..., 0], flow[..., 1]
    scale = float(fps) / float(w)  # pixels/frame -> frame widths/second
    speed = np.sqrt(fx * fx + fy * fy) * scale
    moving = speed > MOVING_SPEED

    feats = np.zeros(PER_FRAME_DIM, dtype=np.float32)
    feats[_IDX["speed_mean"]] = np.log1p(10.0 * speed.mean())
    feats[_IDX["speed_p95"]] = np.log1p(10.0 * np.percentile(speed, 95))
    feats[_IDX["moving_area"]] = float(np.mean(moving))

    if moving.any():
        mfx, mfy, ms = fx[moving], fy[moving], speed[moving]
        energy = float(ms.sum())
        vertical_dom = np.abs(mfy) > np.abs(mfx)
        feats[_IDX["down_share"]] = float(ms[vertical_dom & (mfy > 0)].sum() / energy)  # image y grows downward
        feats[_IDX["up_share"]] = float(ms[vertical_dom & (mfy < 0)].sum() / energy)
        feats[_IDX["side_share"]] = float(ms[~vertical_dom].sum() / energy)
        mean_mag = float(np.sqrt(mfx ** 2 + mfy ** 2).mean())
        feats[_IDX["coherence"]] = float(np.hypot(mfx.mean(), mfy.mean()) / mean_mag) if mean_mag > 1e-6 else 0.0
        ys = np.nonzero(moving)[0]
        feats[_IDX["motion_centroid_y"]] = float(np.average(ys, weights=ms) / h)
    else:
        feats[_IDX["motion_centroid_y"]] = 0.5

    for name, (top, bottom) in (("energy_top", (0, h // 3)), ("energy_middle", (h // 3, 2 * h // 3)),
                                ("energy_bottom", (2 * h // 3, h))):
        feats[_IDX[name]] = np.log1p(10.0 * speed[top:bottom].mean())

    diff = cv2.absdiff(prev_gray, gray)
    feats[_IDX["frame_diff"]] = np.log1p(20.0 * diff.mean() / 255.0)
    feats[_IDX["brightness_change"]] = abs(float(gray.mean()) - float(prev_gray.mean())) / 255.0

    if fg_mask is not None:
        fg, blob_h, blob_aspect = _largest_blob(fg_mask)
        feats[_IDX["fg_area"]] = fg
        feats[_IDX["blob_height"]] = blob_h
        feats[_IDX["blob_aspect"]] = blob_aspect
    return feats


def aggregate_window(frames: np.ndarray) -> np.ndarray:
    """(T, PER_FRAME_DIM) -> (FEATURE_DIM,)"""
    frames = np.asarray(frames, dtype=np.float32)
    speed = frames[:, _IDX["speed_mean"]]
    centroid = frames[:, _IDX["motion_centroid_y"]]
    blob_h = frames[:, _IDX["blob_height"]]
    aspect = frames[:, _IDX["blob_aspect"]]
    down = frames[:, _IDX["down_share"]]
    tail = max(1, len(frames) // 4)

    # Only count centroid travel on frames where something actually moved
    # (95th-percentile speed, so a single person in a large frame still counts)
    active = frames[:, _IDX["speed_p95"]] > np.log1p(10.0 * MOVING_SPEED)
    if active.sum() >= 2:
        cy = centroid[active]
        centroid_drop = float(cy[-1] - cy[0])
    else:
        centroid_drop = 0.0

    present = blob_h > 0
    if present.sum() >= 2:
        hb = blob_h[present]
        ab = aspect[present]
        blob_height_drop = float(hb.max() - hb[-tail:].mean())
        blob_aspect_rise = float(ab[-tail:].mean() - ab[:max(1, len(ab) - tail)].min())
    else:
        blob_height_drop = blob_aspect_rise = 0.0

    temporal = np.array([
        centroid_drop,
        blob_height_drop,
        blob_aspect_rise,
        float(speed.max() - speed[-tail:].mean()),
        float(np.max(np.abs(np.diff(speed)))) if len(speed) > 1 else 0.0,
        float(down.max() * speed.max()),
    ], dtype=np.float32)
    return np.concatenate([frames.mean(axis=0), frames.max(axis=0), temporal]).astype(np.float32)


class SceneFeatureExtractor:
    """Stateful helper: push frames, get a window feature vector when ready."""

    def __init__(self, fps: float = 5.0, window_frames: int = 10,
                 resize: Tuple[int, int] = (160, 120), bg_history: int = 300):
        self.fps = float(fps)
        self.window_frames = int(window_frames)
        self.resize = resize
        self.bg_history = int(bg_history)
        self._kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        self.reset()

    def reset(self) -> None:
        self._prev: Optional[np.ndarray] = None
        self._frames: Deque[np.ndarray] = deque(maxlen=self.window_frames)
        self._bg = cv2.createBackgroundSubtractorMOG2(history=self.bg_history, varThreshold=25,
                                                      detectShadows=True)

    def _foreground(self, small: np.ndarray) -> np.ndarray:
        mask = self._bg.apply(small)
        mask = np.where(mask >= 200, 255, 0).astype(np.uint8)  # drop shadows (127)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, self._kernel)
        return cv2.morphologyEx(mask, cv2.MORPH_CLOSE, self._kernel, iterations=2)

    def push(self, frame: np.ndarray) -> Optional[np.ndarray]:
        """Add a frame. Returns the current window vector once the window is full."""
        small = cv2.resize(frame, self.resize, interpolation=cv2.INTER_AREA)
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY) if small.ndim == 3 else small
        gray = cv2.GaussianBlur(gray, (5, 5), 0)
        fg = self._foreground(small)
        if self._prev is not None:
            self._frames.append(compute_frame_features(self._prev, gray, self.fps, fg))
        self._prev = gray
        if len(self._frames) < self.window_frames:
            return None
        return aggregate_window(np.stack(self._frames))


def video_windows(path: str, sample_fps: float = 5.0, window_frames: int = 10,
                  stride_frames: int = 2, resize: Tuple[int, int] = (160, 120),
                  max_seconds: Optional[float] = None) -> np.ndarray:
    """Decode a video at `sample_fps` and return all window vectors (N, FEATURE_DIM)."""
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise IOError(f"cannot open video: {path}")
    native_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    step = max(1, int(round(native_fps / sample_fps)))
    effective_fps = native_fps / step

    extractor = SceneFeatureExtractor(fps=effective_fps, window_frames=window_frames, resize=resize)
    out: List[np.ndarray] = []
    index = sampled = 0
    while True:
        ok = cap.grab()
        if not ok:
            break
        if index % step == 0:
            ok, frame = cap.retrieve()
            if not ok:
                break
            vec = extractor.push(frame)
            sampled += 1
            if vec is not None and (sampled - window_frames - 1) % stride_frames == 0:
                out.append(vec)
            if max_seconds and sampled / effective_fps >= max_seconds:
                break
        index += 1
    cap.release()
    if not out:
        return np.zeros((0, FEATURE_DIM), dtype=np.float32)
    return np.stack(out)
