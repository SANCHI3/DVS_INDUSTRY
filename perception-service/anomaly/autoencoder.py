"""A small denoising autoencoder implemented in pure NumPy.

Why NumPy instead of PyTorch?
- The model is tiny (51 -> 32 -> 8 -> 32 -> 51), so training takes seconds on CPU.
- The saved weights are a plain .npz file, loadable on any machine with NumPy,
  with no framework or version-compatibility issues.
- Every step of the forward and backward pass is visible, which makes it easy
  to explain in a project report or viva.

Training objective: reconstruct *normal* scene-motion vectors. At run time a
window the network cannot reconstruct well (high error) is unlike anything
seen in normal operation and is reported as an anomaly.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence

import numpy as np


def _tanh_grad(a: np.ndarray) -> np.ndarray:
    return 1.0 - a * a


@dataclass
class NumpyAutoencoder:
    layer_sizes: Sequence[int]
    weights: List[np.ndarray] = field(default_factory=list)
    biases: List[np.ndarray] = field(default_factory=list)
    mean: Optional[np.ndarray] = None
    std: Optional[np.ndarray] = None
    threshold: float = 0.0
    calibration: Dict[str, float] = field(default_factory=dict)
    feature_names: List[str] = field(default_factory=list)
    metadata: Dict[str, object] = field(default_factory=dict)

    # ------------------------------------------------------------------ init
    @classmethod
    def create(cls, input_dim: int, hidden: int = 32, bottleneck: int = 8,
               seed: int = 7) -> "NumpyAutoencoder":
        rng = np.random.default_rng(seed)
        sizes = [input_dim, hidden, bottleneck, hidden, input_dim]
        weights, biases = [], []
        for fan_in, fan_out in zip(sizes[:-1], sizes[1:]):
            limit = np.sqrt(6.0 / (fan_in + fan_out))  # Xavier/Glorot uniform
            weights.append(rng.uniform(-limit, limit, size=(fan_in, fan_out)))
            biases.append(np.zeros(fan_out))
        return cls(layer_sizes=sizes, weights=weights, biases=biases)

    # ------------------------------------------------------------- scaling
    def fit_scaler(self, x: np.ndarray, std_floor: float = 0.02) -> None:
        """Standardise features. The std floor stops near-constant features (e.g. a
        quiet camera at night) from turning tiny sensor noise into huge errors."""
        self.mean = x.mean(axis=0)
        self.std = np.maximum(x.std(axis=0), std_floor)

    def _scale(self, x: np.ndarray) -> np.ndarray:
        return np.clip((x - self.mean) / self.std, -6.0, 6.0)

    # ------------------------------------------------------------- forward
    def _forward(self, x: np.ndarray):
        activations = [x]
        a = x
        last = len(self.weights) - 1
        for i, (w, b) in enumerate(zip(self.weights, self.biases)):
            z = a @ w + b
            a = z if i == last else np.tanh(z)  # linear output layer
            activations.append(a)
        return activations

    def reconstruct(self, x_scaled: np.ndarray) -> np.ndarray:
        return self._forward(x_scaled)[-1]

    # ------------------------------------------------------------ training
    def loss_and_grads(self, x_in: np.ndarray, target: np.ndarray, weight_decay: float = 0.0):
        """Backpropagation for the mean-squared reconstruction loss.

        Returns (sum of squared errors, weight gradients, bias gradients) for
        loss = mean((f(x_in) - target)^2) + weight_decay/2 * sum(W^2).
        """
        acts = self._forward(x_in)
        diff = acts[-1] - target
        grad = 2.0 * diff / diff.size
        n_layers = len(self.weights)
        grads_w, grads_b = [None] * n_layers, [None] * n_layers
        for i in range(n_layers - 1, -1, -1):
            grads_w[i] = acts[i].T @ grad + weight_decay * self.weights[i]
            grads_b[i] = grad.sum(axis=0)
            if i > 0:
                grad = (grad @ self.weights[i].T) * _tanh_grad(acts[i])
        return float(np.sum(diff ** 2)), grads_w, grads_b

    def fit(self, x_train: np.ndarray, x_val: Optional[np.ndarray] = None, epochs: int = 300,
            batch_size: int = 64, lr: float = 1e-3, weight_decay: float = 1e-4,
            noise_std: float = 0.1, patience: int = 30, seed: int = 7,
            verbose: bool = True) -> Dict[str, list]:
        """Adam + mini-batch gradient descent on the denoising MSE objective."""
        rng = np.random.default_rng(seed)
        if self.mean is None:
            self.fit_scaler(x_train)
        xt = self._scale(x_train)
        xv = self._scale(x_val) if x_val is not None and len(x_val) else None

        params = self.weights + self.biases
        m = [np.zeros_like(p) for p in params]
        v = [np.zeros_like(p) for p in params]
        b1, b2, eps, step = 0.9, 0.999, 1e-8, 0
        history = {"train_loss": [], "val_loss": []}
        best = (np.inf, None)
        bad_epochs = 0
        n_layers = len(self.weights)

        for epoch in range(1, epochs + 1):
            order = rng.permutation(len(xt))
            epoch_loss = 0.0
            for start in range(0, len(xt), batch_size):
                batch = xt[order[start:start + batch_size]]
                noisy = batch + rng.normal(0.0, noise_std, size=batch.shape)
                loss_sum, grads_w, grads_b = self.loss_and_grads(noisy, batch, weight_decay)
                epoch_loss += loss_sum

                step += 1
                for j, g in enumerate(grads_w + grads_b):
                    m[j] = b1 * m[j] + (1 - b1) * g
                    v[j] = b2 * v[j] + (1 - b2) * g * g
                    m_hat = m[j] / (1 - b1 ** step)
                    v_hat = v[j] / (1 - b2 ** step)
                    params[j] -= lr * m_hat / (np.sqrt(v_hat) + eps)

            train_loss = epoch_loss / xt.size
            history["train_loss"].append(train_loss)
            if xv is not None:
                val_loss = float(np.mean((self.reconstruct(xv) - xv) ** 2))
                history["val_loss"].append(val_loss)
                if val_loss < best[0] - 1e-5:
                    best = (val_loss, ([w.copy() for w in self.weights], [b.copy() for b in self.biases]))
                    bad_epochs = 0
                else:
                    bad_epochs += 1
                if verbose and (epoch % 25 == 0 or epoch == 1):
                    print(f"  epoch {epoch:4d} train={train_loss:.4f} val={val_loss:.4f}")
                if bad_epochs >= patience:
                    if verbose:
                        print(f"  early stop at epoch {epoch} (best val={best[0]:.4f})")
                    break
            elif verbose and (epoch % 25 == 0 or epoch == 1):
                print(f"  epoch {epoch:4d} train={train_loss:.4f}")

        if best[1] is not None:
            ws, bs = best[1]
            for i in range(n_layers):
                self.weights[i][...] = ws[i]
                self.biases[i][...] = bs[i]
        return history

    # ------------------------------------------------------------- scoring
    def errors(self, x: np.ndarray) -> np.ndarray:
        """Per-sample reconstruction error (mean squared error in scaled space)."""
        xs = self._scale(np.atleast_2d(x))
        return np.mean((self.reconstruct(xs) - xs) ** 2, axis=1)

    def feature_errors(self, x: np.ndarray) -> np.ndarray:
        xs = self._scale(np.atleast_2d(x))
        return (self.reconstruct(xs) - xs) ** 2

    def calibrate(self, normal_errors: np.ndarray, percentile: float = 99.0) -> float:
        normal_errors = np.asarray(normal_errors, dtype=float)
        self.threshold = float(np.percentile(normal_errors, percentile))
        self.calibration = {
            "percentile": float(percentile),
            "normal_mean": float(normal_errors.mean()),
            "normal_std": float(normal_errors.std()),
            "normal_p50": float(np.percentile(normal_errors, 50)),
            "normal_p95": float(np.percentile(normal_errors, 95)),
            "normal_p99": float(np.percentile(normal_errors, 99)),
        }
        return self.threshold

    def anomaly_ratio(self, x: np.ndarray) -> np.ndarray:
        """Error divided by the calibrated threshold (>1 means abnormal)."""
        return self.errors(x) / max(self.threshold, 1e-9)

    @staticmethod
    def ratio_to_confidence(ratio: float) -> float:
        """Map error ratio to a 0..1 confidence (1.0x -> 0.63, 2x -> 0.86, 3x -> 0.95)."""
        return float(1.0 - np.exp(-max(ratio, 0.0)))

    # --------------------------------------------------------- persistence
    def save(self, path: str) -> None:
        arrays = {f"w{i}": w for i, w in enumerate(self.weights)}
        arrays.update({f"b{i}": b for i, b in enumerate(self.biases)})
        meta = {
            "layer_sizes": list(self.layer_sizes),
            "threshold": self.threshold,
            "calibration": self.calibration,
            "feature_names": self.feature_names,
            "metadata": self.metadata,
        }
        np.savez(path, mean=self.mean, std=self.std, meta=np.array(json.dumps(meta)), **arrays)

    @classmethod
    def load(cls, path: str) -> "NumpyAutoencoder":
        data = np.load(path, allow_pickle=False)
        meta = json.loads(str(data["meta"]))
        n = len(meta["layer_sizes"]) - 1
        return cls(
            layer_sizes=meta["layer_sizes"],
            weights=[data[f"w{i}"] for i in range(n)],
            biases=[data[f"b{i}"] for i in range(n)],
            mean=data["mean"], std=data["std"],
            threshold=float(meta["threshold"]),
            calibration=meta.get("calibration", {}),
            feature_names=meta.get("feature_names", []),
            metadata=meta.get("metadata", {}),
        )
