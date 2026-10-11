"""Tests for the unsupervised scene-anomaly module (no camera, GPU or YOLO needed).

Run:  python test_scene_anomaly.py      (or: pytest test_scene_anomaly.py)
"""
import os
import tempfile

import cv2
import numpy as np

from anomaly.autoencoder import NumpyAutoencoder
from anomaly.scene_features import FEATURE_DIM, FEATURE_NAMES, SceneFeatureExtractor


def _scene(blob_y=None, w=320, h=240, seed=0):
    rng = np.random.default_rng(seed)
    frame = np.full((h, w, 3), 90, np.uint8)
    cv2.rectangle(frame, (20, 150), (300, 230), (60, 80, 60), -1)   # static furniture
    frame += rng.integers(0, 4, frame.shape, dtype=np.uint8)        # sensor noise
    if blob_y is not None:
        cv2.rectangle(frame, (140, int(blob_y)), (180, int(blob_y) + 60), (200, 200, 230), -1)
    return frame


def test_gradients_match_numerical():
    rng = np.random.default_rng(0)
    model = NumpyAutoencoder.create(6, hidden=5, bottleneck=3, seed=1)
    x = rng.normal(size=(7, 6))
    _, gw, gb = model.loss_and_grads(x, x, weight_decay=0.0)
    eps = 1e-6
    for layer in range(len(model.weights)):
        for (i, j) in [(0, 0), (1, 2)]:
            if i >= model.weights[layer].shape[0] or j >= model.weights[layer].shape[1]:
                continue
            orig = model.weights[layer][i, j]
            model.weights[layer][i, j] = orig + eps
            plus = np.mean((model.reconstruct(x) - x) ** 2)
            model.weights[layer][i, j] = orig - eps
            minus = np.mean((model.reconstruct(x) - x) ** 2)
            model.weights[layer][i, j] = orig
            numeric = (plus - minus) / (2 * eps)
            assert abs(numeric - gw[layer][i, j]) < 1e-6, (layer, i, j, numeric, gw[layer][i, j])
        orig = model.biases[layer][0]
        model.biases[layer][0] = orig + eps
        plus = np.mean((model.reconstruct(x) - x) ** 2)
        model.biases[layer][0] = orig - eps
        minus = np.mean((model.reconstruct(x) - x) ** 2)
        model.biases[layer][0] = orig
        assert abs((plus - minus) / (2 * eps) - gb[layer][0]) < 1e-6


def test_training_learns_normal_and_flags_outliers():
    rng = np.random.default_rng(3)
    latent = rng.normal(size=(600, 2))
    mix = rng.normal(size=(2, 10))
    normal = latent @ mix + 0.05 * rng.normal(size=(600, 10))   # data on a 2-D manifold
    model = NumpyAutoencoder.create(10, hidden=8, bottleneck=2, seed=2)
    hist = model.fit(normal[:450], normal[450:], epochs=200, noise_std=0.05, verbose=False)
    assert hist["val_loss"][-1] < hist["val_loss"][0]
    model.calibrate(model.errors(normal[450:]), percentile=99)
    outliers = rng.normal(size=(50, 10)) * 2.0                   # off the manifold
    assert np.median(model.anomaly_ratio(outliers)) > 2.0
    assert np.mean(model.anomaly_ratio(normal[450:]) > 1.0) <= 0.05


def test_save_load_roundtrip():
    rng = np.random.default_rng(4)
    x = rng.normal(size=(100, FEATURE_DIM))
    model = NumpyAutoencoder.create(FEATURE_DIM, 16, 4)
    model.fit(x, x[:20], epochs=3, verbose=False)
    model.calibrate(model.errors(x))
    model.feature_names = FEATURE_NAMES
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "m.npz")
        model.save(path)
        loaded = NumpyAutoencoder.load(path)
    assert np.allclose(loaded.errors(x), model.errors(x))
    assert loaded.threshold == model.threshold and loaded.feature_names == FEATURE_NAMES


def test_features_capture_downward_motion():
    static = SceneFeatureExtractor(fps=5, window_frames=10)
    falling = SceneFeatureExtractor(fps=5, window_frames=10)
    vs = vf = None
    for i in range(12):
        vs = static.push(_scene(blob_y=60, seed=i))
        vf = falling.push(_scene(blob_y=20 + 12 * i, seed=i))
    assert vs.shape == (FEATURE_DIM,) and np.all(np.isfinite(vf))
    idx = {n: i for i, n in enumerate(FEATURE_NAMES)}
    assert vf[idx["mean_down_share"]] > 0.5 > vs[idx["mean_down_share"]]
    assert vf[idx["mean_speed_mean"]] > vs[idx["mean_speed_mean"]]
    assert vf[idx["centroid_drop"]] > 0.1


def test_runtime_detector_flags_and_holds_episode():
    from temporal.scene_anomaly import SceneAnomalyDetector

    rng = np.random.default_rng(5)
    # Train a tiny model on a quiet scene
    ext = SceneFeatureExtractor(fps=5, window_frames=10)
    normal = []
    for i in range(200):
        v = ext.push(_scene(blob_y=60, seed=i))
        if v is not None:
            normal.append(v)
    normal = np.stack(normal)
    model = NumpyAutoencoder.create(FEATURE_DIM, 16, 4)
    model.fit(normal, normal[-15:], epochs=60, verbose=False)
    model.calibrate(model.errors(normal), percentile=99)
    model.metadata = {"sample_fps": 5.0, "window_frames": 10}
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "ae.npz")
        model.save(path)
        det = SceneAnomalyDetector("CAM-T", {"checkpoint": path, "evaluation_stride_frames": 1,
                                             "persistence_window": 3, "required_hits": 2,
                                             "cooldown_seconds": 0}, fps=10)
        quiet = [det.evaluate(_scene(blob_y=60, seed=300 + i)) for i in range(120)]
        assert not any(quiet), "quiet scene must not alert"
        chaos = []
        for i in range(30):  # large object racing around the frame
            frame = _scene(seed=100 + i)
            y = int(20 + (i * 37) % 150)
            cv2.rectangle(frame, (int((i * 53) % 260), y), (int((i * 53) % 260) + 60, y + 80), (255, 255, 255), -1)
            chaos.append(det.evaluate(frame))
    flagged = [c for c in chaos if c]
    assert flagged, "abnormal motion should be flagged"
    first = next(i for i, c in enumerate(chaos) if c)
    # once active, the episode is re-asserted on every cycle (no gaps -> no duplicate incidents)
    assert all(chaos[i] for i in range(first, min(first + 4, len(chaos))))
    cand = flagged[-1][0]
    assert cand.event_type == "anomaly" and cand.detail["top_factors"] and cand.detail["factors"]


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"PASS {name}")
