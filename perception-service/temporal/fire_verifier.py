"""Second-stage verification for YOLO fire detections (classical computer vision).

YOLO answers "does this patch look like the fire images I was trained on?".
That makes it vulnerable to things that share fire's colour or texture.
On the FIRESENSE negatives used in this project, YOLO's false or near-false
alarms came from: an orange shopping bag, red toys and out-of-focus pink /
white party lights (bokeh).

This verifier checks three physical properties of real flames inside each
YOLO fire box, using only OpenCV + NumPy:

1. Fire colour     - share of pixels satisfying an RGB + YCbCr flame-colour rule
                     (R >= G > B, Cr > Cb, Y > Cb; after Chen 2004 / Celik 2009).
2. Luminous core   - share of those flame pixels that are BOTH very bright and
                     yellow-orange. Flames emit light; a bag or toy only reflects it.
3. Flicker         - how much the flame-pixel shape changes between consecutive
                     evaluations after compensating for translation. Flames
                     constantly change shape; rigid objects keep theirs.

    verification = 0.55 * luminous_core + 0.25 * flicker + 0.20 * colour   (each 0..1)
    fused_score  = yolo_confidence * ((1 - alpha) + alpha * verification)

With alpha = 0.6 the verifier can at most cut 60% of YOLO's confidence; it never
raises it. Strong YOLO detections of real fire keep a score above the alert
threshold, while colour look-alikes fall below it.
"""
from __future__ import annotations

from typing import Dict, List, Optional, Sequence, Tuple

import cv2
import numpy as np

Box = Tuple[float, float, float, float]


def fire_colour_mask(bgr: np.ndarray) -> np.ndarray:
    """Boolean mask of flame-coloured pixels."""
    b, g, r = [c.astype(np.int16) for c in cv2.split(bgr)]
    ycc = cv2.cvtColor(bgr, cv2.COLOR_BGR2YCrCb).astype(np.int16)
    y, cr, cb = ycc[..., 0], ycc[..., 1], ycc[..., 2]
    return (r >= 150) & (r >= g) & (g > b) & (cr > cb) & ((cr - cb) >= 30) & (y > cb)


def _aligned_shape_change(prev_mask: np.ndarray, mask: np.ndarray) -> Optional[float]:
    """1 - IoU of the two masks after aligning their centroids (None if too small)."""
    if prev_mask.sum() < 10 or mask.sum() < 10:
        return None
    cy, cx = np.argwhere(mask).mean(axis=0)
    py, px = np.argwhere(prev_mask).mean(axis=0)
    shift = np.float32([[1, 0, cx - px], [0, 1, cy - py]])
    moved = cv2.warpAffine(prev_mask.astype(np.uint8), shift, (mask.shape[1], mask.shape[0])).astype(bool)
    union = np.logical_or(moved, mask).sum()
    return float(1.0 - np.logical_and(moved, mask).sum() / union) if union else None


class FireVerifier:
    def __init__(self, cfg: Optional[dict] = None):
        cfg = cfg or {}
        self.alpha = float(cfg.get("alpha", 0.6))
        self.core_target = float(cfg.get("core_target", 0.35))
        self.flicker_target = float(cfg.get("flicker_target", 0.35))
        self.colour_target = float(cfg.get("colour_target", 0.20))
        self.bright_v = int(cfg.get("bright_value", 200))
        self.hue_range = tuple(cfg.get("yellow_hue_range", (8, 40)))  # OpenCV hue 0..180
        self.pad = float(cfg.get("box_padding", 0.10))
        self._prev: Optional[np.ndarray] = None

    def _crop(self, frame: np.ndarray, box: Box) -> Tuple[slice, slice]:
        h, w = frame.shape[:2]
        x1, y1, x2, y2 = box
        px, py = (x2 - x1) * self.pad, (y2 - y1) * self.pad
        xa, ya = int(max(0, x1 - px)), int(max(0, y1 - py))
        xb, yb = int(min(w, x2 + px)), int(min(h, y2 + py))
        return slice(ya, max(yb, ya + 1)), slice(xa, max(xb, xa + 1))

    def score_box(self, frame: np.ndarray, box: Box) -> Dict[str, float]:
        rows, cols = self._crop(frame, box)
        crop = frame[rows, cols]
        if crop.size == 0:
            return {"verification": 0.0, "colour": 0.0, "luminous_core": 0.0, "flicker": 0.0}
        mask = fire_colour_mask(crop)
        colour = float(mask.mean())
        core = 0.0
        if mask.any():
            hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
            hue, val = hsv[..., 0][mask], hsv[..., 2][mask]
            core = float(np.mean((val >= self.bright_v) & (hue >= self.hue_range[0]) & (hue <= self.hue_range[1])))
        flicker = None
        if self._prev is not None and self._prev.shape == frame.shape:
            flicker = _aligned_shape_change(fire_colour_mask(self._prev[rows, cols]), mask)

        c = min(colour / self.colour_target, 1.0)
        k = min(core / self.core_target, 1.0)
        # Without a previous frame, flicker is unknown: use a neutral 0.5
        f = 0.5 if flicker is None else min(flicker / self.flicker_target, 1.0)
        verification = 0.55 * k + 0.25 * f + 0.20 * c
        return {"verification": round(float(verification), 4), "colour": round(colour, 4),
                "luminous_core": round(core, 4), "flicker": round(-1.0 if flicker is None else flicker, 4)}

    def fuse(self, yolo_conf: float, verification: float) -> float:
        return float(yolo_conf * ((1.0 - self.alpha) + self.alpha * verification))

    def verify(self, frame: np.ndarray, detections: Sequence[Tuple[str, float, Box]]) -> List[dict]:
        """detections: (class_name, yolo_confidence, xyxy). Fire boxes are verified;
        other classes pass through unchanged. Call once per evaluated frame."""
        out = []
        for name, conf, box in detections:
            if name == "fire":
                parts = self.score_box(frame, box)
                out.append({"class": name, "yolo": float(conf),
                            "fused": self.fuse(conf, parts["verification"]), **parts})
            else:
                out.append({"class": name, "yolo": float(conf), "fused": float(conf)})
        self._prev = frame.copy()
        return out
