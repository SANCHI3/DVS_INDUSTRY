"""Unsupervised scene-anomaly detection (optical-flow features + autoencoder).

Unlike the YOLO / R3D-18 / LSTM modules, this model is trained ONLY on normal
footage. Anything it cannot reconstruct well is flagged as abnormal, so it can
catch incident types nobody labelled (running, stampede, falling objects,
equipment malfunction, sudden collapse).
"""
from anomaly.autoencoder import NumpyAutoencoder
from anomaly.scene_features import FEATURE_GROUPS, FEATURE_NAMES, SceneFeatureExtractor

__all__ = ["NumpyAutoencoder", "SceneFeatureExtractor", "FEATURE_NAMES", "FEATURE_GROUPS"]
