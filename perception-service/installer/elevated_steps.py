"""The steps that need the one Windows "Allow": run by setup_core.run_elevated.

Start at boot, no sleep on AC power and, if asked for, Tailscale and the
firewall rule for live video. Only standard library modules, and the result
goes to a small JSON file, because a window cannot read an elevated process.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import tempfile
import urllib.request
from pathlib import Path

from setup_core import APP, INSTALL, TASK_NAME, python_exe, task_xml, tailscale_exe

TAILSCALE_MSI = "https://pkgs.tailscale.com/stable/tailscale-setup-latest-amd64.msi"
NO_WINDOW = {"creationflags": 0x08000000}


def run(*cmd: str, timeout: float = 120) -> bool:
    return subprocess.run(list(cmd), capture_output=True, timeout=timeout, **NO_WINDOW).returncode == 0


def restart_task() -> bool:
    run("schtasks", "/end", "/tn", TASK_NAME)
    return run("schtasks", "/run", "/tn", TASK_NAME)


def install_task(sid: str) -> bool:
    if run("schtasks", "/query", "/tn", TASK_NAME):
        return True  # keep the one that is working, and the account it runs as
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "task.xml"
        path.write_text(task_xml(sid, python_exe(), APP), encoding="utf-16")
        return run("schtasks", "/create", "/tn", TASK_NAME, "/xml", str(path), "/f")


def install_tailscale() -> bool:
    if tailscale_exe() is not None:
        return True
    with tempfile.TemporaryDirectory() as folder:
        msi = Path(folder) / "tailscale.msi"
        urllib.request.urlretrieve(TAILSCALE_MSI, msi)
        run("msiexec", "/i", str(msi), "/quiet", "/norestart", timeout=300)
    return tailscale_exe() is not None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sid", required=True)
    parser.add_argument("--result", required=True)
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--restart-only", action="store_true")
    args = parser.parse_args()

    result = {"autostart": False, "power": False, "tailscale": None}
    try:
        if args.restart_only:
            result = {"restarted": restart_task()}
            return
        result["autostart"] = install_task(args.sid)
        result["power"] = all([run("powercfg", "/change", "standby-timeout-ac", "0"),
                               run("powercfg", "/change", "hibernate-timeout-ac", "0")])
        if args.live:
            result["tailscale"] = install_tailscale()
            program = INSTALL / "mediamtx" / "mediamtx.exe"
            run("netsh", "advfirewall", "firewall", "delete", "rule", "name=DVS live video")
            run("netsh", "advfirewall", "firewall", "add", "rule", "name=DVS live video", "dir=in",
                "action=allow", "protocol=UDP", f"program={program}")
    except Exception as exc:  # noqa: BLE001 - the window must get an answer
        result["error"] = type(exc).__name__
    finally:
        temporary = Path(args.result).with_suffix(".tmp")
        temporary.write_text(json.dumps(result), encoding="utf-8")
        os.replace(temporary, args.result)


if __name__ == "__main__":
    main()
