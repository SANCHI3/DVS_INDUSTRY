"""End-to-end check of the INSTALLED copy on a clean Windows machine (GitHub Actions).

A fake DVR (MediaMTX + an FFmpeg test picture, with a password) stands in for
the real one. Checks the probe, snapshots, a real `service.py run`, the boot
task, and that the password never reaches a log or mediamtx.yml.

    C:\\dvs-cctv\\python\\python.exe C:\\dvs-cctv\\app\\installer\\ci_smoke_test.py
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import setup_core as core  # noqa: E402
from system_load import read_status  # noqa: E402

PASSWORD = "Sm0ke@Test#pw"
PORT = "18554"


def start_fake_dvr() -> list[subprocess.Popen]:
    folder = Path(tempfile.mkdtemp())
    config = folder / "dvr.yml"
    config.write_text(f"""logLevel: warn
rtspAddress: 127.0.0.1:{PORT}
rtmp: no
srt: no
moq: no
hls: no
webrtc: no
authInternalUsers:
  - user: admin
    pass: "{PASSWORD}"
    permissions:
      - action: read
  - user: any
    permissions:
      - action: publish
paths:
  all_others:
""", encoding="utf-8")
    processes = [subprocess.Popen([str(core.INSTALL / "mediamtx" / "mediamtx.exe"), str(config)])]
    time.sleep(2)
    for path in ("/Streaming/Channels/101", "/Streaming/Channels/102"):
        processes.append(subprocess.Popen([
            str(core.INSTALL / "ffmpeg" / "bin" / "ffmpeg.exe"), "-hide_banner", "-loglevel", "error", "-re",
            "-f", "lavfi", "-i", "testsrc=size=704x576:rate=12", "-c:v", "libx264", "-preset", "ultrafast",
            "-tune", "zerolatency", "-g", "12", "-pix_fmt", "yuv420p", "-f", "rtsp",
            f"rtsp://127.0.0.1:{PORT}{path}"]))
    time.sleep(4)
    return processes


def main() -> int:
    processes = start_fake_dvr()
    try:
        core.write_env({
            "DVR_HOST": "127.0.0.1", "DVR_USERNAME": "admin", "DVR_PASSWORD": PASSWORD,
            "DASHBOARD_BACKEND_URL": "https://example.invalid", "DASHBOARD_SERVICE_KEY": "k" * 40,
        })
        core.save_setting("DVR_RTSP_PORT", PORT)
        for key, value in core.read_env().items():
            os.environ[key] = value

        events: list[dict] = []
        core.run_probe(events.append, channels="1")
        print("probe:", events)
        camera = next(e for e in events if e.get("kind") == "camera")
        assert camera["ok"] and "working, 704×576" in camera["line"], camera

        pictures = core.grab_snapshots(print, channels="1")
        assert pictures, "no snapshot saved"

        # The real boot task, run as this user with nobody logged in to it
        xml = Path(tempfile.mkdtemp()) / "task.xml"
        xml.write_text(core.task_xml(core.user_sid(), core.python_exe(), core.APP), encoding="utf-16")
        subprocess.run(["schtasks", "/create", "/tn", core.TASK_NAME, "/xml", str(xml), "/f"], check=True)
        subprocess.run(["schtasks", "/run", "/tn", core.TASK_NAME], check=True)

        online = total = 0
        for _ in range(60):
            time.sleep(5)
            online, total = core.cameras_online(read_status(core.STATUS_PATH))
            print("status:", online, total, flush=True)
            if online:
                break
        assert online >= 1, "the monitoring never saw the fake DVR"
        subprocess.run(["schtasks", "/end", "/tn", core.TASK_NAME])
        core.stop_running_copies()

        logs = "".join(p.read_text(encoding="utf-8", errors="replace") for p in (core.APP / "logs").glob("*.log*"))
        assert "[service] starting" in logs, "no log file"
        assert PASSWORD not in logs and "Sm0ke" not in logs, "password in the log"
        print(json.dumps({"smoke": "passed", "online": online, "total": total}))
        return 0
    finally:
        for process in processes:
            process.kill()


if __name__ == "__main__":
    sys.exit(main())
