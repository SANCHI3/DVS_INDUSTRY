"""Tests for the GRU fall detector and the learned fire/smoke verifier.

Self-contained: tiny models are built on the fly, so no trained weights,
camera, GPU or YOLO download is needed.
"""
import pickle
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
# scikit-learn before torch: the reverse order trips a (handled) OpenMP DLL
# access violation on Windows that pytest's fault handler prints.
from sklearn.ensemble import HistGradientBoostingClassifier
import torch

from fall_gru.features import NUM_FEATURES, build_sequence, frame_features
from fall_gru.model import FallClassifier, FallNet, sliding_windows
from fire_verifier.features import NUM_FEATURES as FIRE_FEATURES, window_features
from fire_verifier.runtime import LearnedFireVerifier


def upright_keypoints(x=100.0, top=50.0, height=200.0):
    kps = np.zeros((17, 3), np.float32)
    kps[:, 2] = 0.9
    kps[0, :2] = (x, top + 0.05 * height)            # nose
    kps[5, :2], kps[6, :2] = (x - 15, top + 0.2 * height), (x + 15, top + 0.2 * height)
    kps[11, :2], kps[12, :2] = (x - 10, top + 0.55 * height), (x + 10, top + 0.55 * height)
    kps[15, :2], kps[16, :2] = (x - 10, top + height), (x + 10, top + height)
    return kps


class FallFeatureTests(unittest.TestCase):
    def test_upright_torso_has_small_tilt_and_lying_torso_large(self):
        upright = frame_features((80, 50, 120, 250), 480, upright_keypoints())
        self.assertLess(upright[4], 0.1)

        lying = np.zeros((17, 3), np.float32); lying[:, 2] = 0.9
        lying[5, :2], lying[6, :2] = (60, 400), (60, 405)     # shoulders level with hips
        lying[11, :2], lying[12, :2] = (160, 400), (160, 405)
        flat = frame_features((40, 380, 240, 430), 480, lying)
        self.assertGreater(flat[4], 0.9)
        self.assertGreater(flat[0], 1.0)  # wide box

    def test_missing_people_carry_forward_without_fake_motion(self):
        row = frame_features((80, 50, 120, 250), 480, None)
        seq = build_sequence([row, None, row], fps=10)
        self.assertEqual(seq.shape, (3, NUM_FEATURES))
        self.assertEqual(seq[1, -1], 0.0)                 # person_present flag
        self.assertTrue(np.allclose(seq[:, 10:14], 0.0))  # no velocity from dropout

    def test_sliding_windows_cover_short_and_long_clips(self):
        self.assertEqual(sliding_windows(np.zeros((10, NUM_FEATURES)), 40, 5).shape, (1, 40, NUM_FEATURES))
        long = sliding_windows(np.zeros((100, NUM_FEATURES)), 40, 5)
        self.assertEqual(long.shape[1:], (40, NUM_FEATURES))
        self.assertEqual(len(long), 13)


class GruFallDetectorTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.ckpt = Path(self.tmp.name) / "fall.pt"
        torch.save({"state_dict": FallNet().state_dict(), "threshold": 0.5, "window": 20,
                    "fps": 10.0, "hidden": 64}, self.ckpt)

    def tearDown(self):
        self.tmp.cleanup()

    def test_classifier_scores_a_sequence(self):
        clf = FallClassifier(self.ckpt, device="cpu")
        score = clf.score(np.random.rand(30, NUM_FEATURES).astype(np.float32))
        self.assertTrue(0.0 <= score <= 1.0)

    def test_detector_needs_persistence_and_applies_cooldown(self):
        from temporal.fall_gru_recognition import GruFallDetector

        pose = SimpleNamespace(estimate=lambda frame: [])
        detector = GruFallDetector("CAM-T", {"checkpoint": str(self.ckpt), "evaluation_stride_frames": 1,
                                             "persistence_window": 3, "required_hits": 2,
                                             "cooldown_seconds": 60}, pose_estimator=pose)
        state = SimpleNamespace(bbox=(80, 50, 120, 250))
        person = SimpleNamespace(track_id=7, states=[state], last_seen=lambda: 1e12)
        buffer = SimpleNamespace(tracks_by_class=lambda name: [person])
        frame = np.zeros((480, 640, 3), np.uint8)

        with patch.object(detector.classifier, "score", return_value=0.99):
            emitted = [len(detector.evaluate(buffer, frame)) for _ in range(15)]
        # Nothing until half a window is buffered, then the first alert only
        # after 2 high evaluations; the cooldown suppresses the rest.
        self.assertEqual(sum(emitted), 1)
        self.assertEqual(emitted.index(1), 10)


class FireVerifierTests(unittest.TestCase):
    @staticmethod
    def flicker_frames(k=5, flicker=True):
        rng = np.random.default_rng(0)
        frames = []
        for i in range(k):
            frame = np.full((240, 320, 3), 40, np.uint8)
            level = 200 + (rng.integers(-50, 50) if flicker else 0)
            frame[80:160, 120:200] = (30, 120, level)   # orange-ish BGR patch
            frames.append(frame)
        return frames

    def test_features_capture_flicker(self):
        box = (120, 80, 200, 160)
        boxes, confs = [box] * 5, [0.8] * 5
        live = window_features(self.flicker_frames(flicker=True), boxes, confs, True)
        static = window_features(self.flicker_frames(flicker=False), boxes, confs, True)
        self.assertEqual(live.shape, (FIRE_FEATURES,))
        brightness_std = 14  # index of "brightness_std"
        self.assertGreater(live[brightness_std], static[brightness_std])

    def test_no_detection_gives_no_features(self):
        self.assertIsNone(window_features(self.flicker_frames(), [None] * 5, [0.0] * 5, True))

    def test_runtime_requires_two_verified_windows(self):
        x = np.random.rand(40, FIRE_FEATURES)
        model = HistGradientBoostingClassifier(max_iter=5).fit(x, np.arange(40) % 2)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "v.pkl"
            with path.open("wb") as handle:
                pickle.dump({"model": model, "threshold": 0.5, "required_verified": 2, "window": 5}, handle)
            verifier = LearnedFireVerifier(path)

        box = ((120, 80, 200, 160), 0.8)
        frames = self.flicker_frames(k=8)
        with patch.object(verifier.model, "predict_proba", return_value=np.array([[0.1, 0.9]])):
            results = []
            for frame in frames:
                verifier.observe(frame, {"fire": box, "smoke": None})
                results.append(verifier.confirm("fire"))
        # Window not full for the first 4 frames; then the 2nd verified window passes
        self.assertEqual(results, [False, False, False, False, False, True, True, True])


if __name__ == "__main__":
    unittest.main()
