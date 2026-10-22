"""Splitting and alert counting used to train the factory anomaly model.

Run:  python test_train_factory.py      (or: pytest test_train_factory.py)
"""
import numpy as np

from anomaly.train_factory import alert_episodes, fold_blocks, fold_split


def test_folds_never_share_windows():
    blocks = fold_blocks(n=130, warmup=10, k=5)
    seen_test = []
    for k in range(5):
        train, val, test = fold_split(blocks, k, gap=6)
        assert not set(train) & set(val) and not set(train) & set(test) and not set(val) & set(test)
        # no training window within `gap` of a held-out block (windows overlap in time)
        for held in (val, test):
            assert all(abs(t - h) > 6 for t in train for h in (held[0], held[-1]))
        seen_test += list(test)
    assert sorted(seen_test) == list(range(10, 130))  # every window tested exactly once


def test_alert_episodes_follow_live_rule():
    assert alert_episodes(np.array([0.5, 1.2, 0.4, 1.3, 0.2])) == 1      # 2 of 3 above 1.0
    assert alert_episodes(np.array([1.5, 0.2, 0.3, 1.4, 0.1])) == 0      # never 2 of 3
    long_quiet = [0.1] * 100
    two = np.array([1.2, 1.2] + long_quiet + [1.2, 1.2])
    assert alert_episodes(two) == 2                                       # after the 30 s cooldown
    assert alert_episodes(np.array([1.2, 1.2, 0.1, 0.1, 1.2, 1.2])) == 1  # inside the cooldown


if __name__ == "__main__":
    test_folds_never_share_windows(); print("PASS test_folds_never_share_windows")
    test_alert_episodes_follow_live_rule(); print("PASS test_alert_episodes_follow_live_rule")
