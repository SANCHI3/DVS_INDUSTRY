"""Temporal CNN + bidirectional GRU fall classifier over feature sequences."""
from __future__ import annotations

from pathlib import Path

import numpy as np
import torch
from torch import nn

from fall_gru.features import NUM_FEATURES


class FallNet(nn.Module):
    """Per-time-step fall logits for a [B, T, F] feature sequence.

    Two 1-D convolutions capture short motion patterns (a ~1 s drop); the
    bidirectional GRU relates them to what happens before and after (standing
    → falling → staying down). A window's score is the max over time steps,
    i.e. "did a fall happen anywhere in this window" (multiple-instance style).
    """

    def __init__(self, features: int = NUM_FEATURES, hidden: int = 64, dropout: float = 0.2):
        super().__init__()
        self.register_buffer("mean", torch.zeros(features))
        self.register_buffer("std", torch.ones(features))
        self.conv = nn.Sequential(
            nn.Conv1d(features, hidden, kernel_size=5, padding=2),
            nn.BatchNorm1d(hidden), nn.ReLU(),
            nn.Conv1d(hidden, hidden, kernel_size=5, padding=2),
            nn.BatchNorm1d(hidden), nn.ReLU(),
            nn.Dropout(dropout),
        )
        self.gru = nn.GRU(hidden, hidden // 2, batch_first=True, bidirectional=True)
        self.head = nn.Linear(hidden, 1)

    def step_logits(self, x: torch.Tensor) -> torch.Tensor:
        x = (x - self.mean) / self.std
        x = self.conv(x.transpose(1, 2)).transpose(1, 2)
        x, _ = self.gru(x)
        return self.head(x).squeeze(-1)  # [B, T]

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.step_logits(x).max(dim=1).values  # [B]


def pad_window(seq: np.ndarray, start: int, length: int) -> np.ndarray:
    """seq[start:start+length], edge-padded at the front if the clip is short."""
    window = seq[max(start, 0):start + length]
    if len(window) < length:
        filler = np.repeat(window[:1] if len(window) else np.zeros((1, seq.shape[1]), seq.dtype),
                           length - len(window), axis=0)
        window = np.concatenate([filler, window], axis=0)
    return window


def sliding_windows(seq: np.ndarray, length: int, stride: int) -> np.ndarray:
    if len(seq) <= length:
        return pad_window(seq, 0, length)[None]
    starts = list(range(0, len(seq) - length + 1, stride))
    if starts[-1] != len(seq) - length:
        starts.append(len(seq) - length)
    return np.stack([seq[s:s + length] for s in starts])


class FallClassifier:
    """Loads a trained checkpoint and scores feature sequences."""

    def __init__(self, checkpoint_path: str | Path, device: str | None = None):
        self.device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
        checkpoint = torch.load(checkpoint_path, map_location=self.device, weights_only=False)
        self.window = int(checkpoint["window"])
        self.fps = float(checkpoint["fps"])
        self.threshold = float(checkpoint["threshold"])
        self.model = FallNet(hidden=int(checkpoint.get("hidden", 64))).to(self.device)
        self.model.load_state_dict(checkpoint["state_dict"])
        self.model.eval()

    def score(self, seq: np.ndarray, stride: int = 5) -> float:
        """Probability that a fall occurs anywhere in `seq` ([T, F])."""
        windows = torch.from_numpy(sliding_windows(seq, self.window, stride)).float().to(self.device)
        with torch.inference_mode():
            return float(torch.sigmoid(self.model(windows)).max().item())
