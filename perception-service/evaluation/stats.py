"""Bootstrap confidence intervals and McNemar's test (shared by the evaluation scripts).

Resampling is over videos: each resample draws as many videos as the test set
has, with replacement, and recomputes the metric from those videos' stored
predictions. The interval is the 2.5th-97.5th percentile of the resampled
values (percentile bootstrap). A fixed seed makes every run reproduce the same
interval.
"""
from __future__ import annotations

import math
from typing import Callable, Optional, Sequence

import numpy as np

N_RESAMPLES = 1000
SEED = 0


def bootstrap_ci(n: int, statistic: Callable[[np.ndarray], Optional[float]],
                 resamples: int = N_RESAMPLES, seed: int = SEED) -> Optional[list]:
    """95% percentile interval of statistic(indices) over `resamples` draws of
    n indices with replacement. Draws where the statistic is undefined (e.g.
    precision with no predicted positives) are skipped; None if none are left."""
    rng = np.random.default_rng(seed)
    values = []
    for _ in range(resamples):
        v = statistic(rng.integers(0, n, n))
        if v is not None and not math.isnan(v):
            values.append(v)
    if not values:
        return None
    lo, hi = np.percentile(values, [2.5, 97.5])
    return [round(float(lo), 4), round(float(hi), 4)]


def confusion(y: np.ndarray, pred: np.ndarray) -> dict:
    return {"tp": int(((y == 1) & (pred == 1)).sum()), "fp": int(((y == 0) & (pred == 1)).sum()),
            "fn": int(((y == 1) & (pred == 0)).sum()), "tn": int(((y == 0) & (pred == 0)).sum())}


def precision(y, pred):
    c = confusion(y, pred)
    return c["tp"] / (c["tp"] + c["fp"]) if c["tp"] + c["fp"] else None


def recall(y, pred):
    c = confusion(y, pred)
    return c["tp"] / (c["tp"] + c["fn"]) if c["tp"] + c["fn"] else None


def f1(y, pred):
    c = confusion(y, pred)
    denom = 2 * c["tp"] + c["fp"] + c["fn"]
    return 2 * c["tp"] / denom if denom else None


def roc_auc(y: np.ndarray, score: np.ndarray) -> Optional[float]:
    """Mann-Whitney AUC (ties count one half); None if only one class is present."""
    pos, neg = score[y == 1], score[y == 0]
    if not len(pos) or not len(neg):
        return None
    ranks = _average_ranks(np.concatenate([pos, neg]))
    return float((ranks[:len(pos)].sum() - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg)))


def _average_ranks(values: np.ndarray) -> np.ndarray:
    order = np.argsort(values, kind="mergesort")
    ranks = np.empty(len(values))
    sorted_vals = values[order]
    i = 0
    while i < len(values):
        j = i
        while j + 1 < len(values) and sorted_vals[j + 1] == sorted_vals[i]:
            j += 1
        ranks[order[i:j + 1]] = (i + j) / 2.0 + 1
        i = j + 1
    return ranks


def classification_cis(y: Sequence[int], pred: Sequence[int], score: Optional[Sequence[float]] = None) -> dict:
    """Point values and bootstrap CIs of precision, recall, F1 (and AUC if scores are given)."""
    y, pred = np.asarray(y), np.asarray(pred)
    metrics = {"precision": precision, "recall": recall, "f1": f1}
    out = {"n": int(len(y)), **confusion(y, pred)}
    for name, fn in metrics.items():
        out[name] = fn(y, pred)
        out[f"{name}_ci95"] = bootstrap_ci(len(y), lambda idx, fn=fn: fn(y[idx], pred[idx]))
    if score is not None:
        s = np.asarray(score, dtype=float)
        out["auc"] = roc_auc(y, s)
        out["auc_ci95"] = bootstrap_ci(len(y), lambda idx: roc_auc(y[idx], s[idx]))
    return out


def mcnemar(correct_a: Sequence[bool], correct_b: Sequence[bool]) -> dict:
    """Exact (binomial) McNemar test on paired per-video correctness."""
    a, b = np.asarray(correct_a, bool), np.asarray(correct_b, bool)
    b01 = int((a & ~b).sum())   # A right, B wrong
    b10 = int((~a & b).sum())   # A wrong, B right
    n = b01 + b10
    k = min(b01, b10)
    p = min(1.0, 2 * sum(math.comb(n, i) for i in range(k + 1)) / 2 ** n) if n else 1.0
    return {"a_only_correct": b01, "b_only_correct": b10, "discordant": n, "p_value_exact": p}
