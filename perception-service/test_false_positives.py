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
from temporal.temporal_buffer import TemporalBuffer

with open("config/thresholds.yaml", encoding="utf-8") as _f:
    THRESHOLDS = yaml.safe_load(_f)

FPS = 10.0
DT = 1.0 / FPS
T0 = 1_000_000.0


def _person_box(x, y_top=100, w=40, h=200):
    return (x, y_top, x + w, y_top + h)


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


def _rgb_detector(score, mode=None, alarm=None):
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
    if mode is not None:
        cfg["interaction"]["mode"] = mode
    if alarm is not None:
        cfg["rgb"]["alarm_threshold"] = alarm
    return RgbFightDetector("CAM-T", cfg)


def _feed_rgb(detector, buffer_fn, steps=30):
    frame = np.zeros((240, 320, 3), np.uint8)
    out = []
    for n in range(10, steps + 1):
        out += detector.evaluate(buffer_fn(n), frame)
    return out


def _tiers(candidates):
    """Tiers the real confirmation step reports for these fight candidates."""
    from confirmation.event_confirmation import EventConfirmation
    confirmation = EventConfirmation(THRESHOLDS["confirmation"])
    return [event.tier for c in candidates for event in confirmation.update([c])]


def _calm_pair(n):
    return _pair_buffer(lambda t: [(1, 300), (2, 380)], seconds=n * DT, jitter=2.0, size_jitter=2.0)


def _fighting_pair(n):
    return _pair_buffer(lambda t: [(1, 300), (2, 350)], seconds=n * DT, jitter=12.0, size_jitter=25.0, seed=3)


def test_review_is_the_default_interaction_mode():
    assert THRESHOLDS["fight_detection"]["interaction"]["mode"] == "review"


def test_high_model_score_without_interaction_goes_to_review():
    """R3D-18 scores ordinary activity high (domain shift). Without track
    evidence of an interaction the fight is not dropped: it is sent to an
    operator as PROBABLE with the evidence attached."""
    detector = _rgb_detector(0.97)
    out = _feed_rgb(detector, _calm_pair)
    assert out and out[0].event_type == "fight"
    detail = out[0].detail
    assert detail["interaction_passed"] is False
    assert detail["requested_tier"] == "PROBABLE"
    assert detail["interaction"]["reason"] and "review_reason" in detail
    assert set(_tiers(out)) == {"PROBABLE"}
    assert detector.diagnostics()["review_no_interaction"] > 0
    assert detector.diagnostics()["rejected_no_interaction"] == 0


def test_high_model_score_with_interaction_is_confirmed():
    detector = _rgb_detector(0.9)
    out = _feed_rgb(detector, _fighting_pair)
    assert out and out[0].event_type == "fight"
    assert abs(out[0].raw_confidence - 0.9) < 1e-9 and out[0].detail["interaction"]["agitated"]
    assert out[0].detail["interaction_passed"] is True
    assert "requested_tier" not in out[0].detail
    assert _tiers(out)[0] == "CONFIRMED"


def test_agitated_pair_below_the_alarm_threshold_goes_to_review():
    """Two-level rule: the 2-of-3 rule fired and the tracks show a fight, but
    the scores are below the alarm threshold: reported for review, no pop-up."""
    from reporting.description_generator import generate_description, is_review_fight
    from reporting.incident_report import is_dashboard_review
    detector = _rgb_detector(0.65, alarm=0.75)
    out = _feed_rgb(detector, _fighting_pair)
    assert out and out[0].detail["interaction_passed"] is True
    assert out[0].detail["review"] is True and out[0].detail["review_kind"] == "low_score"
    assert out[0].detail["requested_tier"] == "PROBABLE"
    assert _tiers(out)[0] == "PROBABLE"
    assert is_review_fight(out[0].detail)
    assert is_dashboard_review({"event_type": "fight", "confidence_tier": "PROBABLE", "detail": out[0].detail})
    assert "not sure enough to raise an alarm" in generate_description("fight", "Hall", out[0].detail)
    assert detector.diagnostics()["review_low_score"] > 0


def test_agitated_pair_at_the_alarm_threshold_is_confirmed():
    out = _feed_rgb(_rgb_detector(0.8, alarm=0.75), _fighting_pair)
    assert out and "review" not in out[0].detail
    assert _tiers(out)[0] == "CONFIRMED"


def test_veto_mode_still_drops_a_fight_without_interaction():
    detector = _rgb_detector(0.97, mode="veto")
    assert not _feed_rgb(detector, _calm_pair)
    assert detector.diagnostics()["rejected_no_interaction"] > 0


def test_off_mode_reports_without_checking_tracks():
    detector = _rgb_detector(0.97, mode="off")
    out = _feed_rgb(detector, _calm_pair)
    assert out and "interaction_passed" not in out[0].detail
    assert _tiers(out)[0] == "CONFIRMED"


def test_review_fight_reaches_the_dashboard_quietly_and_is_confirmed_by_escalation():
    """A review fight is created on the dashboard as "please check" without a
    confidence (no pop-up), at base severity; when the same fight is confirmed
    the existing incident is escalated with the confidence instead of a second
    incident being created."""
    from reporting.incident_report import REVIEW_FIGHT_TITLE, IncidentReporter, is_dashboard_review
    from severity.severity_rules import compute_severity

    review_candidate = _feed_rgb(_rgb_detector(0.97), _calm_pair)[0]
    event = type("E", (), {})()
    event.event_type, event.camera_id, event.tier = "fight", "CAM-T", "PROBABLE"
    event.confidence, event.duration_s, event.candidate = 0.97, 6.0, review_candidate
    severity = compute_severity("fight", event, THRESHOLDS["severity"])
    assert severity == THRESHOLDS["severity"]["base"]["fight"]       # no bump before confirmation

    calls = []
    reporter = IncidentReporter.__new__(IncidentReporter)
    reporter._reports = {}
    reporter._dispatch = lambda fn: fn()
    reporter._flush_outbox = lambda: None
    reporter._post_dashboard_incident = lambda payload: calls.append(("create", payload))
    reporter._escalate_dashboard_incident = lambda *a: calls.append(("escalate", a))
    reporter._enrich_if_configured = lambda incident_id: calls.append(("enrich", incident_id))

    report = {"incident_id": "INC-T-1", "event_type": "fight", "confidence_tier": "PROBABLE",
              "confidence_score": 0.97, "severity": severity, "description": "d", "location": "Hall",
              "detected_at": "2026-10-18T10:00:00+00:00", "detail": dict(review_candidate.detail)}
    assert is_dashboard_review(report)
    reporter._remember(report)
    reporter._create_dashboard_incident(report)
    kind, payload = calls[-1]
    assert kind == "create" and payload["title"] == REVIEW_FIGHT_TITLE and payload["confidenceScore"] is None

    reporter._forward_update("INC-T-1", {"confidence_tier": "CONFIRMED", "confidence_score": 0.95,
                                         "severity": "HIGH", "detail": {"interaction_passed": True}})
    assert [c[0] for c in calls[1:]] == ["escalate", "enrich"]
    assert calls[1][1][3] == 0.97                                     # confidence never lowered


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


def _run_fire(frames, script, fps=FPS, person_boxes=None):
    det = FireSmokeDetector("CAM-T", _fire_cfg(), model=_FakeYolo(script))
    out = []
    for i, frame in enumerate(frames):
        out += det.evaluate(frame, now=T0 + i / fps, person_boxes=person_boxes)
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


def _growing_smoke():
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
    return frames, boxes


def test_smoke_detected_on_a_person_close_to_the_camera_is_ignored():
    """Dark hair / clothes blurred close to a webcam look like smoke to the
    model; such a box lies inside the person's box."""
    frames, boxes = _growing_smoke()
    person = (80, 0, 260, 240)   # head and shoulders filling the middle of the frame
    det, out = _run_fire(frames, lambda i: [(1, 0.65, boxes[i])] if boxes[i] else [], person_boxes=[person])
    assert out == []
    assert det.diagnostics()["smoke_boxes_on_person"] > 0


def test_smoke_next_to_a_person_is_still_detected():
    frames, boxes = _growing_smoke()
    person = (240, 60, 300, 230)  # someone standing beside the smoke
    _, out = _run_fire(frames, lambda i: [(1, 0.65, boxes[i])] if boxes[i] else [], person_boxes=[person])
    assert out and out[0].detail["detected_classes"] == ["smoke"]


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
