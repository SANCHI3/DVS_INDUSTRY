"""Tests for the fire verifier on synthetic look-alikes (no YOLO needed).

Run:  python test_fire_verifier.py      (or: pytest test_fire_verifier.py)
"""
import cv2
import numpy as np

from temporal.fire_verifier import FireVerifier

BOX = (100, 60, 220, 200)


def _background():
    frame = np.full((240, 320, 3), (70, 75, 80), np.uint8)
    cv2.rectangle(frame, (0, 200), (320, 240), (40, 60, 90), -1)
    return frame


def _flame(i, rng):
    """Flickering flame: bright yellow-white core, orange body, shape changes every frame."""
    frame = _background()
    pts = []
    for k in range(12):
        ang = 2 * np.pi * k / 12
        r = 45 + rng.uniform(-18, 18) + (25 if np.sin(ang) < 0 else 0)  # taller upwards
        pts.append((160 + r * 0.7 * np.cos(ang), 150 + r * np.sin(ang)))
    pts = np.array(pts, np.int32)
    cv2.fillPoly(frame, [pts], (0, 120, 255))                          # orange (BGR)
    cv2.fillPoly(frame, [((pts - [160, 150]) * 0.55 + [160, 155]).astype(np.int32)], (120, 235, 255))  # yellow-white core
    return frame


def _orange_bag(i):
    """Rigid orange object, evenly lit, translating -- the FIRESENSE false positive.
    Colour measured on the real clip: saturated orange but not self-luminous (V < 200)."""
    frame = _background()
    x = 120 + 3 * i
    cv2.rectangle(frame, (x, 100), (x + 60, 170), (25, 95, 190), -1)
    return frame


def _bokeh(i, rng):
    """Out-of-focus pink/white party lights."""
    frame = np.full((240, 320, 3), (30, 20, 35), np.uint8)
    for _ in range(25):
        # pink in BGR: blue above green (measured hue share in the real clip: 0% yellow-orange)
        c = (int(rng.integers(190, 230)), int(rng.integers(120, 170)), 255) if rng.random() < 0.5 else (235, 228, 240)
        cv2.circle(frame, (int(rng.integers(100, 220)), int(rng.integers(60, 200))), int(rng.integers(6, 14)), c, -1)
    return cv2.GaussianBlur(frame, (7, 7), 0)


def _run(make, n=12):
    ver = FireVerifier()
    rng = np.random.default_rng(1)
    scores = []
    for i in range(n):
        frame = make(i, rng) if make.__code__.co_argcount == 2 else make(i)
        scores.append(ver.verify(frame, [("fire", 0.70, BOX)])[0])
    return scores[2:]  # skip warm-up frames without flicker history


def test_real_flame_keeps_its_score():
    s = _run(_flame)
    assert np.median([x["verification"] for x in s]) > 0.8
    assert np.median([x["fused"] for x in s]) > 0.6     # still above the 0.5 alert threshold


def test_orange_object_is_suppressed():
    s = _run(_orange_bag)
    assert np.median([x["verification"] for x in s]) < 0.5
    assert np.median([x["fused"] for x in s]) < 0.5      # 0.70 YOLO detection no longer alerts


def test_bokeh_lights_are_suppressed():
    s = _run(_bokeh)
    assert np.median([x["fused"] for x in s]) < 0.5


def test_smoke_passes_through_unchanged():
    ver = FireVerifier()
    out = ver.verify(_background(), [("smoke", 0.66, BOX)])
    assert out[0]["fused"] == 0.66


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"PASS {name}")
