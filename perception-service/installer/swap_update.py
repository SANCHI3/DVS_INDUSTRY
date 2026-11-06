"""Puts a downloaded update in place, and takes it out again if it does not work.

Runs from C:\\dvs-cctv\\updates, not from the app folder, after the service has
stopped. Each file moves by rename, so a file is never half written, and any
failure puts every file back. .env, config\\cameras.yaml, logs, output and models
are not in the package and are never moved, so they keep their contents and their
permissions.

If the new version has not had a heartbeat accepted within 5 minutes, it is
stopped, the old files return, and that version is never tried again.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Callable

TASK_NAME = "DVS CCTV Monitoring"
WAIT_FOR_HEARTBEAT_S = 300.0
PROTECTED_FILES = {".env", "config/cameras.yaml"}
PROTECTED_FOLDERS = {"logs", "output", "data", "recordings"}
NO_WINDOW = {"creationflags": 0x08000000} if sys.platform == "win32" else {}


def say(text: str) -> None:
    print(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {text}", flush=True)


def files_to_replace(staged: Path) -> list[str]:
    names = []
    for path in sorted(p for p in staged.rglob("*") if p.is_file()):
        name = path.relative_to(staged).as_posix()
        if name in PROTECTED_FILES or name.split("/")[0] in PROTECTED_FOLDERS:
            raise ValueError(f"the package must not contain {name}")
        names.append(name)
    return names


def put_back(done: list[str], app: Path, backup: Path) -> None:
    for name in reversed(done):
        (app / name).unlink(missing_ok=True)
        if (backup / name).is_file():
            os.replace(backup / name, app / name)


def apply(staged: Path, app: Path, backup: Path) -> list[str]:
    """Replace the files, or leave everything as it was and raise."""
    names = files_to_replace(staged)
    shutil.rmtree(backup, ignore_errors=True)
    done: list[str] = []
    try:
        for name in names:
            target = app / name
            done.append(name)
            if target.is_file():
                (backup / name).parent.mkdir(parents=True, exist_ok=True)
                os.replace(target, backup / name)
            target.parent.mkdir(parents=True, exist_ok=True)
            os.replace(staged / name, target)
    except OSError:
        put_back(done, app, backup)
        raise
    return done


def heartbeat_accepted(status_path: Path, version: str, since: float) -> bool:
    try:
        status = json.loads(status_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    ok_at = status.get("websiteOkAt")
    return status.get("version") == version and isinstance(ok_at, (int, float)) and ok_at >= since


def wait_for_heartbeat(status_path: Path, version: str, since: float, wait_s: float,
                       sleep: Callable[[float], None] = time.sleep,
                       clock: Callable[[], float] = time.monotonic) -> bool:
    deadline = clock() + wait_s
    while clock() < deadline:
        if heartbeat_accepted(status_path, version, since):
            return True
        sleep(5)
    return heartbeat_accepted(status_path, version, since)


def stop_service(install: Path) -> None:
    """Stop the monitoring and video server from this folder, but not this helper."""
    import psutil

    me = os.getpid()
    folder = str(install).lower()
    for process in psutil.process_iter(["pid", "exe", "cmdline"]):
        try:
            exe = (process.info["exe"] or "").lower()
            args = " ".join(process.info["cmdline"] or []).lower()
            if process.info["pid"] != me and exe.startswith(folder) and "setup_gui" not in args:
                process.kill()
        except (psutil.Error, OSError):
            continue


def start_service(install: Path) -> None:
    started = subprocess.run(["schtasks", "/run", "/tn", TASK_NAME], capture_output=True, **NO_WINDOW)
    if started.returncode != 0:
        subprocess.Popen([str(install / "python" / "pythonw.exe"), str(install / "app" / "service.py"), "run"],
                         cwd=str(install / "app"), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL, **NO_WINDOW)


def write_result(updates: Path, **fields) -> None:
    (updates / "result.json").write_text(json.dumps({"at": time.time(), **fields}), encoding="utf-8")


def mark_bad(updates: Path, version: str) -> None:
    with (updates / "bad.txt").open("a", encoding="utf-8") as handle:
        handle.write(version + "\n")


def run_update(install: Path, version: str, wait_s: float = WAIT_FOR_HEARTBEAT_S,
               stop: Callable[[Path], None] = stop_service, start: Callable[[Path], None] = start_service,
               wait: Callable[..., bool] = wait_for_heartbeat) -> bool:
    app, updates = install / "app", install / "updates"
    staged, backup = updates / "staged", updates / "previous"
    stop(install)
    try:
        done = apply(staged, app, backup)
    except (OSError, ValueError) as exc:
        say(f"could not put {version} in place: {type(exc).__name__}: {exc}")
        mark_bad(updates, version)
        write_result(updates, version=version, ok=False, reason="files could not be replaced")
        start(install)
        return False
    since = time.time()
    say(f"{version} is in place; waiting for its first heartbeat")
    start(install)
    if wait(app / "output" / "status.json", version, since, wait_s):
        say(f"{version} is running")
        write_result(updates, version=version, ok=True)
        shutil.rmtree(staged, ignore_errors=True)
        return True
    say(f"{version} sent no heartbeat; going back")
    stop(install)
    put_back(done, app, backup)
    mark_bad(updates, version)
    write_result(updates, version=version, ok=False, reason="no heartbeat")
    shutil.rmtree(staged, ignore_errors=True)
    start(install)
    return False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--install", type=Path, required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--wait-seconds", type=float, default=WAIT_FOR_HEARTBEAT_S)
    args = parser.parse_args()
    time.sleep(3)  # let the service finish exiting
    return 0 if run_update(args.install, args.version, args.wait_seconds) else 1


if __name__ == "__main__":
    sys.exit(main())
