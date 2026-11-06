"""Run the factory CCTV monitoring as a service, and check it.

    python service.py run       all cameras; restarts itself after a crash;
                                logs to logs/perception.log (new file daily, 14 kept)
    python service.py doctor    self-check: settings, DVR and each camera, website,
                                login, upload queue, GPU/CPU; direct or via Tailscale
    python -m service doctor    (the same)

Install as a service: scripts/install_windows_service.ps1 (Windows) or
ops/perception/dvs-perception.service (Linux), see docs/CCTV_SETUP.md.
"""
from __future__ import annotations

import argparse
import io
import ipaddress
import logging
import os
import socket
import subprocess
import sys
import threading
import time
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)  # config/, models/ and output/ are relative to here

from auto_update import Updater, current_version, launch_swap  # noqa: E402
from env_loader import load_env, read_env_file  # noqa: E402
from ingestion.dvr import DvrConfig, mask_text  # noqa: E402
from ingestion.dvr_finder import read_env_value  # noqa: E402
from system_load import read_status, set_low_priority  # noqa: E402
from windows_errors import suppress_error_boxes  # noqa: E402

LOG_DIR = ROOT / "logs"
RESTART_DELAYS = (5, 15, 30, 60, 120, 300)
RESTART_EXIT = 75  # multi_camera.RESTART_EXIT: the DVR moved, start again now
INSTALL_DIR = ROOT.parent  # C:\\dvs-cctv when installed
WATCH_EVERY_S = 30.0
MEMORY_OVER_CHECKS = 5  # 2.5 minutes over the limit, not one busy moment
MEMORY_RESTART_GAP_S = 3600.0


# ── logging: daily files, 14 kept ───────────────────────────────────────────

class _LogStream(io.TextIOBase):
    """stdout/stderr -> rotating log file (and the console), passwords masked."""

    def __init__(self, logger: logging.Logger, level: int, console, secret: str):
        self.logger, self.level, self.console, self.secret = logger, level, console, secret
        self._buf = ""

    def write(self, text: str) -> int:
        self._buf += text
        while "\n" in self._buf:
            line, self._buf = self._buf.split("\n", 1)
            masked = mask_text(line, self.secret)
            if self.console is not None:
                try:
                    self.console.write(masked + "\n")
                except Exception:  # noqa: BLE001 - a closed console must not stop logging
                    pass
            if line.strip():
                self.logger.log(self.level, masked)
        return len(text)

    def flush(self) -> None:
        if self.console is not None:
            try:
                self.console.flush()
            except Exception:  # noqa: BLE001
                pass


def setup_logging(log_dir: Path = LOG_DIR, keep_days: int = 14) -> logging.Logger:
    log_dir.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("perception")
    logger.setLevel(logging.INFO)
    if not logger.handlers:
        handler = TimedRotatingFileHandler(log_dir / "perception.log", when="midnight",
                                           backupCount=keep_days, encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        logger.addHandler(handler)
    secret = os.environ.get("DVR_PASSWORD", "")
    sys.stdout = _LogStream(logger, logging.INFO, sys.__stdout__, secret)
    sys.stderr = _LogStream(logger, logging.WARNING, sys.__stderr__, secret)
    return logger


# ── run with restarts ───────────────────────────────────────────────────────

def launch_monitoring(cmd: list[str], control: Optional["Control"] = None) -> int:
    """Run the monitoring; its output goes through the masked log, line by line."""
    process = subprocess.Popen(cmd, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               text=True, encoding="utf-8", errors="replace", bufsize=1)
    if control is not None:
        control.process = process
    try:
        for line in process.stdout:
            sys.stdout.write(line)
        return process.wait()
    except BaseException:
        process.terminate()
        raise


class Control:
    """Why the watcher stopped the monitoring, so run() knows what to do next."""

    def __init__(self) -> None:
        self.process: Optional[subprocess.Popen] = None
        self.reason: Optional[str] = None

    def stop_monitoring(self, reason: str) -> None:
        self.reason = reason
        if self.process is not None and self.process.poll() is None:
            self.process.terminate()

    def take_reason(self) -> Optional[str]:
        reason, self.reason = self.reason, None
        return reason


def memory_limit_mb() -> float:
    try:
        return float(os.environ.get("MEMORY_LIMIT_MB") or 1536)
    except ValueError:
        return 1536.0


def memory_mb(process) -> float:
    """The monitoring and anything it started."""
    import psutil

    try:
        watched = psutil.Process(process.pid)
        return sum(p.memory_info().rss for p in [watched, *watched.children(recursive=True)]) / 1e6
    except (psutil.Error, OSError):
        return 0.0


class SettingsFile:
    """Notices a changed .env by its time stamp; a file being rewritten is ignored."""

    def __init__(self, path: Path):
        self.path = path
        self.remember()

    def _stamp(self) -> float:
        try:
            return self.path.stat().st_mtime
        except OSError:
            return 0.0

    def remember(self) -> None:
        self.stamp = self._stamp()

    def changed(self) -> bool:
        return self._stamp() != self.stamp and "DVR_HOST" in read_env_file(self.path)


def reload_settings(path: Path, previous: set[str]) -> set[str]:
    """.env wins over what was loaded before; a removed setting goes too. Returns its keys."""
    values = read_env_file(path)
    for key in previous - set(values):
        os.environ.pop(key, None)
    os.environ.update(values)
    return set(values)


class Watcher(threading.Thread):
    """Every 30 s: changed settings, memory use, and whether an update is ready."""

    def __init__(self, control: Control, settings: SettingsFile, updater: Updater,
                 read_memory=memory_mb, clock=time.monotonic):
        super().__init__(name="service-watcher", daemon=True)
        self.control, self.settings, self.updater = control, settings, updater
        self.read_memory, self.clock = read_memory, clock
        self.over_limit = 0
        self.last_memory_restart = -MEMORY_RESTART_GAP_S

    def check(self) -> None:
        if self.settings.changed():
            print("[service] settings changed; restarting the monitoring", flush=True)
            self.settings.remember()
            self.control.stop_monitoring("settings")
            return
        process = self.control.process
        if process is not None and process.poll() is None:
            used = self.read_memory(process)
            self.over_limit = self.over_limit + 1 if used > memory_limit_mb() else 0
            if (self.over_limit >= MEMORY_OVER_CHECKS
                    and self.clock() - self.last_memory_restart >= MEMORY_RESTART_GAP_S):
                print(f"[service] using {used:.0f} MB, over the {memory_limit_mb():.0f} MB limit; "
                      "restarting the monitoring", flush=True)
                self.over_limit = 0
                self.last_memory_restart = self.clock()
                self.control.stop_monitoring("memory")
                return
        if self.updater.tick():
            self.control.stop_monitoring("update")

    def run(self) -> None:
        while True:
            time.sleep(WATCH_EVERY_S)
            try:
                self.check()
            except Exception as exc:  # noqa: BLE001 - the watcher must never stop the monitoring
                print(f"[service] watcher: {type(exc).__name__}", flush=True)


def add_bundled_tools_to_path() -> None:
    ffmpeg = INSTALL_DIR / "ffmpeg" / "bin"
    if ffmpeg.is_dir():
        os.environ["PATH"] = f"{ffmpeg}{os.pathsep}{os.environ.get('PATH', '')}"


def start_live_view(server) -> None:
    """(Re)start the video server when live view is switched on."""
    import live_view
    from ingestion.camera_config import load_camera_setup

    if not live_view.enabled():
        server.stop()
        return
    try:
        setup = load_camera_setup(str(ROOT / "config" / "cameras.yaml"))
        public_host = os.environ["LIVE_VIEW_URL"].split("//")[-1].strip("/")
        server.start(setup, os.environ.get("DASHBOARD_BACKEND_URL", ""), public_host)
    except Exception as exc:  # noqa: BLE001 - detection matters more than live view
        print(f"[live] {mask_text(exc, os.environ.get('DVR_PASSWORD', ''))}")


def run(extra_args: list[str], restart_delays=RESTART_DELAYS, launch=None) -> int:
    """Run `main.py --all --no-display` and start it again whenever it stops.

    The delay grows after quick crashes and resets after an hour of good running.
    """
    load_env()
    setup_logging()
    set_low_priority()
    add_bundled_tools_to_path()
    os.environ.setdefault("OMP_NUM_THREADS", os.environ.get("MODEL_THREADS") or "2")
    cmd = [sys.executable, "-u", str(ROOT / "main.py"), "--all", "--no-display", *extra_args]
    print(f"[service] version {current_version()}")
    live = None
    control = Control()
    settings = updater = None
    env_keys = set(read_env_file(ROOT / ".env"))
    if launch is None:
        from live_view import LiveServer

        launch = lambda: launch_monitoring(cmd, control)  # noqa: E731
        settings, updater = SettingsFile(ROOT / ".env"), Updater()
        Watcher(control, settings, updater).start()
        live = LiveServer(INSTALL_DIR / "mediamtx" / "mediamtx.exe", INSTALL_DIR / "mediamtx" / "mediamtx.yml",
                          LOG_DIR / "live-video.log")
        start_live_view(live)
    failures = 0
    while True:
        started = time.monotonic()
        if settings is not None:
            settings.remember()  # the DVR finder may have just saved a new address
        print("[service] starting the CCTV monitoring")
        try:
            code = launch()
        except KeyboardInterrupt:
            print("[service] stopped")
            if live is not None:
                live.stop()
            return 0
        if code == 0 and extra_args and "--max-seconds" in extra_args:
            if live is not None:
                live.stop()
            return 0  # a timed test run
        reason = control.take_reason()
        if reason == "update":
            if live is not None:
                live.stop()
            print(f"[service] handing over to version {updater.ready}")
            launch_swap(updater.ready)
            return 0
        if reason == "settings":
            env_keys = reload_settings(ROOT / ".env", env_keys)
            if live is not None:
                start_live_view(live)
            continue
        if reason == "memory":
            continue
        if code == RESTART_EXIT:
            # The child saved the new address in .env; the old one is in our environment
            os.environ["DVR_HOST"] = read_env_value(ROOT / ".env", "DVR_HOST") or os.environ.get("DVR_HOST", "")
            print(f"[service] DVR is now at {os.environ['DVR_HOST']}; reconnecting")
            if live is not None:
                start_live_view(live)
            continue
        if time.monotonic() - started > 3600:
            failures = 0
        delay = restart_delays[min(failures, len(restart_delays) - 1)]
        failures += 1
        print(f"[service] monitoring stopped (exit code {code}); starting again in {delay} s")
        try:
            time.sleep(delay)
        except KeyboardInterrupt:
            return 0


# ── doctor ─────────────────────────────────────────────────────────────────

OK, WARN, FAIL = "OK  ", "WARN", "FAIL"


def connection_path(host: str, networks=None) -> str:
    """'direct' (DVR on this computer's LAN), 'tailscale' or 'unknown'."""
    from ingestion.rtsp_probe import local_ipv4_networks

    try:
        target = ipaddress.ip_address(socket.gethostbyname(host))
    except (OSError, ValueError):
        return "unknown"
    networks = local_ipv4_networks() if networks is None else networks
    if target in ipaddress.ip_network("100.64.0.0/10"):
        return "tailscale"  # the factory PC's Tailscale address (relay)
    if any(target in n.network for n in networks if not n.ip in ipaddress.ip_network("100.64.0.0/10")):
        return "direct"
    if any(n.ip in ipaddress.ip_network("100.64.0.0/10") for n in networks):
        return "tailscale"  # a subnet route / 4via6 through the factory PC
    return "unknown"


def doctor(channels: int = 8, out=print) -> int:
    load_env()
    problems = 0

    def line(status: str, what: str, detail: str = "") -> None:
        nonlocal problems
        problems += status == FAIL
        out(f"[{status}] {what}{': ' + detail if detail else ''}")

    env_file = ROOT / ".env"
    line(OK if env_file.is_file() else FAIL, "settings file", str(env_file) if env_file.is_file()
         else "perception-service/.env is missing (copy .env.example)")

    # cameras.yaml
    try:
        from ingestion.camera_config import load_camera_setup

        setup = load_camera_setup(str(ROOT / "config" / "cameras.yaml"))
        dvr_cams = [c for c in setup.enabled if c.is_dvr]
        line(OK, "camera settings", f"{len(dvr_cams)} DVR camera(s) enabled"
             + (", REMOTE_MODE (sub stream, low fps)" if setup.remote_mode else ""))
    except Exception as exc:  # noqa: BLE001
        setup, dvr_cams = None, []
        line(FAIL, "camera settings", mask_text(exc, os.environ.get("DVR_PASSWORD", "")))

    # DVR
    try:
        cfg = DvrConfig.from_env()
    except ValueError as exc:
        cfg = None
        line(FAIL, "DVR settings", str(exc))
    if cfg is not None:
        if not cfg.username or not cfg.password:
            line(FAIL, "DVR login", "DVR_USERNAME / DVR_PASSWORD not set")
        from ingestion.rtsp_probe import diagnose_unreachable, rtsp_describe, tcp_reachable

        path = connection_path(cfg.host)
        reach = tcp_reachable(cfg.host, cfg.rtsp_port, 5.0)
        line(OK if reach else FAIL, "DVR reachable",
             f"{cfg.host}:{cfg.rtsp_port} ({'direct on this network' if path == 'direct' else 'through Tailscale' if path == 'tailscale' else 'route unknown'})"
             if reach else diagnose_unreachable(cfg.host))
        if reach and cfg.username and cfg.password:
            ids = [c.channel for c in dvr_cams] or list(range(1, channels + 1))
            for ch in ids:
                r = rtsp_describe(cfg, cfg.path(ch, "sub"), 10.0)
                line(OK if r.status == "OK" else FAIL, f"camera channel {ch}",
                     f"sub stream {r.codec or ''}".strip() if r.status == "OK" else r.detail or r.status)
                if r.status == "AUTH_FAILED":
                    out("       (stopped: more wrong logins would lock the DVR user)")
                    break

    # website + login
    base = (os.getenv("DASHBOARD_BACKEND_URL") or "").rstrip("/")
    if not base:
        line(WARN, "website", "DASHBOARD_BACKEND_URL not set: incidents stay on this PC")
    else:
        import json
        import urllib.request

        try:
            with urllib.request.urlopen(f"{base}/api/v1/health", timeout=70) as res:
                health = json.loads(res.read().decode() or "{}")
            line(OK if health.get("status") == "ok" else WARN, "website reachable", base)
        except Exception as exc:  # noqa: BLE001
            line(FAIL, "website reachable", f"{base} ({type(exc).__name__}; it may be waking up, try again)")
        try:
            from reporting.dashboard_client import DashboardClient

            client = DashboardClient(timeout=70)
            client._validate_configuration()
            if client.service_key:
                client.request("/api/v1/cameras/ping")
                line(OK, "website login", "service key accepted")
            else:
                if client._access_token is None:
                    client._login()
                line(OK, "website login", "perception service account accepted")
        except Exception as exc:  # noqa: BLE001
            line(FAIL, "website login", f"{exc} (check DASHBOARD_SERVICE_KEY)")

    # instance, queue, device
    from reporting.camera_heartbeat import instance_identity

    instance, source = instance_identity()
    line(OK, "this computer", f"reports as '{instance}' ({'test detections' if source == 'dev' else 'live'})")
    queue_dir = ROOT / "output" / "upload_queue"
    if queue_dir.is_dir():
        items = [p for p in queue_dir.iterdir() if p.is_dir()]
        size = sum(f.stat().st_size for f in queue_dir.rglob("*") if f.is_file())
        line(OK if len(items) < 20 else WARN, "picture upload queue",
             f"{len(items)} waiting, {size / 1e6:.1f} MB")
    else:
        line(OK, "picture upload queue", "empty")
    try:
        import torch

        gpu = torch.cuda.is_available() and torch.cuda.device_count() > 0
        line(OK if gpu else WARN, "inference device",
             f"GPU ({torch.cuda.get_device_name(0)})" if gpu else "CPU only: use a low fps (docs/CCTV_SETUP.md)")
    except Exception:  # noqa: BLE001
        line(WARN, "inference device", "PyTorch not installed")
    # What the running service reported last (every 15 s; fps every minute)
    status = read_status(ROOT / "output" / "status.json")
    if status is None:
        line(WARN, "monitoring", "not running yet")
    else:
        line(OK, "monitoring", f"version {current_version()}, CPU {status.get('cpuPercent', '?')}%, "
             f"{status.get('memoryMb', '?')} MB, detection speed "
             f"{float(status.get('detectionSpeed', 1)):.0%} (at {status.get('updatedAt', '?')})")
        for cam_id, cam in (status.get("cameras") or {}).items():
            fps = cam.get("fps")
            line(OK if cam.get("status") == "ONLINE" else WARN, f"camera {cam_id}",
                 f"{str(cam.get('status')).lower()}, {fps if fps is not None else '-'} fps")
    from pipeline import checkpoint_problem

    for model in ("models/fight_r3d18_v2.pt", "models/fall_gru_v1.pt", "models/fire_smoke_yolov8n_v1.pt"):
        problem = checkpoint_problem(str(ROOT / model)) if (ROOT / model).exists() else f"{model} missing"
        line(OK if problem is None else WARN, f"model {Path(model).name}", problem or "present")

    out("")
    out("All checks passed." if problems == 0 else f"{problems} problem(s) found.")
    return 0 if problems == 0 else 1


def main(argv=None) -> int:
    suppress_error_boxes()  # passes on to the monitoring and MediaMTX
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    run_p = sub.add_parser("run", help="run all cameras with automatic restart and log files")
    run_p.add_argument("extra", nargs=argparse.REMAINDER, help="passed to main.py, e.g. --max-seconds 60")
    sub.add_parser("doctor", help="self-check")
    args = parser.parse_args(argv)
    if args.command == "doctor":
        return doctor()
    return run(args.extra)


if __name__ == "__main__":
    sys.exit(main())
