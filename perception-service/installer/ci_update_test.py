"""Checks a real update and rollback on the INSTALLED copy (GitHub Actions).

The test website cannot accept a heartbeat, so the "new" version must be rolled
back, which proves the files, .env and the version all return.

    C:\\dvs-cctv\\python\\python.exe C:\\dvs-cctv\\app\\installer\\ci_update_test.py package.zip
"""
from __future__ import annotations

import hashlib
import json
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import setup_core as core  # noqa: E402
import swap_update  # noqa: E402
from auto_update import current_version, unpack  # noqa: E402


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    updates = core.INSTALL / "updates"
    updates.mkdir(exist_ok=True)
    before = current_version(core.APP)
    settings = digest(core.ENV_PATH)
    cameras = digest(core.APP / "config" / "cameras.yaml")
    service = digest(core.APP / "service.py")

    data = Path(sys.argv[1]).read_bytes()
    unpack(data, hashlib.sha256(data).hexdigest(), updates / "staged")
    assert zipfile.ZipFile(sys.argv[1]).namelist(), "empty package"
    (updates / "staged" / "VERSION").write_text("cctv-setup-999999\n", encoding="utf-8")
    (updates / "staged" / "service.py").write_text("# new version\n" + (core.APP / "service.py").read_text(
        encoding="utf-8"), encoding="utf-8")

    seen = {}

    def start(install: Path) -> None:
        seen.setdefault("first", current_version(install / "app"))

    assert not swap_update.run_update(core.INSTALL, "cctv-setup-999999", wait_s=0.1, start=start,
                                      wait=lambda *_a: False), "a version with no heartbeat was kept"
    assert seen["first"] == "cctv-setup-999999", "the new version was never put in place"
    assert current_version(core.APP) == before, "the version did not come back"
    assert digest(core.APP / "service.py") == service, "the old program did not come back"
    assert digest(core.ENV_PATH) == settings, ".env changed"
    assert digest(core.APP / "config" / "cameras.yaml") == cameras, "cameras.yaml changed"
    assert "cctv-setup-999999" in (updates / "bad.txt").read_text(encoding="utf-8")
    print(json.dumps({"update": "rolled back as it should", "version": before}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
