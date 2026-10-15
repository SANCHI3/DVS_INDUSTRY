"""Normal CCTV activity must NOT become an incident; genuine events still must.

Every check runs without a camera, GPU, torch or ultralytics: tracks are
written into TemporalBuffer with explicit timestamps, the fire/smoke YOLO is
replaced by a scripted fake, and frames are synthetic.

Run:  python test_false_positives.py      (or: pytest test_false_positives.py)
"""
from __future__ import annotations

import copy
import json
import os
import sys
import tempfile
import types

import cv2
import numpy as np
import yaml

if "ultralytics" not in sys.modules:  # only the type is imported; tests inject a fake model
    sys.modules["ultralytics"] = types.SimpleNamespace(YOLO=None)

from temporal.fire_dynamics import RegionDynamics
from temporal.fire_smoke_recognition import FireSmokeDetector
from temporal.interaction import InteractionValidator, agitation
from temporal.motion_gate import MotionOfInterestGate
from temporal.rule_engine import RuleEngine
from temporal.temporal_buffer import TemporalBuffer
from temporal.zones import zone_is_active, zone_warnings

with open("config/thresholds.yaml", encoding="utf-8") as _f:
    THRESHOLDS = yaml.safe_load(_f)

FPS = 10.0
DT = 1.0 / FPS
T0 = 1_000_000.0
ZONE = {"zone_id": "z1", "type": "restricted", "name": "Panel room",
        "polygon": [[0, 0], [200, 0], [200, 480], [0, 480]]}


def _engine(intrusion=False, zones=None):
    cfg = copy.deepcopy(THRESHOLDS)
    cfg["rules"]["intrusion"]["enabled"] = intrusion
    return RuleEngine({"id": "CAM-T", "zones": zones or [ZONE]}, cfg)


def _person_box(x, y_top=100, w=40, h=200):
    return (x, y_top, x + w, y_top + h)


def _run(engine, steps):
    """steps: list of (t, [(track_id, bbox, conf), ...]); returns all candidates."""
    buffer = TemporalBuffer()
    out = []
    for t, people in steps:
        for track_id, bbox, conf in people:
            buffer.update(track_id, "person", bbox, conf, timestamp=t)
        buffer.evict_stale(now=t)
        out += engine.evaluate(buffer)
    return out


def _of(cands, event):
    return [c for c in cands if c.event_type == event]


# --------------------------------------------------------------- lingering
def test_ghost_track_does_not_accumulate_dwell():
    """Person stands in the zone 4 s and leaves; another person stays in view
    elsewhere. The old rule kept timing the departed (buffered) track."""
    steps = []
    for i in range(int(25 * FPS)):
        t = T0 + i * DT
        people = [(2, _person_box(400), 0.9)]           # someone outside the zone
        if i < 4 * FPS:
            people.append((1, _person_box(80), 0.9))   # visitor inside, then leaves
        steps.append((t, people))
    assert not _of(_run(_engine(), steps), "loitering")


def test_standing_outside_zone_and_walking_through_are_normal():
    steps = []
    for i in range(int(30 * FPS)):
        t = T0 + i * DT
        x = 20 + i * 6  # walks left -> right across the zone at ~1.5 body-heights/s ... leaves after ~3 s
        steps.append((t, [(1, _person_box(400), 0.88), (2, _person_box(min(x, 600)), 0.9)]))
    assert not _of(_run(_engine(), steps), "loitering")


def test_boundary_flicker_is_not_lingering():
    """Foot point jitters across the zone edge: inside only half the time."""
    steps = []
    for i in range(int(20 * FPS)):
        x = 150 if i % 2 == 0 else 190  # centre 170 (inside) / 210 (outside)
        steps.append((T0 + i * DT, [(1, _person_box(x), 0.9)]))
    assert not _of(_run(_engine(), steps), "loitering")


def test_genuine_lingering_detected_with_measured_confidence():
    steps = [(T0 + i * DT, [(1, _person_box(80), 0.82)]) for i in range(int(12 * FPS))]
    found = _of(_run(_engine(), steps), "loitering")
    assert found, "a person staying 12 s in a restricted zone must be reported"
    c = found[-1]
    assert c.zone_id == "z1" and c.detail["dwell_seconds"] >= 10
    # confidence is the measured detector confidence, not 0.5 + dwell/40 (= 0.80 at 12 s)
    assert abs(c.raw_confidence - 0.82) < 1e-6, c.raw_confidence
    assert "confidence_basis" in c.detail


def test_per_zone_dwell_and_active_hours():
    zone = dict(ZONE, loitering_seconds=30)
    steps = [(T0 + i * DT, [(1, _person_box(80), 0.9)]) for i in range(int(15 * FPS))]
    assert not _of(_run(_engine(zones=[zone]), steps), "loitering")
    assert zone_is_active({"active_hours": "22:00-06:00"}, when=_local(23, 30))
    assert not zone_is_active({"active_hours": "22:00-06:00"}, when=_local(12, 0))
    assert zone_is_active({}, when=_local(12, 0))


def _local(hour, minute):
    import datetime as dt
    return dt.datetime(2026, 10, 15, hour, minute).timestamp()


def test_placeholder_zone_warning():
    warnings = zone_warnings([ZONE], 640, 480)
    assert warnings and "covers 31%" in warnings[0]


def test_intrusion_ignores_person_who_left():
    steps = []
    for i in range(int(6 * FPS)):
        people = [(9, _person_box(400), 0.9)]
        if i < 2:  # one brief sighting in the zone, then gone
            people.append((1, _person_box(80), 0.9))
        steps.append((T0 + i * DT, people))
    cands = _of(_run(_engine(intrusion=True), steps), "intrusion")
    # min_frames_inside not met by 2 frames; and later the ghost is ignored
    assert not cands
    genuine = [(T0 + i * DT, [(1, _person_box(80), 0.9)]) for i in range(10)]
    assert _of(_run(_engine(intrusion=True), genuine), "intrusion")


# ------------------------------------------------------------------- fight
def _pair_buffer(positions, seconds=3.0, jitter=0.0, size_jitter=0.0, seed=0, gait=0.0):
    """positions(t) -> list of (track_id, x) ; boxes 40x200 with optional noise.
    `gait` adds the box-width swing of walking legs (px, 2 Hz)."""
    rng = np.random.default_rng(seed)
    buffer = TemporalBuffer()
    for i in range(int(seconds * FPS)):
        t = T0 + i * DT
        swing = gait * np.sin(2 * np.pi * 2.0 * i * DT)
        for track_id, x in positions(i * DT):
            dx, dy = rng.normal(0, jitter, 2) if jitter else (0, 0)
            dw, dh = rng.normal(0, size_jitter, 2) if size_jitter else (0, 0)
            buffer.update(track_id, "person", (x + dx, 100 + dy, x + 40 + dx + dw + swing, 300 + dy + dh),
                          0.9, timestamp=t)
    return buffer


def test_people_standing_or_talking_close_is_not_a_fight():
    buffer = _pair_buffer(lambda t: [(1, 300), (2, 380)], jitter=2.0, size_jitter=2.0)
    ok, evidence = InteractionValidator(THRESHOLDS["fight_detection"]["interaction"]).validate(buffer)
    assert not ok and "not agitated" in evidence["reason"], evidence


def test_walking_past_each_other_is_not_a_fight():
    # two people walking in opposite directions at ~0.8 body-heights/s, passing closely
    buffer = _pair_buffer(lambda t: [(1, 200 + 160 * t), (2, 680 - 160 * t)], seconds=3.0,
                          jitter=2.0, size_jitter=2.0, gait=8.0)
    ok, evidence = InteractionValidator(THRESHOLDS["fight_detection"]["interaction"]).validate(buffer)
    assert not ok, evidence


def test_one_person_with_two_ids_is_not_a_pair():
    """ByteTrack keeps two IDs on one moving person: near-identical boxes."""
    buffer = TemporalBuffer()
    rng = np.random.default_rng(7)
    for i in range(30):
        x = 300 + rng.normal(0, 10)
        w = 40 + rng.normal(0, 15)
        for track_id, offset in ((1, 0.0), (2, 2.0)):
            buffer.update(track_id, "person", (x + offset, 100, x + w + offset, 300), 0.9, timestamp=T0 + i * DT)
    ok, evidence = InteractionValidator().validate(buffer)
    assert not ok and evidence.get("people_in_view") == 1, evidence
    assert MotionOfInterestGate(300, 30).find_candidate_pairs(buffer) == []


def test_ghost_track_does_not_open_fight_gate():
    """ID switch: old ID 1 stays buffered (not seen for 3 s) next to new ID 2."""
    buffer = TemporalBuffer()
    for i in range(10):
        buffer.update(1, "person", _person_box(300 + 8 * i), 0.9, timestamp=T0 + i * DT)
    for i in range(30, 45):
        buffer.update(2, "person", _person_box(340 + 8 * (i - 30)), 0.9, timestamp=T0 + i * DT)
    assert MotionOfInterestGate(300, 30).find_candidate_pairs(buffer) == []
    ok, _ = InteractionValidator().validate(buffer)
    assert not ok


def test_agitated_close_pair_is_accepted():
    """Grappling/punching: close together, boxes jerk and change shape."""
    buffer = _pair_buffer(lambda t: [(1, 300), (2, 350)], jitter=12.0, size_jitter=25.0, seed=3)
    ok, evidence = InteractionValidator(THRESHOLDS["fight_detection"]["interaction"]).validate(buffer)
    assert ok, evidence
    assert sorted(evidence["track_ids"]) == [1, 2]


def test_agitated_people_far_apart_are_not_a_fight():
    buffer = _pair_buffer(lambda t: [(1, 50), (2, 560)], jitter=12.0, size_jitter=25.0, seed=4)
    ok, evidence = InteractionValidator().validate(buffer)
    assert not ok and "close" in evidence["reason"], evidence


def test_agitation_scale():
    limit = THRESHOLDS["fight_detection"]["interaction"]["min_agitation_heights"]
    standing = _pair_buffer(lambda t: [(1, 300)], jitter=3.0, size_jitter=3.0).get(1).states
    walking = _pair_buffer(lambda t: [(1, 100 + 160 * t)], jitter=2.0, size_jitter=2.0, gait=8.0).get(1).states
    # walk, then stop (and turn): a smooth path
    stop = _pair_buffer(lambda t: [(1, 100 + 160 * min(t, 1.5))], jitter=2.0, gait=4.0).get(1).states
    fighting = _pair_buffer(lambda t: [(1, 300)], jitter=12.0, size_jitter=25.0).get(1).states
    values = [agitation(list(s)) for s in (standing, walking, stop, fighting)]
    assert max(values[:3]) < limit < values[3], values


def _rgb_detector(score):
    """RgbFightDetector with a fake clip classifier that always returns `score`."""
    fake = types.ModuleType("rgb_fight_model.infer")

    class FakeClassifier:
        clip_frames, clip_fps = 4, None

        def __init__(self, _checkpoint):
            pass

        def score_clip(self, clip, input_bgr=True):
            return score

    fake.RgbFightClassifier = FakeClassifier
    sys.modules["rgb_fight_model.infer"] = fake
    sys.modules.pop("temporal.rgb_action_recognition", None)
    from temporal.rgb_action_recognition import RgbFightDetector
    cfg = copy.deepcopy(THRESHOLDS["fight_detection"])
    cfg["gate"]["velocity_threshold_px_s"] = 0       # open the gate; test the final decision
    cfg["rgb"].update({"evaluation_stride_frames": 1, "explain": False})
    return RgbFightDetector("CAM-T", cfg)


def _feed_rgb(detector, buffer_fn, steps=30):
    frame = np.zeros((240, 320, 3), np.uint8)
    out = []
    for n in range(10, steps + 1):
        out += detector.evaluate(buffer_fn(n), frame)
    return out


def test_high_model_score_without_interaction_is_rejected():
    """R3D-18 scores ordinary activity high (domain shift): no incident when
    the tracks show two people just standing/talking."""
    detector = _rgb_detector(0.97)
    calm = lambda n: _pair_buffer(lambda t: [(1, 300), (2, 380)], seconds=n * DT, jitter=2.0, size_jitter=2.0)
    assert not _feed_rgb(detector, calm)
    assert detector.diagnostics()["rejected_no_interaction"] > 0


def test_high_model_score_with_interaction_is_reported():
    detector = _rgb_detector(0.9)
    fight = lambda n: _pair_buffer(lambda t: [(1, 300), (2, 350)], seconds=n * DT, jitter=12.0,
                                   size_jitter=25.0, seed=3)
    out = _feed_rgb(detector, fight)
    assert out and out[0].event_type == "fight"
    assert abs(out[0].raw_confidence - 0.9) < 1e-9 and out[0].detail["interaction"]["agitated"]


# --------------------------------------------------------------- fire/smoke
class _Boxes:
    def __init__(self, dets):
        self.cls = _L([d[0] for d in dets])
        self.conf = _L([d[1] for d in dets])
        self.xyxy = _L([list(d[2]) for d in dets])


class _L(list):
    def tolist(self):
        return list(self)


class _FakeYolo:
    """Returns scripted detections: script(i) -> [(cls_id, conf, box)]."""
    names = {0: "fire", 1: "smoke"}

    def __init__(self, script):
        self.script, self.calls = script, 0

    def predict(self, **_):
        dets = self.script(self.calls)
        self.calls += 1
        return [types.SimpleNamespace(boxes=_Boxes(dets) if dets else None)]


def _fire_cfg():
    cfg = copy.deepcopy(THRESHOLDS["fire_smoke_detection"])
    cfg["verifier"] = {"enabled": False}
    cfg["evaluation_stride_frames"] = 1
    return cfg


def _run_fire(frames, script, fps=FPS):
    det = FireSmokeDetector("CAM-T", _fire_cfg(), model=_FakeYolo(script))
    out = []
    for i, frame in enumerate(frames):
        out += det.evaluate(frame, now=T0 + i / fps)
    return det, out


BOX = (120, 60, 200, 160)


def _room(rng, brightness=90):
    frame = np.full((240, 320, 3), brightness, np.uint8)
    cv2.rectangle(frame, (20, 170), (300, 230), (60, 80, 60), -1)
    frame = cv2.add(frame, rng.integers(0, 4, frame.shape, dtype=np.uint8))
    return frame


def _poster(frame):
    cv2.rectangle(frame, BOX[:2], BOX[2:], (0, 120, 255), -1)  # static orange object
    return frame


def test_static_orange_object_is_not_fire():
    rng = np.random.default_rng(0)
    frames = [_poster(_room(rng)) for _ in range(150)]
    det, out = _run_fire(frames, lambda i: [(0, 0.78, BOX)])
    assert not out, out
    assert det.diagnostics()["alarms_rejected_static_region"] > 0


def test_auto_exposure_change_is_not_fire():
    """Camera auto-exposure / lights dimming: every pixel scales together."""
    rng = np.random.default_rng(1)
    base = [_poster(_room(rng)) for _ in range(120)]
    frames = [np.clip(f.astype(np.float32) * (0.7 + 0.005 * i), 0, 255).astype(np.uint8)
              for i, f in enumerate(base)]
    _, out = _run_fire(frames, lambda i: [(0, 0.7, BOX), (1, 0.6, (0, 0, 320, 120))])
    assert not out, out


def test_person_walking_elsewhere_does_not_make_static_object_dynamic():
    rng = np.random.default_rng(2)
    frames = []
    for i in range(120):
        frame = _poster(_room(rng))
        x = (i * 7) % 280
        cv2.rectangle(frame, (x, 170), (x + 30, 235), (200, 200, 230), -1)  # below the object
        frames.append(frame)
    _, out = _run_fire(frames, lambda i: [(0, 0.75, BOX)])
    assert not out


def test_flickering_flame_is_detected_and_confirmed():
    rng = np.random.default_rng(3)
    frames = []
    for _ in range(80):
        frame = _room(rng)
        region = frame[BOX[1]:BOX[3], BOX[0]:BOX[2]]
        region[:] = np.stack([rng.integers(0, 60, region.shape[:2]),
                              rng.integers(60, 200, region.shape[:2]),
                              rng.integers(180, 256, region.shape[:2])], axis=-1)
        frames.append(frame)
    scores = [0.6, 0.7, 0.8]
    _, out = _run_fire(frames, lambda i: [(0, scores[i % 3], BOX)])
    assert out, "a flickering flame must still raise fire_smoke"
    first = out[0]
    assert first.detail["dynamics"]["fire"]["dynamic"]
    # requires 3 hits -> first alarm within the first second of detections
    tiers = [c.detail["requested_tier"] for c in out]
    assert "CONFIRMED" in tiers, tiers
    # confidence = mean of positive scores (0.7), not the peak (0.8)
    assert abs(out[-1].raw_confidence - 0.7) < 0.02, out[-1].raw_confidence
    assert out[-1].detail["fire_peak_score"] == 0.8


def test_slowly_growing_smoke_is_detected():
    """Smoke that drifts slowly (weak frame-to-frame flicker) appearing in a
    scene the detector has already watched: passes through the growth check."""
    rng = np.random.default_rng(4)
    frames, boxes = [], []
    for i in range(200):
        frame = _room(rng)
        if i >= 100:
            r = 10 + (i - 100) // 2
            cv2.circle(frame, (160, 90), r, (170, 170, 170), -1)
            boxes.append((160 - r, 90 - r, 160 + r, 90 + r))
        else:
            boxes.append(None)
        frames.append(frame)
    _, out = _run_fire(frames, lambda i: [(1, 0.65, boxes[i])] if boxes[i] else [])
    assert out, "growing smoke must be reported"
    assert out[0].detail["detected_classes"] == ["smoke"]


def test_learned_verifier_forgets_old_approvals():
    from fire_verifier.runtime import LearnedFireVerifier
    v = LearnedFireVerifier.__new__(LearnedFireVerifier)
    from collections import deque
    v.verdicts = {"fire": deque([True, True], maxlen=10), "smoke": deque(maxlen=10)}
    v.last_probability = {"fire": 0.9, "smoke": 0.0}
    v.reset("fire")
    assert not v.verdicts["fire"] and v.last_probability["fire"] == 0.0


def test_region_dynamics_static_vs_flicker():
    rng = np.random.default_rng(5)
    dyn = RegionDynamics({"min_ratio": 2.0})
    for i in range(6):
        dyn.observe(_poster(_room(rng)), T0 + i * 0.2)
    assert not dyn.assess(BOX)["dynamic"]


# ------------------------------------------------------------------ anomaly
def test_anomaly_needs_camera_calibration_before_alerting():
    import test_scene_anomaly as tsa
    from anomaly.autoencoder import NumpyAutoencoder
    from anomaly.scene_features import FEATURE_DIM, SceneFeatureExtractor
    from temporal.scene_anomaly import SceneAnomalyDetector

    def walk(i, amplitude, period, seed):  # a person moving up and down the frame
        return tsa._scene(blob_y=60 - amplitude + 2 * amplitude * abs((i % period) / (period / 2) - 1),
                          seed=seed + i)

    # model trained on another site with little movement ...
    ext = SceneFeatureExtractor(fps=5, window_frames=10)
    normal = np.stack([v for v in (ext.push(walk(i, 10, 40, 0)) for i in range(300)) if v is not None])
    model = NumpyAutoencoder.create(FEATURE_DIM, 16, 4)
    model.fit(normal, normal[-15:], epochs=60, verbose=False)
    model.calibrate(model.errors(normal), percentile=99)
    model.metadata = {"sample_fps": 5.0, "window_frames": 10}

    def busy_normal(i):  # ... deployed on a camera whose NORMAL activity is busier
        return walk(i, 30, 24, 500)

    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "ae.npz")
        model.save(path)
        cfg = {"checkpoint": path, "evaluation_stride_frames": 1, "persistence_window": 3,
               "required_hits": 2, "cooldown_seconds": 0,
               "calibration": {"enabled": True, "seconds": 30, "min_windows": 20, "dir": d}}
        det = SceneAnomalyDetector("CAM-T", cfg, fps=10)
        during = [det.evaluate(busy_normal(i), now=T0 + i * DT) for i in range(400)]
        assert not any(during[:250]), "no alerts while the camera is being calibrated"
        assert det.calibrated
        saved = json.load(open(os.path.join(d, "scene_anomaly_CAM-T.json")))
        assert saved["camera_scale"] >= 1.0 and saved["windows"] >= 20
        after = [det.evaluate(busy_normal(400 + i), now=T0 + (400 + i) * DT) for i in range(150)]
        assert not any(after), "calibrated camera: normal activity stays quiet"
        uncalibrated = SceneAnomalyDetector("CAM-U", dict(cfg, calibration={"enabled": False}), fps=10)
        old = [uncalibrated.evaluate(busy_normal(i), now=T0 + i * DT) for i in range(550)]
        assert sum(1 for a in old[400:] if a) > 100, "the old behaviour: alert on normal activity"

        chaos = []
        for i in range(40):
            frame = tsa._scene(seed=900 + i)
            y = int(20 + (i * 37) % 150)
            x = int((i * 53) % 260)
            cv2.rectangle(frame, (x, y), (x + 60, y + 80), (255, 255, 255), -1)
            chaos.append(det.evaluate(frame, now=T0 + (550 + i) * DT))
        flagged = [c for c in chaos if c]
        assert flagged, "abnormal motion must still be flagged after calibration"
        cand = flagged[-1][0]
        assert 0.5 <= cand.raw_confidence < 1.0 and "confidence_basis" in cand.detail

        # reloaded on restart, no second calibration
        det2 = SceneAnomalyDetector("CAM-T", cfg, fps=10)
        assert det2.calibrated and abs(det2.camera_scale - det.camera_scale) < 1e-3


# --------------------------------------------------------------- reporting
def test_llm_cannot_change_type_confidence_or_add_facts():
    from llm import summarizer
    from schemas.incident_schema import IncidentRecord

    assert set(summarizer.IncidentAnalysis.model_fields) == {
        "incident_id", "camera_id", "camera_location", "summary"}
    record = IncidentRecord.model_validate({
        "incident_id": "INC-T", "camera_id": "CAM-T", "location": "Test Room",
        "event_type": "fire_smoke", "confidence_tier": "PROBABLE", "confidence_score": 0.62,
        "severity": "HIGH", "detected_at": "2026-10-15T00:00:00+00:00", "duration_s": 1.0,
        "description": "x", "detected_objects": [], "zone_id": None,
        "detail": {"detected_classes": ["smoke"]},
        "evidence": {"clip_before": None, "clip_after": None, "keyframes": []},
        "recommended_action": "x", "review_status": "pending"})
    invented = "Confirmed fire in Test Room with 99% certainty. Evacuate now."
    assert not summarizer._summary_preserves_required_facts(invented, record)


def test_loitering_description_does_not_claim_same_spot():
    from reporting.description_generator import generate_description
    text = generate_description("loitering", "Test Room",
                                {"dwell_seconds": 12, "zone_type": "restricted", "zone_name": "Panel room"})
    assert "same spot" not in text and "Panel room" in text


if __name__ == "__main__":
    failures = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {name}")
            except AssertionError as exc:
                failures += 1
                print(f"FAIL {name}: {exc}")
    sys.exit(1 if failures else 0)
