"""The installer's two checks. They write to install.log and never read a setting's value.

    check_install.py preflight --log install.log
        Run from the new, unpacked copy while the monitoring is still running: can
        this Python load every library on this Windows? If not, nothing has been
        touched yet and the cameras never stop.

    check_install.py wait --log install.log
        Run after the new copy has started: did the website accept a heartbeat from
        this version? If not, the installer puts the previous version back.

Exit code 0 means yes. DVS_INSTALL_TEST_FAIL=<check> makes a check fail, so CI can
prove the way back works.
"""
from __future__ import annotations

import argparse
import importlib
import os
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from swap_update import NO_WINDOW, wait_for_heartbeat  # noqa: E402

APP = Path(__file__).resolve().parents[1]
WAIT_SECONDS = 480.0  # first start on a busy CPU; success ends the wait at once
LIBRARIES = ("cv2", "torch", "ultralytics", "supervision", "requests", "psutil", "tkinter", "PIL")
PROGRAM_MODULES = ("main", "multi_camera", "service", "live_view")


def say(log: Path, text: str) -> None:
    try:
        log.parent.mkdir(parents=True, exist_ok=True)
        with log.open("a", encoding="utf-8") as handle:
            handle.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {text}\n")
    except OSError:
        pass  # a log problem must not fail the install


def forced_failure(check: str) -> bool:
    return os.environ.get("DVS_INSTALL_TEST_FAIL") == check


def version(app: Path = APP) -> str:
    try:
        return (app / "VERSION").read_text(encoding="utf-8").strip() or "dev"
    except OSError:
        return "dev"


def ffprobe_runs(app: Path) -> bool:
    try:
        return subprocess.run([str(app.parent / "ffmpeg" / "bin" / "ffprobe.exe"), "-version"], capture_output=True,
                              timeout=30, **NO_WINDOW).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def preflight(log: Path, app: Path = APP, load=importlib.import_module) -> int:
    say(log, f"check: can {version(app)} run on this computer?")
    if forced_failure("preflight"):
        say(log, "check failed: forced by a test")
        return 1
    sys.path.insert(0, str(app))
    for name in (*LIBRARIES, *PROGRAM_MODULES):
        try:
            load(name)
        except BaseException as exc:  # noqa: BLE001 - a DLL that cannot load is not always an ImportError
            say(log, f"check failed: {name} cannot load ({type(exc).__name__})")
            return 1
    if not ffprobe_runs(app):
        say(log, "note: ffprobe does not run here; the monitoring falls back to OpenCV")
    say(log, "check passed: every library loads")
    return 0


def wait(log: Path, app: Path = APP, seconds: float = WAIT_SECONDS, waiter=wait_for_heartbeat) -> int:
    expected = version(app)
    say(log, f"waiting up to {seconds:.0f} s for a heartbeat from {expected}")
    if forced_failure("wait"):
        say(log, "no heartbeat: forced by a test")
        return 1
    if waiter(app / "output" / "status.json", expected, time.time(), seconds):
        say(log, f"the website accepted a heartbeat from {expected}")
        return 0
    say(log, f"no heartbeat from {expected} within {seconds:.0f} s")
    return 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("check", choices=("preflight", "wait"))
    parser.add_argument("--log", type=Path, required=True)
    args = parser.parse_args()
    return preflight(args.log) if args.check == "preflight" else wait(args.log)


if __name__ == "__main__":
    sys.exit(main())
