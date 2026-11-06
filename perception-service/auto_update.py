"""Keeps the plant PC up to date with nobody at the keyboard.

Every 6 hours the service asks GitHub for the latest cctv-setup-N release. If it
is newer, it downloads the small app package, checks its SHA-256 against the
release's manifest and unpacks it. It then hands over to installer/swap_update.py,
which replaces the files and rolls back if the new version does not report in.

A package only replaces the app's code. A release that needs different Python
libraries, models or programs has a different "runtime", so it is skipped here
and needs the full installer. Nothing is uploaded, and no password is involved.
"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import sys
import time
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

ROOT = Path(__file__).resolve().parent
INSTALL = ROOT.parent
UPDATES = INSTALL / "updates"
LATEST_RELEASE = "https://api.github.com/repos/SANCHI3/DVS_INDUSTRY/releases/latest"
TAG = re.compile(r"^cctv-setup-(\d+)$")
PACKAGE = "dvs-cctv-app.zip"
MANIFEST = "dvs-cctv-app.json"
CHECK_EVERY_S = 6 * 3600.0
FIRST_CHECK_AFTER_S = 600.0
HEALTHY_WITHIN_S = 300.0  # the website must have accepted a heartbeat this recently
MAX_PACKAGE_BYTES = 100 * 1024 * 1024
ALLOWED_DOWNLOAD = "https://github.com/SANCHI3/DVS_INDUSTRY/releases/download/"


def read_text(path: Path, default: str) -> str:
    try:
        return path.read_text(encoding="utf-8").strip() or default
    except OSError:
        return default


def current_version(root: Path = ROOT) -> str:
    """cctv-setup-N when installed, 'dev' when run from the source."""
    return read_text(root / "VERSION", "dev")


def version_number(tag: str) -> Optional[int]:
    match = TAG.match(tag)
    return int(match.group(1)) if match else None


def _get(url: str, timeout: float = 60.0) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "dvs-cctv-updater",
                                                   "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read(MAX_PACKAGE_BYTES + 1)


@dataclass
class Release:
    version: str
    package_url: str
    sha256: str
    runtime: str


def find_update(current: str, runtime: str, bad: set[str], fetch: Callable[[str], bytes] = _get) -> Optional[Release]:
    """The newer release this PC can take, or None."""
    here = version_number(current)
    if here is None:
        return None  # a copy from the source is never replaced
    release = json.loads(fetch(LATEST_RELEASE))
    tag = str(release.get("tag_name", ""))
    number = version_number(tag)
    if number is None or number <= here or tag in bad:
        return None
    assets = {a.get("name"): a.get("browser_download_url", "") for a in release.get("assets") or []}
    package, manifest_url = assets.get(PACKAGE), assets.get(MANIFEST)
    if not package or not manifest_url:
        return None
    if not package.startswith(ALLOWED_DOWNLOAD) or not manifest_url.startswith(ALLOWED_DOWNLOAD):
        return None
    manifest = json.loads(fetch(manifest_url))
    if manifest.get("version") != tag or not re.fullmatch(r"[0-9a-f]{64}", str(manifest.get("sha256"))):
        return None
    if manifest.get("runtime") != runtime:
        print(f"[update] {tag} needs the full installer (its libraries or models changed)", flush=True)
        return None
    return Release(tag, package, manifest["sha256"], manifest["runtime"])


def unpack(data: bytes, expected_sha256: str, target: Path) -> None:
    """Check the download, then unpack it. Raises ValueError if anything is wrong."""
    if len(data) > MAX_PACKAGE_BYTES:
        raise ValueError("the package is too large")
    if hashlib.sha256(data).hexdigest() != expected_sha256:
        raise ValueError("the package does not match its SHA-256")
    shutil.rmtree(target, ignore_errors=True)
    target.mkdir(parents=True)
    package = target.parent / f"{target.name}.zip"
    package.write_bytes(data)
    try:
        with zipfile.ZipFile(package) as archive:
            for name in archive.namelist():
                path = Path(name)
                if path.is_absolute() or ".." in path.parts or ":" in name:
                    raise ValueError("the package has an unsafe file name")
            archive.extractall(target)
    finally:
        package.unlink(missing_ok=True)
    for source in target.rglob("*.py"):
        try:
            compile(source.read_bytes(), str(source), "exec")
        except SyntaxError as exc:
            raise ValueError(f"{source.name} is not valid Python") from exc
    if current_version(target) == "dev":
        raise ValueError("the package has no version")


def launch_swap(version: str, python: str = sys.executable, updates: Path = UPDATES, root: Path = ROOT) -> None:
    """Start the helper from outside the app folder; it outlives this process."""
    helper = updates / "swap_update.py"
    shutil.copy2(root / "installer" / "swap_update.py", helper)
    cmd = [python, "-I", str(helper), "--install", str(root.parent), "--version", version]
    log = (updates / "swap.log").open("a", encoding="utf-8")
    flags = {}
    if sys.platform == "win32":
        detached, new_group, breakaway = 0x8, 0x200, 0x01000000
        flags = {"creationflags": detached | new_group | breakaway}
    options = dict(cwd=str(updates), stdin=subprocess.DEVNULL, stdout=log, stderr=log, close_fds=True)
    try:
        subprocess.Popen(cmd, **options, **flags)
    except OSError:
        if sys.platform != "win32":
            raise
        subprocess.Popen(cmd, **options, creationflags=0x8 | 0x200)  # breakaway not allowed here
    finally:
        log.close()


class Updater:
    """Called by the service every 30 s. True means: stop, the helper takes over."""

    def __init__(self, root: Path = ROOT, updates: Path = UPDATES, clock: Callable[[], float] = time.monotonic,
                 wall_clock: Callable[[], float] = time.time, fetch: Callable[[str], bytes] = _get,
                 read_status: Optional[Callable[[], Optional[dict]]] = None):
        self.root, self.updates, self.clock, self.wall_clock, self.fetch = root, updates, clock, wall_clock, fetch
        self.next_check = clock() + FIRST_CHECK_AFTER_S
        self.read_status = read_status or (lambda: _read_json(root / "output" / "status.json"))
        self.ready: Optional[str] = None

    def bad_versions(self) -> set[str]:
        return set(read_text(self.updates / "bad.txt", "").split())

    def healthy(self) -> bool:
        """Only update a PC that is working: a website outage must not look like a bad version."""
        ok_at = (self.read_status() or {}).get("websiteOkAt")
        return isinstance(ok_at, (int, float)) and self.wall_clock() - ok_at <= HEALTHY_WITHIN_S

    def tick(self) -> bool:
        if self.clock() < self.next_check:
            return False
        self.next_check = self.clock() + CHECK_EVERY_S
        if not self.healthy():
            return False
        try:
            self.updates.mkdir(parents=True, exist_ok=True)
            release = find_update(current_version(self.root), read_text(self.root / "RUNTIME", ""),
                                  self.bad_versions(), self.fetch)
            if release is None:
                return False
            print(f"[update] downloading {release.version}", flush=True)
            unpack(self.fetch(release.package_url), release.sha256, self.updates / "staged")
            self.ready = release.version
            return True
        except (OSError, ValueError, KeyError) as exc:
            print(f"[update] skipped this time: {type(exc).__name__}: {exc}", flush=True)
            return False


def _read_json(path: Path) -> Optional[dict]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
