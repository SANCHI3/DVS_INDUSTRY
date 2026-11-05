"""Keep the CCTV software polite on the shared accounts server.

Lowest sensible process priority, few threads for the models, and a CPU guard:
if the whole computer stays above 70% for a minute, detection runs at half
speed (again and again if needed) until the load drops. status.json holds the
latest numbers for `service.py doctor` and the setup window; it never contains
stream addresses.
"""
from __future__ import annotations

import json
import os
import sys
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

CPU_LIMIT = 70.0
RECOVER_BELOW = 50.0
WINDOW_S = 60.0
RECOVER_AFTER_S = 300.0
MIN_SPEED = 0.125
SAMPLE_EVERY_S = 5.0
DEFAULT_THREADS = 2


def set_low_priority() -> bool:
    """BELOW_NORMAL on Windows, nice 10 elsewhere. Child processes inherit it."""
    try:
        import psutil

        process = psutil.Process()
        process.nice(psutil.BELOW_NORMAL_PRIORITY_CLASS if sys.platform == "win32" else 10)
        return True
    except Exception:  # noqa: BLE001 - never stop the service over its priority
        return False


def limit_model_threads() -> int:
    """Models may use 2 CPU threads, so they cannot take over a many-core server."""
    try:
        threads = max(1, int(os.environ.get("MODEL_THREADS") or DEFAULT_THREADS))
    except ValueError:
        threads = DEFAULT_THREADS
    try:
        import cv2
        import torch

        torch.set_num_threads(threads)
        cv2.setNumThreads(1)
    except Exception:  # noqa: BLE001
        pass
    return threads


def read_cpu_percent() -> float:
    import psutil

    return float(psutil.cpu_percent(interval=None))


class CpuGuard:
    """speed is 1.0 normally, halved for each minute above the limit."""

    def __init__(self, read_cpu: Callable[[], float] = read_cpu_percent,
                 clock: Callable[[], float] = time.monotonic, limit: float = CPU_LIMIT,
                 recover_below: float = RECOVER_BELOW):
        self.read_cpu, self.clock = read_cpu, clock
        self.limit, self.recover_below = limit, recover_below
        self.speed = 1.0
        self.cpu = 0.0
        self._samples: deque = deque()
        self._next = clock()

    def _mean_over(self, seconds: float, now: float) -> Optional[float]:
        """Mean CPU, once the samples really cover that long."""
        if not self._samples or now - self._samples[0][0] < seconds - SAMPLE_EVERY_S:
            return None
        recent = [cpu for t, cpu in self._samples if now - t <= seconds]
        return sum(recent) / len(recent) if recent else None

    def tick(self) -> float:
        """Call often; samples every 5 s and returns the speed to run at."""
        now = self.clock()
        if now < self._next:
            return self.speed
        self._next = now + SAMPLE_EVERY_S
        self.cpu = self.read_cpu()
        self._samples.append((now, self.cpu))
        while self._samples and now - self._samples[0][0] > RECOVER_AFTER_S:
            self._samples.popleft()

        busy = self._mean_over(WINDOW_S, now)
        if busy is not None and busy > self.limit and self.speed > MIN_SPEED:
            self.speed = max(self.speed / 2, MIN_SPEED)
            self._samples.clear()  # the next step down needs another full minute
            print(f"[cpu] computer busy ({busy:.0f}%): detection speed now {self.speed:.0%}", flush=True)
            return self.speed
        calm = self._mean_over(RECOVER_AFTER_S, now)
        if calm is not None and calm < self.recover_below and self.speed < 1.0:
            self.speed = min(self.speed * 2, 1.0)
            self._samples.clear()
            print(f"[cpu] load is down ({calm:.0f}%): detection speed now {self.speed:.0%}", flush=True)
        return self.speed


def write_status(path: Path, **fields) -> None:
    """Replace status.json in one step, so a reader never sees half a file."""
    data = {"updatedAt": datetime.now(timezone.utc).isoformat(), **fields}
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(data), encoding="utf-8")
    os.replace(temporary, path)


def read_status(path: Path) -> Optional[dict]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
