"""What the setup window does, without the window (so it can be tested).

Layout once installed:  C:\\dvs-cctv\\python, ffmpeg, mediamtx, calibration\\snapshots,
app (this service, with .env, logs and output).

Nothing here prints or stores the DVR password except .env, which only this
Windows user can read.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path
from typing import Callable, Optional
from xml.sax.saxutils import escape

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP))

from ingestion.dvr import mask_text  # noqa: E402
from windows_errors import suppress_error_boxes  # noqa: E402

suppress_error_boxes()  # also covers everything this window starts

INSTALL = APP.parent
ENV_PATH = APP / ".env"
SNAPSHOTS = INSTALL / "calibration" / "snapshots"
STATUS_PATH = APP / "output" / "status.json"
ELEVATED_RESULT = APP / "logs" / "elevated-result.json"
TASK_NAME = "DVS CCTV Monitoring"
RUN_KEY = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run"
RUN_VALUE = "DVS CCTV"

DEFAULTS = {
    "DVR_HOST": "192.168.0.105",
    "DVR_USERNAME": "admin",
    "DASHBOARD_BACKEND_URL": "https://dvs-industry-api.onrender.com",
}
DVR_MAC = "c0:56:e3:1e:10:04"
FIXED = {
    "DVR_MAC": DVR_MAC,
    "DVR_RTSP_PORT": "554",
    "PERCEPTION_INSTANCE_ID": "plant-pc",
    "PERCEPTION_SOURCE": "live",
}
NO_WINDOW = {"creationflags": 0x08000000} if sys.platform == "win32" else {}


def python_exe(windowless: bool = False) -> Path:
    name = "pythonw.exe" if windowless else "python.exe"
    bundled = INSTALL / "python" / name
    return bundled if bundled.is_file() else Path(sys.executable)


def tool_env() -> dict:
    env = dict(os.environ)
    env["PATH"] = f"{INSTALL / 'ffmpeg' / 'bin'}{os.pathsep}{env.get('PATH', '')}"
    env["PYTHONIOENCODING"] = "utf-8"
    return env


# ── settings file ───────────────────────────────────────────────────────────

def read_env(path: Path = ENV_PATH) -> dict[str, str]:
    values: dict[str, str] = {}
    if path.is_file():
        for line in path.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                    value = value[1:-1]
                values[key.strip()] = value
    return values


def validate_form(form: dict[str, str]) -> Optional[str]:
    """A plain-language problem with the form, or None."""
    if not re.fullmatch(r"\d{1,3}(\.\d{1,3}){3}", form.get("DVR_HOST", "").strip()):
        return "The DVR address should look like 192.168.0.105."
    if not form.get("DVR_USERNAME", "").strip():
        return "Please enter the DVR username."
    if not form.get("DVR_PASSWORD"):
        return "Please enter the DVR password."
    if any(c in form["DVR_PASSWORD"] for c in "\r\n"):
        return "The DVR password cannot contain a line break."
    if not form.get("DASHBOARD_BACKEND_URL", "").strip().startswith("https://"):
        return "The website API URL should start with https://"
    if len(form.get("DASHBOARD_SERVICE_KEY", "").strip()) < 32:
        return "The service key is too short. It has at least 32 characters."
    return None


def write_env(form: dict[str, str], path: Path = ENV_PATH) -> None:
    """Save the form, keeping any other settings, then lock the file to this user."""
    values = read_env(path)
    values.update(FIXED)
    values.setdefault("DVR_URL_FORMAT", "hik_streaming")
    values.update({k: v.strip() if k != "DVR_PASSWORD" else v for k, v in form.items()})
    lines = [f'{k}="{v}"' if k == "DVR_PASSWORD" else f"{k}={v}" for k, v in values.items()]
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(lines) + "\n")
    lock_to_this_user(path)


def save_setting(key: str, value: str, path: Path = ENV_PATH) -> None:
    from ingestion.dvr_finder import update_env_value

    update_env_value(path, key, value)


def user_sid() -> str:
    out = subprocess.run(["whoami", "/user", "/fo", "csv", "/nh"], capture_output=True, text=True,
                         timeout=15, **NO_WINDOW).stdout
    return out.strip().split(",")[-1].strip('"')


def lock_to_this_user(path: Path) -> bool:
    """Only this Windows user can read the file. No-op off Windows."""
    if sys.platform != "win32":
        os.chmod(path, 0o600)
        return True
    done = subprocess.run(["icacls", str(path), "/inheritance:r", "/grant:r", f"*{user_sid()}:F"],
                          capture_output=True, timeout=30, **NO_WINDOW)
    return done.returncode == 0


# ── checks ──────────────────────────────────────────────────────────────────

def check_website(base: str, key: str, timeout_s: float = 90.0) -> tuple[bool, str]:
    """The free server can take a minute to wake up, so this waits for it."""
    request = urllib.request.Request(f"{base.rstrip('/')}/api/v1/cameras/ping",
                                     headers={"X-Service-Key": key.strip()})
    try:
        with urllib.request.urlopen(request, timeout=timeout_s):
            return True, "Website: connected, service key accepted."
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            return False, "Website: the service key was not accepted. Check it on Render."
        if exc.code == 404:
            return False, "Website: it is not updated yet. Wait a few minutes and try again."
        return False, f"Website: it answered with error {exc.code}. Try again in a minute."
    except OSError:
        return False, "Website: could not reach it. Check this computer's internet."


def run_lines(cmd: list[str], on_line: Callable[[str], None]) -> int:
    process = subprocess.Popen(cmd, cwd=str(APP), env=tool_env(), stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                               errors="replace", **NO_WINDOW)
    for line in process.stdout:
        on_line(mask_text(line.rstrip(), read_env().get("DVR_PASSWORD", "")))
    return process.wait()


def run_probe(on_event: Callable[[dict], None], channels: str = "1-8") -> None:
    def parse(line: str) -> None:
        if line.startswith(("Probe failed", "Setup problem")):
            on_event({"kind": "error", "message": line})
            return
        try:
            on_event(json.loads(line))
        except ValueError:
            pass  # not one of our result lines

    run_lines([str(python_exe()), "scripts/probe_dvr.py", "--json", "--channels", channels], parse)


def grab_snapshots(on_line: Callable[[str], None], channels: str = "1-8") -> list[Path]:
    SNAPSHOTS.mkdir(parents=True, exist_ok=True)
    run_lines([str(python_exe()), "scripts/grab_snapshots.py", "--channels", channels,
               "--out", str(SNAPSHOTS)], on_line)
    return sorted(SNAPSHOTS.glob("ch*.jpg"), key=lambda p: int(re.sub(r"\D", "", p.stem) or 0))


# ── start at boot ───────────────────────────────────────────────────────────

def task_xml(sid: str, python: Path, app: Path) -> str:
    """Runs at boot as this user, nobody logged in, and no password stored (S4U)."""
    return f"""<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.3" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>DVS Industries: plant CCTV monitoring</Description></RegistrationInfo>
  <Triggers><BootTrigger><Enabled>true</Enabled><Delay>PT1M</Delay></BootTrigger></Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>{escape(sid)}</UserId>
      <LogonType>S4U</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{escape(str(python))}</Command>
      <Arguments>service.py run</Arguments>
      <WorkingDirectory>{escape(str(app))}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"""


def stop_running_copies() -> None:
    """Stop any monitoring started from this folder, but not this window."""
    import psutil

    me = os.getpid()
    folder = str(INSTALL).lower()
    for process in psutil.process_iter(["pid", "exe", "cmdline"]):
        try:
            exe = (process.info["exe"] or "").lower()
            args = " ".join(process.info["cmdline"] or []).lower()
            if process.info["pid"] != me and exe.startswith(folder) and "setup_gui" not in args:
                process.kill()
        except (psutil.Error, OSError):
            continue


def run_elevated(live: bool, wait_s: float = 600.0) -> dict:
    """One "Allow" prompt for everything that needs it. Result, or {'declined': True}."""
    import ctypes

    ELEVATED_RESULT.parent.mkdir(parents=True, exist_ok=True)
    ELEVATED_RESULT.unlink(missing_ok=True)
    args = (f'"{APP / "installer" / "elevated_steps.py"}" --sid {user_sid()} '
            f'--result "{ELEVATED_RESULT}"' + (" --live" if live else ""))
    code = ctypes.windll.shell32.ShellExecuteW(None, "runas", str(python_exe(True)), args, str(APP), 0)
    if code <= 32:  # declined, or this account cannot approve it
        return {"declined": True}
    deadline = time.monotonic() + wait_s
    while time.monotonic() < deadline:
        if ELEVATED_RESULT.is_file():
            time.sleep(0.3)
            try:
                return json.loads(ELEVATED_RESULT.read_text(encoding="utf-8"))
            except ValueError:
                continue
        time.sleep(1)
    return {"declined": True}


def start_at_login_instead() -> None:
    """Without "Allow": start when someone logs in, and right now."""
    command = f'"{python_exe(True)}" "{APP / "service.py"}" run'
    subprocess.run(["reg", "add", RUN_KEY, "/v", RUN_VALUE, "/t", "REG_SZ", "/d", command, "/f"],
                   capture_output=True, timeout=30, **NO_WINDOW)
    start_now()


def read_task_running() -> bool:
    """True if the service process really started from the boot task."""
    import psutil

    folder = str(INSTALL).lower()
    for process in psutil.process_iter(["exe", "cmdline"]):
        try:
            if (process.info["exe"] or "").lower().startswith(folder) and                     "service.py" in " ".join(process.info["cmdline"] or []):
                return True
        except (psutil.Error, OSError):
            continue
    return False


def start_now() -> None:
    subprocess.Popen([str(python_exe(True)), str(APP / "service.py"), "run"], cwd=str(APP),
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     **NO_WINDOW)


def try_power_without_admin() -> bool:
    ok = True
    for setting in ("standby-timeout-ac", "hibernate-timeout-ac"):
        ok = subprocess.run(["powercfg", "/change", setting, "0"], capture_output=True, timeout=30,
                            **NO_WINDOW).returncode == 0 and ok
    return ok


def cameras_online(status: Optional[dict]) -> tuple[int, int]:
    cameras = (status or {}).get("cameras") or {}
    return sum(c.get("status") == "ONLINE" for c in cameras.values()), len(cameras)


def final_message(online: int, total: int) -> str:
    return (f"Done. Cameras online: {online}/{total}.\n"
            "Open dvs-industry.vercel.app → AI Security → Cameras.")


# ── live view ───────────────────────────────────────────────────────────────

LOGIN_URL = re.compile(r"https://login\.tailscale\.com/\S+")


def tailscale_exe() -> Optional[Path]:
    path = Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Tailscale" / "tailscale.exe"
    return path if path.is_file() else None


def tailscale_status(exe: Path) -> dict:
    out = subprocess.run([str(exe), "status", "--json"], capture_output=True, text=True,
                         encoding="utf-8", timeout=30, **NO_WINDOW).stdout
    try:
        return json.loads(out)
    except ValueError:
        return {}


def public_url(status: dict) -> Optional[str]:
    name = ((status.get("Self") or {}).get("DNSName") or "").rstrip(".").lower()
    return f"https://{name}" if name.endswith(".ts.net") else None


def run_opening_login(cmd: list[str], on_line: Callable[[str], None], wait_s: float = 300.0) -> int:
    """Run a Tailscale command; any sign-in or approval link opens in the browser."""
    process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                               encoding="utf-8", errors="replace", **NO_WINDOW)
    opened: set[str] = set()
    started = time.monotonic()
    for line in process.stdout:
        for url in LOGIN_URL.findall(line):
            if url not in opened:
                opened.add(url)
                on_line("Please finish in the browser window that opened.")
                webbrowser.open(url)
        if time.monotonic() - started > wait_s:
            process.kill()
            break
    return process.wait()


def enable_live_view(on_line: Callable[[str], None]) -> Optional[str]:
    """Sign in to Tailscale, publish the video server, save its address."""
    exe = tailscale_exe()
    if exe is None:
        on_line("Live view skipped: Tailscale could not be installed.")
        return None
    if tailscale_status(exe).get("BackendState") != "Running":
        on_line("Signing in to Tailscale…")
        run_opening_login([str(exe), "up", "--unattended"], on_line)
    else:
        subprocess.run([str(exe), "set", "--unattended=true"], capture_output=True, timeout=30, **NO_WINDOW)
    url = public_url(tailscale_status(exe))
    if url is None:
        on_line("Live view skipped: Tailscale sign-in did not finish. Run setup again to retry.")
        return None
    on_line("Publishing the video server…")
    from live_view import HLS_PORT, WEBRTC_PORT

    codes = [run_opening_login([str(exe), "funnel", "--bg", f"--https={public}", f"http://127.0.0.1:{local}"], on_line)
             for public, local in ((443, WEBRTC_PORT), (8443, HLS_PORT))]
    if any(codes):
        on_line("Live view skipped: Tailscale Funnel was not switched on. Run setup again to retry.")
        return None
    save_setting("LIVE_VIEW_ENABLED", "true")
    save_setting("LIVE_VIEW_URL", url)
    on_line("Live view is on.")
    return url


# ── uninstall ───────────────────────────────────────────────────────────────

def uninstall() -> None:
    """Remove everything; the folder goes a few seconds after this window closes."""
    exe = tailscale_exe()
    if exe is not None:
        subprocess.run([str(exe), "funnel", "reset"], capture_output=True, timeout=30, **NO_WINDOW)
    run_elevated_remove()
    stop_running_copies()
    subprocess.run(["reg", "delete", RUN_KEY, "/v", RUN_VALUE, "/f"], capture_output=True, timeout=30, **NO_WINDOW)
    desktop = Path(os.environ.get("USERPROFILE", "")) / "Desktop"
    for name in ("Run camera test again.lnk", "Uninstall DVS CCTV.lnk"):
        (desktop / name).unlink(missing_ok=True)
    subprocess.Popen(f'cmd /c ping -n 6 127.0.0.1 >nul & rmdir /s /q "{INSTALL}"', cwd="C:\\",
                     shell=True, **NO_WINDOW)


def run_elevated_remove() -> None:
    import ctypes

    ctypes.windll.shell32.ShellExecuteW(None, "runas", "schtasks.exe", f'/delete /tn "{TASK_NAME}" /f', None, 0)
