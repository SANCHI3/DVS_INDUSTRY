"""Minimal .env loader so entry points pick up perception-service/.env.

Values already present in the process environment win, so deployment
configuration (systemd, Docker, CI) always overrides the file.
"""

from __future__ import annotations

import os
from pathlib import Path

_ENV_PATH = Path(__file__).resolve().parent / ".env"


def read_env_file(path: Path = _ENV_PATH) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip().removeprefix("export ").strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if key:
            values[key] = value
    return values


def load_env(path: Path = _ENV_PATH) -> None:
    for key, value in read_env_file(path).items():
        os.environ.setdefault(key, value)
