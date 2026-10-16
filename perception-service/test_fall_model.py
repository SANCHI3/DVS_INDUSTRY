"""Tests for the pose-based fall model and runtime detector (synthetic skeletons;
no camera, GPU or YOLO needed).

Run:  python test_fall_model.py      (or: pytest test_fall_model.py)
"""
import numpy as np

from fall_rf.features import FEATURE_DIM, explain, physics_score, window_features
from fall_rf.synthetic import make_sequence


def _last_window(kind, seed=0, seconds=3.0):
    seq = make_sequence(kind, seconds=seconds, seed=seed)
    return window_features([s for s in seq if s.timestamp >= seq[-1].timestamp - 2.0])


def test_feature_vector_shape_and_finite():
    f = _last_window("fall")
    assert f.shape == (FEATURE_DIM,) and np.all(np.isfinite(f))


def test_physics_score_separates_fall_from_daily_activity():
    for seed in range(5):
        fall = physics_score(_last_window("fall", seed))
        assert fall > 0.85
        for kind in ("walk", "sit", "bend", "squat"):
            assert physics_score(_last_window(kind, seed)) < 0.3, kind
        # deliberate lying down reaches the same posture slowly -> scored lower than a fall
        assert physics_score(_last_window("lie_down", seed)) < fall - 0.2


def test_explanations_are_human_readable():
    reasons = explain(_last_window("fall"))
    assert any("torso" in r for r in reasons) and any("hips" in r for r in reasons)


class _FakePose:
    def __init__(self, bbox, keypoints):
        self.bbox, self.keypoints, self.confidence = bbox, keypoints, 0.9


class _FakeEstimator:
    def __init__(self):
        self.current = []

    def estimate(self, frame):
        return self.current


def _run_detector(kind, seconds=8.0):
    import temporal.pose_fall_recognition as pfr
    from temporal.pose_fall_recognition import PoseFallDetector
    from temporal.temporal_buffer import TemporalBuffer

    clock = {"t": 1000.0}
    real_time = pfr.time.time
    pfr.time.time = lambda: clock["t"]
    try:
        est = _FakeEstimator()
        det = PoseFallDetector("CAM-T", {"mode": "physics", "physics_threshold": 0.75,
                                         "confirm_still_seconds": 3.0}, pose_estimator=est)
        buf = TemporalBuffer()
        seq = make_sequence(kind, fps=10, seconds=seconds, seed=3)
        tiers = []
        for s in seq:
            clock["t"] = 1000.0 + s.timestamp
            buf.update(7, "person", s.bbox, 0.9, timestamp=clock["t"])
            est.current = [_FakePose(s.bbox, s.keypoints)]
            for c in det.evaluate(buf, frame=None):
                tiers.append(c.detail["requested_tier"])
        return tiers, det
    finally:
        pfr.time.time = real_time


def test_runtime_detector_confirms_a_fall():
    tiers, det = _run_detector("fall")
    assert "PROBABLE" in tiers and "CONFIRMED" in tiers, tiers
    assert tiers.index("PROBABLE") < tiers.index("CONFIRMED")
    assert det.diagnostics()["pose_runs"] > 0


def test_runtime_detector_ignores_daily_activity():
    for kind in ("walk", "sit", "bend", "squat"):
        tiers, _ = _run_detector(kind)
        assert not tiers, (kind, tiers)


def test_training_pipeline_smoke():
    """Builds a synthetic manifest and runs the real training script end-to-end."""
    try:
        import sklearn  # noqa: F401
    except ImportError:
        print("  (skipped: scikit-learn not installed)")
        return
    import csv
    import json
    import subprocess
    import sys
    import tempfile
    from pathlib import Path

    from fall_rf.extract_features import is_fall_window, windows_from_track
    from fall_rf.features import FEATURE_NAMES
    from fall_rf.infer import FallClassifier

    with tempfile.TemporaryDirectory() as d:
        out = Path(d)
        (out / "poses").mkdir()
        rows = []
        for cls, label, kinds in (("fall", 1, ["fall"]), ("not_fall", 0, ["walk", "sit", "bend", "squat", "lie_down"])):
            for i in range(15):
                kind = kinds[i % len(kinds)]
                seq = make_sequence(kind, seconds=4.0, seed=i + 50 * label)
                t = np.array([s.timestamp for s in seq]); k = np.stack([s.keypoints for s in seq])
                b = np.array([s.bbox for s in seq]); v = np.ones(len(t), bool)
                np.savez(out / "poses" / f"{cls}__{kind}{i}.npz", times=t, kps=k, boxes=b, valid=v)
                for w, (te, f) in enumerate(windows_from_track(t, k, b, v, 2.0, 0.5)):
                    rows.append({"video": f"{cls}/{kind}{i}", "label": label, "window": w, "t_end": te,
                                 "use_for_training": 1 if label == 0 else int(is_fall_window(f)),
                                 "physics_score": physics_score(f), **dict(zip(FEATURE_NAMES, f))})
        with open(out / "manifest.csv", "w", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=list(rows[0])); writer.writeheader(); writer.writerows(rows)
        model_path = out / "fall_test.joblib"
        subprocess.run([sys.executable, "-m", "fall_rf.train", "--manifest", str(out / "manifest.csv"),
                        "--output", str(model_path), "--folds", "3"], check=True, capture_output=True)
        report = json.loads((out / "fall_test.metrics.json").read_text())
        assert report["selected_model"] in report["models"] and "baselines" in report
        clf = FallClassifier(str(model_path))
        assert clf.score(_last_window("fall", 9)) > clf.score(_last_window("walk", 9))


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"PASS {name}")


def _skeleton(points):
    """17x3 keypoints; `points` maps keypoint index -> (x, y)."""
    kps = np.zeros((17, 3), dtype=np.float32)
    for i, (x, y) in points.items():
        kps[i] = (x, y, 0.9)
    return kps


def _plausibility(bbox, keypoints=None):
    from fall_gru.features import frame_features
    from temporal.fall_gru_recognition import fall_plausibility

    row = frame_features(bbox, 480, keypoints)
    return fall_plausibility(row, bottom_edge=0.99, require_down=True, max_torso_tilt=0.35, max_box_aspect=0.8)


def test_close_desk_webcam_view_is_not_judged_as_a_fall():
    # head and shoulders filling the lower frame, cut off at the bottom, no hips found
    shoulders_only = _skeleton({0: (320, 260), 5: (220, 420), 6: (420, 420)})
    assert _plausibility((120, 180, 520, 480), shoulders_only) == "truncated"
    assert _plausibility((120, 180, 520, 480)) == "truncated"


def test_person_standing_or_sitting_upright_is_not_a_fall():
    upright = _skeleton({5: (300, 150), 6: (340, 150), 11: (305, 300), 12: (335, 300)})
    assert _plausibility((280, 100, 360, 420), upright) == "upright"
    assert _plausibility((290, 80, 350, 400)) == "upright"          # tall box, no skeleton


def test_person_lying_on_the_floor_is_plausible():
    lying = _skeleton({5: (150, 380), 6: (150, 400), 11: (330, 385), 12: (330, 405)})
    assert _plausibility((100, 350, 450, 430), lying) is None
    assert _plausibility((100, 360, 450, 430)) is None                # wide box, no skeleton


def test_fallen_person_at_the_frame_edge_with_torso_visible_still_counts():
    lying = _skeleton({5: (150, 440), 6: (150, 465), 11: (330, 445), 12: (330, 470)})
    assert _plausibility((100, 400, 450, 480), lying) is None
