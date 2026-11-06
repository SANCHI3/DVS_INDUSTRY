"""Plant setup: finding a moved DVR, CPU limits, dahua URLs, live view config.

No real DVR: fake ARP tables, fake pings and fake clocks.
"""
from __future__ import annotations

import ipaddress
import sys
from datetime import datetime, timedelta, timezone

import pytest

import live_view
import service
from ingestion.camera_config import parse_setup
from ingestion.dvr import DvrConfig, mask_text, mask_url
from ingestion.dvr_finder import (
    DvrWatcher, find_by_mac, find_devices, normalise_mac, parse_arp_table, read_env_value,
    read_notice, save_notice, scan_networks, update_env_value,
)
from ingestion.rtsp_probe import StreamResult
from reporting.dashboard_client import DashboardClient, DashboardClientError
from scheduler import FrameScheduler
from scripts.probe_dvr import plain_line
from system_load import CpuGuard, read_status, write_status

MAC = "c0:56:e3:1e:10:04"
LAN = [ipaddress.IPv4Interface("192.168.0.108/24")]
WINDOWS_ARP = """
Interface: 192.168.0.108 --- 0x7
  Internet Address      Physical Address      Type
  192.168.0.1           50-91-e3-aa-bb-cc     dynamic
  192.168.0.112         c0-56-e3-1e-10-04     dynamic
  192.168.0.255         ff-ff-ff-ff-ff-ff     static
"""


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


def test_arp_table_windows_and_linux():
    assert parse_arp_table(WINDOWS_ARP)["192.168.0.112"] == MAC
    assert parse_arp_table("? (192.168.0.9) at C0:56:E3:1E:10:04 [ether] on eth0") == {"192.168.0.9": MAC}
    assert normalise_mac("C0-56-E3-1E-10-04") == MAC


def test_only_own_lan_is_scanned_never_tailscale():
    interfaces = [ipaddress.IPv4Interface("100.114.81.42/32"), *LAN]
    assert scan_networks("192.168.0.105", interfaces) == [ipaddress.ip_network("192.168.0.0/24")]


def test_find_by_mac_pings_the_subnet_then_reads_arp():
    pinged = []
    found = find_by_mac(MAC, "192.168.0.105", LAN, ping=lambda a: pinged.append(a) or False,
                        arp=lambda: parse_arp_table(WINDOWS_ARP))
    assert found == "192.168.0.112"
    assert len(pinged) == 254


def test_find_devices_lists_the_dvr_first_and_other_video_ports():
    devices = find_devices(MAC, 554, "", LAN, ping=lambda a: False, arp=lambda: parse_arp_table(WINDOWS_ARP),
                           port_open=lambda a, p, t: a in ("192.168.0.50", "192.168.0.112"))
    assert [(d.address, d.is_dvr) for d in devices] == [("192.168.0.112", True), ("192.168.0.50", False)]


def make_watcher(tmp_path, up, found="192.168.0.112", clock=None):
    env = tmp_path / ".env"
    env.write_text('DVR_HOST=192.168.0.105\nDVR_PASSWORD="p@ss#1"\n', encoding="utf-8")
    calls = []

    def find(mac, hint):
        calls.append(mac)
        return found

    watcher = DvrWatcher("192.168.0.105", 554, MAC, env, tmp_path / "notice.json",
                         reachable=lambda host, port, timeout: host in up, find=find,
                         arp_lookup=lambda host: {}, clock=clock or Clock())
    return watcher, env, calls


def test_watcher_waits_two_minutes_then_saves_the_new_address(tmp_path):
    clock = Clock()
    watcher, env, calls = make_watcher(tmp_path, {"192.168.0.112"}, clock=clock)
    assert watcher.check() is None
    clock.now = 119
    assert watcher.check() is None and not calls
    clock.now = 121
    assert watcher.check() == "192.168.0.112"
    assert read_env_value(env, "DVR_HOST") == "192.168.0.112"
    assert 'DVR_PASSWORD="p@ss#1"' in env.read_text(encoding="utf-8")  # the rest is untouched
    assert read_notice(tmp_path / "notice.json") == "DVR address changed to 192.168.0.112"


def test_watcher_scans_at_most_once_per_ten_minutes(tmp_path):
    clock = Clock()
    watcher, _, calls = make_watcher(tmp_path, set(), found=None, clock=clock)
    for t in range(0, 1300, 30):
        clock.now = float(t)
        watcher.check()
    assert len(calls) == 2  # at 120 s and 720 s; the third is not due before 1320 s


def test_watcher_ignores_a_short_outage(tmp_path):
    clock = Clock()
    up = set()
    watcher, _, calls = make_watcher(tmp_path, up, clock=clock)
    watcher.check()
    up.add("192.168.0.105")
    clock.now = 60
    watcher.check()
    up.clear()
    clock.now = 130
    watcher.check()
    assert not calls and watcher.down_since == 130


def test_another_device_on_the_old_address_is_not_the_dvr(tmp_path):
    watcher, _, _ = make_watcher(tmp_path, {"192.168.0.105"})
    watcher.arp_lookup = lambda host: {host: "aa:bb:cc:dd:ee:ff"}
    assert watcher.answers("192.168.0.105") is False


def test_address_update_keeps_the_file_in_place(tmp_path):
    env = tmp_path / ".env"
    env.write_text("A=1\nDVR_HOST=old\n", encoding="utf-8")
    update_env_value(env, "DVR_HOST", "new")
    update_env_value(env, "B", "2")
    assert env.read_text(encoding="utf-8") == "A=1\nDVR_HOST=new\nB=2\n"


def test_notice_disappears_after_a_day(tmp_path):
    path = tmp_path / "n.json"
    now = datetime(2026, 11, 5, tzinfo=timezone.utc)
    save_notice(path, "192.168.0.112", now)
    assert read_notice(path, now + timedelta(hours=23))
    assert read_notice(path, now + timedelta(hours=25)) is None


def test_cpu_guard_halves_after_a_minute_and_recovers_slowly():
    clock, cpu = Clock(), [90.0]
    guard = CpuGuard(read_cpu=lambda: cpu[0], clock=clock)

    def run(seconds):
        for _ in range(int(seconds / 5)):
            guard.tick()
            clock.now += 5

    run(50)
    assert guard.speed == 1.0
    run(15)
    assert guard.speed == 0.5
    run(65)
    assert guard.speed == 0.25
    cpu[0] = 30.0
    run(100)
    assert guard.speed == 0.25
    run(210)
    assert guard.speed == 0.5


def test_scheduler_slows_down_with_the_guard():
    clock = Clock()
    scheduler = FrameScheduler({"a": 2.0}, max_total_fps=12, clock=clock)
    scheduler.speed = 0.5
    assert scheduler.next_camera() == "a"
    scheduler.done("a", 10)
    clock.now = 0.5
    assert scheduler.next_camera() is None  # 1 fps now, not 2
    clock.now = 1.0
    assert scheduler.next_camera() == "a"


def test_status_file_round_trip(tmp_path):
    write_status(tmp_path / "status.json", cpuPercent=12)
    assert read_status(tmp_path / "status.json")["cpuPercent"] == 12
    assert read_status(tmp_path / "missing.json") is None


def test_dahua_format_and_escaped_credentials():
    cfg = DvrConfig(host="192.168.1.9", username="ad@min", password="p@ss:w/d", url_format="dahua")
    url = cfg.rtsp_url(3, "sub")
    assert url == "rtsp://ad%40min:p%40ss%3Aw%2Fd@192.168.1.9:554/cam/realmonitor?channel=3&subtype=1"
    assert cfg.path(3, "main").endswith("subtype=0")
    assert "p%40ss" not in mask_url(url)
    assert "p%40ss" not in mask_text(f"Error opening {url}: 401")


def test_plain_words_for_the_setup_window():
    ok = StreamResult(3, "main", status="OK", width=704, height=576, fps=12.0)
    assert plain_line(3, [ok]) == "Camera 03: working, 704×576, 12 fps"
    bad = StreamResult(7, "sub", reason="opens but no picture: no frame")
    assert "no picture" in plain_line(7, [bad])


def setup_for_live():
    raw = {"dvr": {"host": "192.168.0.105"}, "cameras": [{"id": "dvr-ch1", "channel": 1, "name": "Camera 01"}]}
    return parse_setup(raw, {"DVR_USERNAME": "admin", "DVR_PASSWORD": "s3cret!x"})


def test_live_config_holds_no_password_but_the_process_gets_the_address():
    sources = live_view.stream_sources(setup_for_live())
    assert set(sources) == {"dvr-ch1-sd", "dvr-ch1-hd"}
    text = live_view.render_config(list(sources), "https://api.example/api/v1/cameras/stream-auth", "live.log")
    assert "s3cret" not in text and "admin" not in text
    assert "authMethod: http" in text and "sourceOnDemand: yes" in text
    for off in ("rtsp: no", "rtmp: no", "srt: no", "moq: no"):
        assert off in text
    env = live_view.child_env(sources, {"DVR_PASSWORD": "s3cret!x", "DASHBOARD_SERVICE_KEY": "k"})
    assert env["MTX_PATHS_DVR-CH1-SD_SOURCE"].endswith("/Streaming/Channels/102")
    assert "DVR_PASSWORD" not in env and "DASHBOARD_SERVICE_KEY" not in env


def test_live_view_needs_both_settings():
    assert live_view.enabled({"LIVE_VIEW_ENABLED": "true", "LIVE_VIEW_URL": "https://x.ts.net"})
    assert not live_view.enabled({"LIVE_VIEW_ENABLED": "true"})


def test_service_key_is_sent_and_never_needs_a_login(monkeypatch):
    monkeypatch.setenv("DASHBOARD_BACKEND_URL", "https://api.example")
    monkeypatch.setenv("DASHBOARD_SERVICE_KEY", "k" * 40)
    monkeypatch.delenv("DASHBOARD_SERVICE_EMAIL", raising=False)
    monkeypatch.delenv("DASHBOARD_API_TOKEN", raising=False)
    client = DashboardClient()
    sent = {}

    def fake_open(request):
        sent.update(dict(request.header_items()))
        raise DashboardClientError("stop")

    monkeypatch.setattr(client, "_open", fake_open)
    with pytest.raises(DashboardClientError):
        client.request("/api/v1/cameras/ping")
    assert sent["X-service-key"] == "k" * 40 and "Authorization" not in sent


def test_a_moved_dvr_restarts_at_once_with_the_new_address(tmp_path, monkeypatch):
    env = tmp_path / ".env"
    env.write_text("DVR_HOST=192.168.0.112\n", encoding="utf-8")
    monkeypatch.setattr(service, "ROOT", tmp_path)
    monkeypatch.setattr(service, "setup_logging", lambda: None)
    monkeypatch.setattr(service, "load_env", lambda: None)
    monkeypatch.setattr(service, "set_low_priority", lambda: True)
    monkeypatch.setenv("DVR_HOST", "192.168.0.105")
    monkeypatch.setattr(service.time, "sleep", lambda s: pytest.fail("must not wait"))
    codes = iter([service.RESTART_EXIT, 0])
    assert service.run(["--max-seconds", "1"], launch=lambda: next(codes)) == 0
    assert service.os.environ["DVR_HOST"] == "192.168.0.112"


def test_monitoring_output_reaches_the_log_masked(capsys):
    """The real launcher: the child's output, even a stream address, is masked."""
    code = "print('open rtsp://admin:s3cret@192.168.0.105:554/x failed')"
    logged = []

    class Out:
        def write(self, text):
            logged.append(mask_text(text))

    old, sys.stdout = sys.stdout, Out()
    try:
        assert service.launch_monitoring([sys.executable, "-c", code]) == 0
    finally:
        sys.stdout = old
    assert "admin:***@192.168.0.105" in "".join(logged) and "s3cret" not in "".join(logged)


def test_child_process_exit_code_comes_back():
    assert service.launch_monitoring([sys.executable, "-c", "raise SystemExit(75)"]) == 75


def test_the_installed_tracker_library_still_has_what_detection_uses():
    """supervision 0.31 removed ByteTrack; the monitoring then crashed at every start."""
    import supervision

    assert hasattr(supervision, "ByteTrack")


# ── Windows Server 2016 (the plant PC) ──────────────────────────────────────

ENTRY_POINT_NOT_FOUND = 0xC0000139


def _dvr():
    from ingestion.dvr import DvrConfig

    return DvrConfig(host="127.0.0.1", username="admin", password="pw", http_port=1)


def _opens(*_args):
    return type("Answer", (), {"status": "OK", "codec": "H264", "detail": ""})()


def test_ffprobe_that_windows_cannot_start_is_reported_in_plain_words():
    from ingestion.rtsp_probe import ffprobe_failure

    assert "could not start on this Windows" in ffprobe_failure(ENTRY_POINT_NOT_FOUND, "")
    assert ffprobe_failure(1, "401 Unauthorized") == "401 Unauthorized"


def test_opencv_takes_over_when_ffprobe_cannot_run(monkeypatch):
    from ingestion import rtsp_probe

    monkeypatch.setattr(rtsp_probe.shutil, "which", lambda _name: "ffprobe")
    monkeypatch.setattr(rtsp_probe, "measure_with_ffprobe", lambda *_a: {"error": "could not start"})
    monkeypatch.setattr(rtsp_probe, "measure_with_opencv", lambda *_a: {"width": 704, "height": 576, "fps": 12.0})
    assert rtsp_probe.measure_stream("rtsp://x", 1)["width"] == 704


def test_ffprobe_file_that_is_not_a_program_does_not_crash_the_test(monkeypatch):
    from ingestion import rtsp_probe

    def cannot_start(*_a, **_k):
        raise OSError(193, "not a valid application")

    monkeypatch.setattr(rtsp_probe.subprocess, "run", cannot_start)
    assert "could not start" in rtsp_probe.measure_with_ffprobe("rtsp://x", 1)["error"]


def test_every_failed_method_is_named():
    from scripts.probe_dvr import plain_line, probe_stream

    result = probe_stream(
        _dvr(), 3, "sub", 1, True, describe=_opens,
        measure=lambda *_a: {"error": "ffprobe: could not start; OpenCV: no frame within the timeout"},
        snapshot=lambda *_a: {"error": "the DVR web port did not answer"},
    )
    line = plain_line(3, [result])
    assert not result.ok
    for word in ("ffprobe", "OpenCV", "DVR snapshot", "web port"):
        assert word in line


def test_snapshot_only_camera_says_the_ai_cannot_use_it():
    from scripts.probe_dvr import plain_line, probe_stream

    result = probe_stream(
        _dvr(), 3, "main", 1, True, describe=_opens,
        measure=lambda *_a: {"error": "OpenCV: no frame within the timeout"},
        snapshot=lambda *_a: {"jpeg": b"x", "width": 1920, "height": 1080},
    )
    assert result.ok and result.video_problem
    assert "AI monitoring will not work" in plain_line(3, [result])


class _FakeDvrWeb:
    """Digest login like a Hikvision web port."""

    def __init__(self, password="pw"):
        import hashlib
        import http.server
        import io
        import threading

        from PIL import Image

        outer = self
        self.requests = []
        buffer = io.BytesIO()
        Image.new("RGB", (640, 360)).save(buffer, "JPEG")
        picture = buffer.getvalue()

        def md5(text):
            return hashlib.md5(text.encode()).hexdigest()

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_a):
                pass

            def do_GET(self):
                outer.requests.append(self.path)
                header = self.headers.get("Authorization", "")
                if not header:
                    return self.refuse()
                fields = dict(part.strip().split("=", 1) for part in header[7:].split(","))
                fields = {k: v.strip('"') for k, v in fields.items()}
                ha1 = md5(f"admin:dvr:{password}")
                ha2 = md5(f"GET:{self.path}")
                good = md5(f"{ha1}:{fields['nonce']}:{fields['nc']}:{fields['cnonce']}:{fields['qop']}:{ha2}")
                if fields["response"] != good:
                    return self.refuse()
                self.send_response(200)
                self.send_header("Content-Length", str(len(picture)))
                self.end_headers()
                self.wfile.write(picture)

            def refuse(self):
                self.send_response(401)
                self.send_header("WWW-Authenticate", 'Digest realm="dvr", nonce="abc", qop="auth"')
                self.send_header("Content-Length", "0")
                self.end_headers()

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


def test_snapshot_uses_digest_login_and_the_exact_hikvision_path(monkeypatch):
    from ingestion import rtsp_probe
    from ingestion.dvr import DvrConfig

    monkeypatch.setattr(rtsp_probe, "_snapshot_login_refused", [False])
    fake = _FakeDvrWeb()
    try:
        cfg = DvrConfig(host="127.0.0.1", http_port=fake.port, username="admin", password="pw")
        picture = rtsp_probe.fetch_snapshot(cfg, 3, "main", 5)
    finally:
        fake.close()
    assert (picture["width"], picture["height"]) == (640, 360)
    assert fake.requests[-1] == "/ISAPI/Streaming/channels/301/picture"


def test_wrong_login_stops_snapshots_so_the_dvr_does_not_lock(monkeypatch):
    from ingestion import rtsp_probe
    from ingestion.dvr import DvrConfig

    monkeypatch.setattr(rtsp_probe, "_snapshot_login_refused", [False])
    fake = _FakeDvrWeb(password="other")
    try:
        cfg = DvrConfig(host="127.0.0.1", http_port=fake.port, username="admin", password="pw")
        first = rtsp_probe.fetch_snapshot(cfg, 1, "main", 5)
        sent = len(fake.requests)
        second = rtsp_probe.fetch_snapshot(cfg, 2, "main", 5)
    finally:
        fake.close()
    assert "refused" in first["error"] and "refused" in second["error"]
    assert sent <= 2 and len(fake.requests) == sent


def test_snapshot_failure_never_shows_the_password(monkeypatch):
    from ingestion import rtsp_probe
    from ingestion.dvr import DvrConfig

    monkeypatch.setattr(rtsp_probe, "_snapshot_login_refused", [False])
    cfg = DvrConfig(host="127.0.0.1", http_port=1, username="admin", password="S3cret!pw")
    assert "S3cret" not in rtsp_probe.fetch_snapshot(cfg, 1, "main", 1)["error"]


def test_error_boxes_stay_off_in_programs_started_from_here():
    import subprocess
    import sys

    from windows_errors import QUIET, suppress_error_boxes

    if sys.platform != "win32":
        pytest.skip("Windows setting")
    suppress_error_boxes()
    code = "import ctypes; print(ctypes.windll.kernel32.GetErrorMode())"
    child = int(subprocess.run([sys.executable, "-c", code], capture_output=True, text=True).stdout)
    assert child & QUIET == QUIET


def test_compat_check_catches_what_broke_the_plant_pc():
    import importlib.util
    from pathlib import Path

    pytest.importorskip("pefile")
    path = Path(__file__).parent / "installer" / "check_windows_compat.py"
    spec = importlib.util.spec_from_file_location("check_windows_compat", path)
    check = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(check)

    bad = check.problems_in(Path("ffprobe.exe"), {"KERNEL32.dll": {"SetThreadDescription", "Sleep"}}, set())
    assert len(bad) == 1 and "SetThreadDescription" in bad[0]
    assert check.problems_in(Path("a.dll"), {"KERNEL32.dll": {"Sleep"}}, set()) == []
    assert "not in the bundle" in check.problems_in(Path("c10.dll"), {"MSVCP140.dll": set()}, set())[0]
    assert check.problems_in(Path("c10.dll"), {"MSVCP140.dll": set()}, {"msvcp140.dll"}) == []


# ── auto-update ─────────────────────────────────────────────────────────────

def _load_installer_module(name):
    import importlib.util
    from pathlib import Path

    path = Path(__file__).parent / "installer" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _package(files: dict) -> bytes:
    import io
    import zipfile

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, text in files.items():
            archive.writestr(name, text)
    return buffer.getvalue()


def _sha(data: bytes) -> str:
    import hashlib

    return hashlib.sha256(data).hexdigest()


def _github(tag="cctv-setup-8", runtime="r1", sha="a" * 64, base=None):
    import json

    base = base or "https://github.com/SANCHI3/DVS_INDUSTRY/releases/download/x/"
    answers = {
        "https://api.github.com/repos/SANCHI3/DVS_INDUSTRY/releases/latest": {
            "tag_name": tag,
            "assets": [{"name": "dvs-cctv-app.zip", "browser_download_url": base + "dvs-cctv-app.zip"},
                       {"name": "dvs-cctv-app.json", "browser_download_url": base + "dvs-cctv-app.json"}],
        },
        base + "dvs-cctv-app.json": {"version": tag, "sha256": sha, "runtime": runtime},
    }
    return lambda url: json.dumps(answers[url]).encode()


def test_only_a_newer_release_with_the_same_runtime_is_taken():
    from auto_update import find_update

    assert find_update("cctv-setup-7", "r1", set(), _github()).version == "cctv-setup-8"
    assert find_update("cctv-setup-8", "r1", set(), _github()) is None
    assert find_update("cctv-setup-9", "r1", set(), _github()) is None
    assert find_update("cctv-setup-7", "other", set(), _github()) is None
    assert find_update("cctv-setup-7", "r1", {"cctv-setup-8"}, _github()) is None
    assert find_update("dev", "r1", set(), _github()) is None
    assert find_update("cctv-setup-7", "r1", set(), _github(tag="v1.0")) is None


def test_a_package_from_anywhere_else_is_refused():
    from auto_update import find_update

    assert find_update("cctv-setup-7", "r1", set(), _github(base="https://evil.example/")) is None


def test_a_package_with_the_wrong_hash_is_refused(tmp_path):
    from auto_update import unpack

    data = _package({"VERSION": "cctv-setup-8", "a.py": "x = 1"})
    with pytest.raises(ValueError, match="SHA-256"):
        unpack(data, "0" * 64, tmp_path / "staged")
    assert not (tmp_path / "staged").exists()


def test_a_package_that_escapes_its_folder_is_refused(tmp_path):
    from auto_update import unpack

    data = _package({"../evil.py": "x = 1", "VERSION": "cctv-setup-8"})
    with pytest.raises(ValueError, match="unsafe"):
        unpack(data, _sha(data), tmp_path / "staged")
    assert not (tmp_path / "evil.py").exists()


def test_a_package_with_broken_python_is_refused(tmp_path):
    from auto_update import unpack

    data = _package({"VERSION": "cctv-setup-8", "a.py": "def ("})
    with pytest.raises(ValueError):
        unpack(data, _sha(data), tmp_path / "staged")


def _installed(tmp_path):
    install = tmp_path / "dvs-cctv"
    app = install / "app"
    (app / "config").mkdir(parents=True)
    (app / "logs").mkdir()
    (app / "models").mkdir()
    (install / "updates" / "staged" / "config").mkdir(parents=True)
    (app / ".env").write_text("DVR_HOST=1.2.3.4\n")
    (app / "VERSION").write_text("cctv-setup-7\n")
    (app / "service.py").write_text("old\n")
    (app / "old_only.py").write_text("old\n")
    (app / "logs" / "perception.log").write_text("log\n")
    (app / "models" / "big.pt").write_text("model\n")
    (app / "config" / "cameras.yaml").write_text("plant names\n")
    (app / "config" / "thresholds.yaml").write_text("old\n")
    staged = install / "updates" / "staged"
    (staged / "VERSION").write_text("cctv-setup-8\n")
    (staged / "service.py").write_text("new\n")
    (staged / "new_only.py").write_text("new\n")
    (staged / "config" / "thresholds.yaml").write_text("new\n")
    return install, app


def _kept_as_they_were(app):
    assert (app / ".env").read_text() == "DVR_HOST=1.2.3.4\n"
    assert (app / "config" / "cameras.yaml").read_text() == "plant names\n"
    assert (app / "logs" / "perception.log").read_text() == "log\n"
    assert (app / "models" / "big.pt").read_text() == "model\n"


def test_update_that_reports_in_stays_and_keeps_the_settings(tmp_path):
    swap = _load_installer_module("swap_update")
    install, app = _installed(tmp_path)
    started = []
    assert swap.run_update(install, "cctv-setup-8", stop=lambda _i: None, start=started.append,
                           wait=lambda *_a: True)
    assert (app / "VERSION").read_text() == "cctv-setup-8\n"
    assert (app / "service.py").read_text() == "new\n"
    assert (app / "config" / "thresholds.yaml").read_text() == "new\n"
    assert started == [install]
    _kept_as_they_were(app)


def test_update_with_no_heartbeat_goes_back_and_is_never_tried_again(tmp_path):
    swap = _load_installer_module("swap_update")
    install, app = _installed(tmp_path)
    started = []
    assert not swap.run_update(install, "cctv-setup-8", stop=lambda _i: None, start=started.append,
                               wait=lambda *_a: False)
    assert (app / "VERSION").read_text() == "cctv-setup-7\n"
    assert (app / "service.py").read_text() == "old\n"
    assert (app / "config" / "thresholds.yaml").read_text() == "old\n"
    assert not (app / "new_only.py").exists()
    assert (app / "old_only.py").exists()
    assert "cctv-setup-8" in (install / "updates" / "bad.txt").read_text()
    assert len(started) == 2
    _kept_as_they_were(app)


def test_a_failure_half_way_puts_every_file_back(tmp_path, monkeypatch):
    import os

    swap = _load_installer_module("swap_update")
    install, app = _installed(tmp_path)
    real_replace = os.replace

    def fails_on_the_new_file(source, target):
        if str(target).endswith("service.py") and "staged" in str(source):
            raise PermissionError("in use")
        real_replace(source, target)

    monkeypatch.setattr(swap.os, "replace", fails_on_the_new_file)
    started = []
    assert not swap.run_update(install, "cctv-setup-8", stop=lambda _i: None, start=started.append)
    monkeypatch.undo()
    assert (app / "service.py").read_text() == "old\n"
    assert (app / "VERSION").read_text() == "cctv-setup-7\n"
    assert started == [install]
    _kept_as_they_were(app)


@pytest.mark.parametrize("name", [".env", "config/cameras.yaml", "logs/x.log", "output/status.json"])
def test_a_package_can_never_replace_plant_data(tmp_path, name):
    swap = _load_installer_module("swap_update")
    staged = tmp_path / "staged"
    (staged / name).parent.mkdir(parents=True)
    (staged / name).write_text("x")
    with pytest.raises(ValueError):
        swap.files_to_replace(staged)


def test_only_a_heartbeat_from_the_new_version_counts(tmp_path):
    import json

    swap = _load_installer_module("swap_update")
    status = tmp_path / "status.json"
    status.write_text(json.dumps({"version": "cctv-setup-7", "websiteOkAt": 200.0}))
    assert not swap.heartbeat_accepted(status, "cctv-setup-8", 100.0)
    status.write_text(json.dumps({"version": "cctv-setup-8", "websiteOkAt": 50.0}))
    assert not swap.heartbeat_accepted(status, "cctv-setup-8", 100.0)
    status.write_text(json.dumps({"version": "cctv-setup-8", "websiteOkAt": 200.0}))
    assert swap.heartbeat_accepted(status, "cctv-setup-8", 100.0)


def test_a_pc_that_cannot_reach_the_website_does_not_update(tmp_path):
    from auto_update import Updater

    asked = []
    updater = Updater(root=tmp_path, updates=tmp_path / "updates", clock=lambda: 1e6, wall_clock=lambda: 1000.0,
                      fetch=lambda url: asked.append(url), read_status=lambda: {"websiteOkAt": 100.0})
    updater.next_check = 0
    assert updater.tick() is False
    assert asked == []


def test_update_checks_are_six_hours_apart(tmp_path):
    from auto_update import Updater

    now = [0.0]
    checks = []
    updater = Updater(root=tmp_path, updates=tmp_path / "updates", clock=lambda: now[0],
                      read_status=lambda: checks.append(1))
    for seconds in range(0, 7 * 3600, 30):
        now[0] = float(seconds)
        updater.tick()
    assert len(checks) == 2  # after 10 minutes, then 6 hours later


def test_the_update_package_leaves_out_settings_and_models(tmp_path):
    import json
    import zipfile

    make = _load_installer_module("make_update_package")
    app = tmp_path / "app"
    (app / "installer").mkdir(parents=True)
    (app / "config").mkdir()
    (app / "models").mkdir()
    (app / "requirements.txt").write_text("a==1\n")
    (app / "installer" / "constraints.txt").write_text("b==1\n")
    (app / "config" / "cameras.yaml").write_text("x")
    (app / ".env").write_text("x")
    (app / "models" / "big.pt").write_bytes(b"1")
    (app / "service.py").write_text("x = 1\n")
    script = tmp_path / "build.ps1"
    script.write_text('$FfmpegVersion = "5.1.2"\n')

    manifest = make.build(app, tmp_path / "out", "cctv-setup-8", script)
    names = zipfile.ZipFile(tmp_path / "out" / "dvs-cctv-app.zip").namelist()
    assert "service.py" in names and "VERSION" in names and "RUNTIME" in names
    assert ".env" not in names and "config/cameras.yaml" not in names and "models/big.pt" not in names
    assert json.loads((tmp_path / "out" / "dvs-cctv-app.json").read_text()) == manifest

    first = manifest["runtime"]
    (app / "models" / "big.pt").write_bytes(b"2")
    assert make.runtime_hash(app, script) != first
    (app / "models" / "big.pt").write_bytes(b"1")
    assert make.runtime_hash(app, script) == first
    script.write_text('$FfmpegVersion = "6.0"\n')
    assert make.runtime_hash(app, script) != first


# ── settings reload, memory, speed ──────────────────────────────────────────

def test_a_changed_settings_file_is_noticed_and_a_half_written_one_is_not(tmp_path):
    import os

    path = tmp_path / ".env"
    path.write_text("DVR_HOST=1.2.3.4\n")
    settings = service.SettingsFile(path)
    assert not settings.changed()
    path.write_text("")
    os.utime(path, (1000, 1000))
    assert not settings.changed()
    path.write_text("DVR_HOST=1.2.3.5\n")
    os.utime(path, (2000, 2000))
    assert settings.changed()
    settings.remember()
    assert not settings.changed()


def test_reload_applies_new_values_and_drops_removed_ones(tmp_path, monkeypatch):
    import os

    monkeypatch.setenv("LIVE_VIEW_URL", "old")
    monkeypatch.setenv("REMOVED_SETTING", "x")
    path = tmp_path / ".env"
    path.write_text('LIVE_VIEW_URL=https://server.example.ts.net\nDVR_PASSWORD="p#w"\n')
    monkeypatch.setenv("DVR_PASSWORD", "before")
    keys = service.reload_settings(path, {"REMOVED_SETTING", "LIVE_VIEW_URL"})
    assert os.environ["LIVE_VIEW_URL"] == "https://server.example.ts.net"
    assert os.environ["DVR_PASSWORD"] == "p#w"
    assert "REMOVED_SETTING" not in os.environ
    assert keys == {"LIVE_VIEW_URL", "DVR_PASSWORD"}


class _Running:
    def __init__(self):
        self.stopped = 0

    def poll(self):
        return None

    def terminate(self):
        self.stopped += 1


class _NoUpdate:
    def tick(self):
        return False


class _SameSettings:
    def changed(self):
        return False


def _watcher(used_mb, clock):
    control = service.Control()
    control.process = _Running()
    return control, service.Watcher(control, _SameSettings(), _NoUpdate(), read_memory=lambda _p: used_mb, clock=clock)


def test_memory_over_the_limit_restarts_only_after_it_stays_high(monkeypatch):
    monkeypatch.delenv("MEMORY_LIMIT_MB", raising=False)
    control, watcher = _watcher(1600.0, lambda: 10_000.0)
    for _ in range(service.MEMORY_OVER_CHECKS - 1):
        watcher.check()
    assert control.process.stopped == 0
    watcher.check()
    assert control.process.stopped == 1
    assert control.take_reason() == "memory"


def test_memory_restarts_are_at_most_hourly(monkeypatch):
    monkeypatch.delenv("MEMORY_LIMIT_MB", raising=False)
    now = [10_000.0]
    control, watcher = _watcher(1600.0, lambda: now[0])
    for _ in range(service.MEMORY_OVER_CHECKS * 3):
        now[0] += 30
        watcher.check()
    assert control.process.stopped == 1


def test_a_short_memory_peak_is_ignored(monkeypatch):
    monkeypatch.delenv("MEMORY_LIMIT_MB", raising=False)
    readings = iter([1600.0, 1600.0, 900.0, 1600.0, 1600.0, 1600.0, 900.0])
    control = service.Control()
    control.process = _Running()
    watcher = service.Watcher(control, _SameSettings(), _NoUpdate(), read_memory=lambda _p: next(readings),
                              clock=lambda: 10_000.0)
    for _ in range(7):
        watcher.check()
    assert control.process.stopped == 0


def test_no_camera_goes_above_one_frame_a_second_even_with_old_settings(monkeypatch):
    import multi_camera
    from ingestion.camera_config import CameraSpec

    monkeypatch.delenv("MAX_FPS_PER_CAMERA", raising=False)
    fields = {f.name for f in __import__("dataclasses").fields(CameraSpec)}
    base = {"id": "dvr-ch1", "name": "Camera 01", "fps": 2.0}
    fast = CameraSpec(**{k: v for k, v in base.items() if k in fields})
    slow = __import__("dataclasses").replace(fast, fps=0.5)
    assert [c.fps for c in multi_camera.limit_camera_fps([fast, slow])] == [1.0, 0.5]


def test_live_view_stops_when_it_is_switched_off(monkeypatch):
    monkeypatch.delenv("LIVE_VIEW_ENABLED", raising=False)

    class Server:
        stopped = False

        def stop(self):
            Server.stopped = True

    service.start_live_view(Server())
    assert Server.stopped


def test_evidence_uses_the_dvr_snapshot_when_the_video_gives_nothing(tmp_path):
    import numpy as np

    from ingestion.evidence_grabber import MainStreamGrabber

    saved = {}
    grabber = MainStreamGrabber(str(tmp_path), on_saved=lambda _i, paths: saved.update(paths=paths),
                                grab=lambda *_a: [], fallback=lambda _c: np.zeros((8, 8, 3), np.uint8))
    grabber.request("inc-1", "dvr-ch1", "rtsp://x")
    grabber.close()
    assert len(saved["paths"]) == 1
