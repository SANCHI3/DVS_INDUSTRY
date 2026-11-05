"""Live video for the website: MediaMTX on the CCTV PC, published by Tailscale Funnel.

MediaMTX pulls a camera from the DVR only while someone watches it. Viewers
reach it through Funnel (no router changes): WebRTC on port 443, HLS on 8443.
Every viewer is checked by the website (POST /api/v1/cameras/stream-auth).

mediamtx.yml holds no secrets. The camera addresses, which contain the DVR
password, are handed to MediaMTX as environment variables when it starts, so
they are never written to disk.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from typing import Optional

from ingestion.camera_config import CameraSetup, truthy
from ingestion.dvr import mask_text

WEBRTC_PORT = 8889
HLS_PORT = 8888
ICE_UDP_PORT = 8189
WEBSITE_ORIGIN = "https://dvs-industry.vercel.app"
NO_WINDOW = {"creationflags": 0x08000000} if sys.platform == "win32" else {}


def enabled(env: Optional[dict] = None) -> bool:
    env = os.environ if env is None else env
    return truthy(env.get("LIVE_VIEW_ENABLED", "")) and bool(env.get("LIVE_VIEW_URL", "").strip())


def stream_sources(setup: CameraSetup) -> dict[str, str]:
    """{dvr-ch1-sd: rtsp://..., dvr-ch1-hd: rtsp://...}: SD is the sub stream, HD the main."""
    out: dict[str, str] = {}
    if setup.dvr is None:
        return out
    for cam in setup.enabled:
        if cam.is_dvr:
            out[f"{cam.id}-sd"] = setup.dvr.rtsp_url(cam.channel, "sub")
            out[f"{cam.id}-hd"] = setup.dvr.rtsp_url(cam.channel, "main")
    return out


def render_config(paths: list[str], auth_url: str, log_file: str, public_host: str = "") -> str:
    """mediamtx.yml. Only local listeners; Funnel is the one way in."""
    lines = [
        "# Written by live_view.py. No passwords here: see its docstring.",
        "logLevel: warn",
        "logDestinations: [file]",
        f"logFile: {log_file}",
        "rtsp: no",
        "rtmp: no",
        "srt: no",
        "moq: no",
        "authMethod: http",
        f"authHTTPAddress: {auth_url}",
        f"hlsAddress: 127.0.0.1:{HLS_PORT}",
        f'hlsAllowOrigins: ["{WEBSITE_ORIGIN}"]',
        "hlsVariant: fmp4",
        "hlsSegmentCount: 7",
        "hlsSegmentDuration: 1s",
        f"webrtcAddress: 127.0.0.1:{WEBRTC_PORT}",
        f'webrtcAllowOrigins: ["{WEBSITE_ORIGIN}"]',
        f"webrtcLocalUDPAddress: :{ICE_UDP_PORT}",
        "webrtcIPsFromInterfaces: no",
        "webrtcICEServers2:",
        "  - url: stun:stun.l.google.com:19302",
    ]
    if public_host:
        lines.append(f"webrtcAdditionalHosts: [{public_host}]")
    lines.append("paths:")
    for name in paths:
        # The real address comes from the environment; this one is never used
        lines += [f"  {name}:", "    source: rtsp://set-by-environment.invalid/", "    rtspTransport: tcp",
                  "    sourceOnDemand: yes", "    sourceOnDemandCloseAfter: 15s"]
    return "\n".join(lines) + "\n"


def child_env(sources: dict[str, str], base: Optional[dict] = None) -> dict[str, str]:
    env = dict(os.environ if base is None else base)
    # MediaMTX needs none of our secrets beyond the camera addresses
    for key in ("DVR_PASSWORD", "DASHBOARD_SERVICE_KEY", "DASHBOARD_SERVICE_PASSWORD", "LLM_API_KEY"):
        env.pop(key, None)
    for name, url in sources.items():
        env[f"MTX_PATHS_{name.upper()}_SOURCE"] = url
    return env


class LiveServer:
    """Starts MediaMTX, and restarts it when the DVR's address changes."""

    def __init__(self, exe: Path, config_path: Path, log_file: Path):
        self.exe, self.config_path, self.log_file = exe, config_path, log_file
        self.process: Optional[subprocess.Popen] = None

    def start(self, setup: CameraSetup, api_base: str, public_host: str = "") -> bool:
        self.stop()
        if not self.exe.is_file():
            print("[live] video server is not installed; live view stays off", flush=True)
            return False
        sources = stream_sources(setup)
        self.config_path.write_text(
            render_config(list(sources), f"{api_base.rstrip('/')}/api/v1/cameras/stream-auth",
                          str(self.log_file), public_host), encoding="utf-8")
        try:
            self.process = subprocess.Popen(
                [str(self.exe), str(self.config_path)], cwd=str(self.exe.parent),
                env=child_env(sources), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **NO_WINDOW)
        except OSError as exc:
            print(f"[live] could not start the video server: {mask_text(exc)}", flush=True)
            return False
        print(f"[live] video server started for {len(sources)} streams", flush=True)
        return True

    def running(self) -> bool:
        return self.process is not None and self.process.poll() is None

    def stop(self) -> None:
        if self.process is not None and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(10)
            except subprocess.TimeoutExpired:
                self.process.kill()
        self.process = None
