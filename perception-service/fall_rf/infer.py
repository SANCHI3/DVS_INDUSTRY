"""Load a trained fall classifier (joblib) and score feature vectors."""
from __future__ import annotations

import numpy as np

from fall_rf.features import FEATURE_NAMES


class FallClassifier:
    def __init__(self, checkpoint_path: str):
        import joblib

        bundle = joblib.load(checkpoint_path)
        if list(bundle["feature_names"]) != FEATURE_NAMES:
            raise ValueError("fall checkpoint was trained with a different feature set; re-run training")
        self.model = bundle["model"]
        self.threshold = float(bundle["threshold"])
        self.required_windows = int(bundle.get("required_windows", 2))
        self.name = bundle.get("model_name", "classifier")

    def score(self, features: np.ndarray) -> float:
        return float(self.model.predict_proba(np.asarray(features, dtype=np.float32).reshape(1, -1))[0, 1])
