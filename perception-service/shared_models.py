"""One copy of each heavy model per process, shared by every camera.

Eight cameras each building their own YOLO, R3D-18, pose and GRU models
would load the same weights eight times. The model wrappers hold no
per-camera state (each camera's detector keeps its own history), and the
pipeline runs inference on one thread, so sharing them is safe.
"""
from __future__ import annotations

import threading
from typing import Any, Callable, Hashable

_models: dict[Hashable, Any] = {}
_lock = threading.Lock()


def shared_model(key: Hashable, factory: Callable[[], Any]) -> Any:
    with _lock:
        if key not in _models:
            _models[key] = factory()
        return _models[key]


def clear() -> None:
    with _lock:
        _models.clear()
