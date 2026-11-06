"""Runs the real installer over a running copy set up like the plant PC (GitHub Actions).

The monitoring is left RUNNING while the installer works, as on the plant, and a
small fake website accepts its heartbeats. Each case must leave the cameras
running and the settings untouched:

    the new version cannot load        nothing changes and nothing stops
    the new version sends no heartbeat the previous version returns and restarts
    everything works                   the new version runs, ffmpeg is back

This runs on the runner's own Python: the installer replaces C:\\dvs-cctv\\python.

    python ci_upgrade_test.py dvs-cctv-setup.exe
"""
from __future__ import annotations

import hashlib
import http.server
import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

INSTALL = Path(r"C:\dvs-cctv")
APP = INSTALL / "app"
ENV = APP / ".env"
STATUS = APP / "output" / "status.json"
LOG = INSTALL / "logs" / "install.log"
WEBSITE_PORT = 18080
OLD_VERSION = "cctv-setup-5"
MARKER = INSTALL / "python" / "previous-version.txt"
KEPT = [ENV, APP / "config" / "cameras.yaml", INSTALL / "calibration" / "snapshots" / "keep.txt"]
SECRET_KEY = "k" * 40
PASSWORD = "Sm0ke@Test#pw"


class FakeWebsite(http.server.BaseHTTPRequestHandler):
    def _accept(self) -> None:
        self.rfile.read(int(self.headers.get("Content-Length") or 0))
        body = b"{}"
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    do_GET = do_POST = do_PATCH = _accept

    def log_message(self, *_args) -> None:
        pass


def digests() -> list[str]:
    return [hashlib.sha256(path.read_bytes()).hexdigest() for path in KEPT]


def env_access() -> str:
    return subprocess.run(["powershell", "-NoProfile", "-Command", f"(Get-Acl '{ENV}').Sddl"],
                          capture_output=True, text=True, check=True).stdout.strip()


def installed_processes() -> dict[int, str]:
    script = ("Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like 'C:\\dvs-cctv\\*' } | "
              "ForEach-Object { \"$($_.ProcessId) $($_.ExecutablePath)\" }")
    lines = subprocess.run(["powershell", "-NoProfile", "-Command", script], capture_output=True, text=True,
                           check=True).stdout.splitlines()
    return {int(line.split(" ", 1)[0]): line.split(" ", 1)[1] for line in lines if line.strip()}


def status() -> dict:
    try:
        return json.loads(STATUS.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def wait_for_running(version: str, since: float, seconds: float = 300) -> None:
    deadline = time.time() + seconds
    while time.time() < deadline:
        now = status()
        ok_at = now.get("websiteOkAt")
        if now.get("version") == version and isinstance(ok_at, (int, float)) and ok_at >= since:
            return
        time.sleep(3)
    raise AssertionError(f"{version} is not running: {status().get('version')!r}, log: {tail()}")


def tail() -> str:
    return LOG.read_text(encoding="utf-8", errors="replace")[-1500:] if LOG.is_file() else "no install log"


def install(setup: Path, fail: str = "") -> int:
    env = {**os.environ, "DVS_INSTALL_TEST_FAIL": fail}
    code = subprocess.run([str(setup), "/S"], env=env, check=False, timeout=1500).returncode
    print(f"installer (fail={fail or 'nothing'}) exit {code}\n{tail()}", flush=True)
    return code


def assert_settings_kept(settings: list[str], access: str) -> None:
    assert digests() == settings, "the installer changed the settings"
    assert env_access() == access, "the installer changed who can read .env"


def assert_previous_version() -> None:
    assert (APP / "VERSION").read_text(encoding="utf-8").strip() == OLD_VERSION, "the version did not come back"
    assert MARKER.is_file(), "the previous Python did not come back"
    assert (INSTALL / "ffmpegold").is_dir(), "the plant's ffmpegold folder went missing"
    assert not (INSTALL / "ffmpeg").exists(), "the failed version's ffmpeg was left behind"
    assert_no_leftovers()


def assert_no_leftovers() -> None:
    assert not (INSTALL / "upgrade-new").exists() and not (INSTALL / "upgrade-old").exists(), "folders left behind"


def main() -> int:
    setup = Path(sys.argv[1]).resolve()
    server = http.server.ThreadingHTTPServer(("127.0.0.1", WEBSITE_PORT), FakeWebsite)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    new_version = (APP / "VERSION").read_text(encoding="utf-8").strip()
    # The plant: its own settings, the renamed ffmpeg folder, an older version running
    text = ENV.read_text(encoding="utf-8").replace("https://example.invalid", f"http://127.0.0.1:{WEBSITE_PORT}")
    ENV.write_text(text, encoding="utf-8")
    with KEPT[1].open("a", encoding="utf-8") as handle:
        handle.write("# plant edit\n")
    KEPT[2].parent.mkdir(parents=True, exist_ok=True)
    KEPT[2].write_text("keep", encoding="utf-8")
    (INSTALL / "ffmpeg").rename(INSTALL / "ffmpegold")
    (APP / "VERSION").write_text(OLD_VERSION + "\n", encoding="utf-8")
    MARKER.write_text("old", encoding="utf-8")
    settings, access = digests(), env_access()

    since = time.time()
    subprocess.run(["schtasks", "/run", "/tn", "DVS CCTV Monitoring"], check=True)
    wait_for_running(OLD_VERSION, since)
    running = set(installed_processes())
    assert len(running) >= 2, f"the monitoring should be running: {installed_processes()}"

    assert install(setup, fail="preflight") != 0, "a version that cannot load must report a failure"
    assert_previous_version()
    assert_settings_kept(settings, access)
    assert running <= set(installed_processes()), "the monitoring was stopped although nothing changed"
    assert "nothing was changed" in tail()

    since = time.time()
    assert install(setup, fail="wait") != 0, "a version with no heartbeat must report a failure"
    assert_previous_version()
    assert_settings_kept(settings, access)
    assert "the previous version is back" in tail()
    wait_for_running(OLD_VERSION, since)
    assert not running & set(installed_processes()), "the old processes should have been replaced"

    since = time.time()
    assert install(setup) == 0, "a good upgrade must succeed"
    assert (APP / "VERSION").read_text(encoding="utf-8").strip() == new_version
    assert not MARKER.exists(), "the new Python is not in place"
    assert (INSTALL / "ffmpeg" / "bin" / "ffprobe.exe").is_file(), "ffmpeg did not come back"
    assert not (INSTALL / "ffmpegold").exists(), "ffmpegold was not removed"
    assert_no_leftovers()
    assert_settings_kept(settings, access)
    wait_for_running(new_version, since, 30)
    subprocess.run([str(INSTALL / "ffmpeg" / "bin" / "ffprobe.exe"), "-version"], check=True, capture_output=True)

    log = LOG.read_text(encoding="utf-8", errors="replace")
    assert SECRET_KEY not in log and PASSWORD not in log, "a secret reached install.log"
    print(json.dumps({"upgrade": "passed", "version": new_version}))

    subprocess.run(["schtasks", "/end", "/tn", "DVS CCTV Monitoring"], check=False)
    subprocess.run(["powershell", "-NoProfile", "-Command",
                    "Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like 'C:\\dvs-cctv\\*' } | "
                    "ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"], check=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
