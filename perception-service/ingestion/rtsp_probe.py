"""Read-only checks of the DVR's RTSP streams, used by scripts/probe_dvr.py.

An RTSP DESCRIBE (with Digest/Basic login, as Hikvision expects) tells us
exactly why a stream fails (wrong login, no such stream, timeout) and which
codec it carries; OpenCV or ffprobe then reads one frame for the resolution
and frame rate. Nothing here changes anything on the DVR.
"""
from __future__ import annotations

import base64
import hashlib
import ipaddress
import json
import os
import re
import shutil
import socket
import subprocess
import time
from dataclasses import dataclass, field

from ingestion.dvr import DvrConfig, mask_text

# FFmpeg over TCP with a socket timeout (microseconds). Set before cv2 opens anything.
OPENCV_TCP_OPTIONS = "rtsp_transport;tcp|timeout;{timeout_us}|stimeout;{timeout_us}"


@dataclass
class DescribeResult:
    status: str  # OK, AUTH_FAILED, NOT_FOUND, TIMEOUT, REFUSED, ERROR
    detail: str = ""
    codec: str = ""


@dataclass
class StreamResult:
    channel: int
    stream: str
    url_format: str = ""
    status: str = "FAIL"
    reason: str = ""
    codec: str = ""
    width: int = 0
    height: int = 0
    fps: float = 0.0
    tried: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.status == "OK"


# ── RTSP DESCRIBE with Digest login ─────────────────────────────────────────

def _parse_auth_header(header: str) -> tuple[str, dict[str, str]]:
    scheme, _, rest = header.strip().partition(" ")
    params = {k.lower(): v for k, v in re.findall(r'(\w+)="?([^",]*)"?', rest)}
    return scheme.lower(), params


def digest_response(username: str, password: str, realm: str, nonce: str, method: str, uri: str) -> str:
    """RFC 2617 Digest (MD5, no qop), as Hikvision DVRs use for RTSP."""
    ha1 = hashlib.md5(f"{username}:{realm}:{password}".encode()).hexdigest()
    ha2 = hashlib.md5(f"{method}:{uri}".encode()).hexdigest()
    return hashlib.md5(f"{ha1}:{nonce}:{ha2}".encode()).hexdigest()


def authorization_header(challenge: str, username: str, password: str, method: str, uri: str) -> str:
    scheme, params = _parse_auth_header(challenge)
    if scheme == "basic":
        token = base64.b64encode(f"{username}:{password}".encode()).decode()
        return f"Basic {token}"
    realm, nonce = params.get("realm", ""), params.get("nonce", "")
    response = digest_response(username, password, realm, nonce, method, uri)
    return (f'Digest username="{username}", realm="{realm}", nonce="{nonce}", '
            f'uri="{uri}", response="{response}"')


def _read_response(sock: socket.socket) -> tuple[int, dict[str, str], str]:
    data = b""
    while b"\r\n\r\n" not in data:
        chunk = sock.recv(4096)
        if not chunk:
            break
        data += chunk
    head, _, body = data.partition(b"\r\n\r\n")
    lines = head.decode("latin-1").split("\r\n")
    match = re.match(r"RTSP/\d\.\d\s+(\d+)", lines[0] if lines else "")
    status = int(match.group(1)) if match else 0
    headers: dict[str, str] = {}
    for line in lines[1:]:
        key, _, value = line.partition(":")
        # Keep the first WWW-Authenticate (Hikvision sends Digest first)
        headers.setdefault(key.strip().lower(), value.strip())
    length = int(headers.get("content-length", "0") or 0)
    while len(body) < length:
        chunk = sock.recv(4096)
        if not chunk:
            break
        body += chunk
    return status, headers, body.decode("latin-1", "replace")


def codec_from_sdp(sdp: str) -> str:
    match = re.search(r"a=rtpmap:\d+\s+([A-Za-z0-9.-]+)/", sdp)
    return match.group(1).upper() if match else ""


def rtsp_describe(cfg: DvrConfig, path: str, timeout_s: float = 10.0,
                  connect=socket.create_connection) -> DescribeResult:
    uri = f"rtsp://{cfg.host}:{cfg.rtsp_port}{path}"  # no credentials in the request line
    try:
        sock = connect((cfg.host, cfg.rtsp_port), timeout=timeout_s)
    except socket.timeout:
        return DescribeResult("TIMEOUT", "no answer from the DVR")
    except ConnectionRefusedError:
        return DescribeResult("REFUSED", f"port {cfg.rtsp_port} refused the connection")
    except OSError as exc:
        return DescribeResult("ERROR", mask_text(exc, cfg.password))
    try:
        sock.settimeout(timeout_s)
        auth = ""
        for cseq in (1, 2):
            request = (f"DESCRIBE {uri} RTSP/1.0\r\nCSeq: {cseq}\r\n"
                       f"Accept: application/sdp\r\nUser-Agent: dvs-probe\r\n{auth}\r\n")
            sock.sendall(request.encode())
            status, headers, body = _read_response(sock)
            if status == 200:
                return DescribeResult("OK", "", codec_from_sdp(body))
            if status == 401 and cseq == 1 and "www-authenticate" in headers:
                header = authorization_header(headers["www-authenticate"], cfg.username,
                                              cfg.password, "DESCRIBE", uri)
                auth = f"Authorization: {header}\r\n"
                continue
            if status == 401:
                return DescribeResult("AUTH_FAILED", "wrong DVR username or password")
            if status == 404:
                return DescribeResult("NOT_FOUND", "no such stream at this address")
            if status == 0:
                return DescribeResult("ERROR", "no RTSP answer")
            return DescribeResult("ERROR", f"DVR answered RTSP {status}")
        return DescribeResult("AUTH_FAILED", "wrong DVR username or password")
    except socket.timeout:
        return DescribeResult("TIMEOUT", "the DVR stopped answering")
    except OSError as exc:
        return DescribeResult("ERROR", mask_text(exc, cfg.password))
    finally:
        sock.close()


# ── Frame check (resolution / fps) ──────────────────────────────────────────

def measure_stream(url: str, timeout_s: float, password: str = "") -> dict:
    """Resolution and fps of a working stream: ffprobe if installed, else OpenCV."""
    if shutil.which("ffprobe"):
        try:
            proc = subprocess.run(
                ["ffprobe", "-v", "error", "-rtsp_transport", "tcp", "-timeout", str(int(timeout_s * 1e6)),
                 "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,avg_frame_rate",
                 "-of", "json", url],
                capture_output=True, text=True, timeout=timeout_s + 5,
            )
            if proc.returncode == 0:
                info = (json.loads(proc.stdout).get("streams") or [{}])[0]
                num, _, den = str(info.get("avg_frame_rate", "0/1")).partition("/")
                fps = float(num) / float(den or 1) if float(den or 1) else 0.0
                return {"codec": str(info.get("codec_name", "")).upper(), "width": int(info.get("width", 0)),
                        "height": int(info.get("height", 0)), "fps": round(fps, 1)}
            return {"error": mask_text(proc.stderr.strip()[-200:], password) or "ffprobe failed"}
        except (subprocess.TimeoutExpired, ValueError, json.JSONDecodeError) as exc:
            return {"error": mask_text(exc, password)}

    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = OPENCV_TCP_OPTIONS.format(timeout_us=int(timeout_s * 1e6))
    os.environ.setdefault("OPENCV_FFMPEG_LOGLEVEL", "-8")  # FFmpeg must not print the URL
    os.environ.setdefault("OPENCV_LOG_LEVEL", "SILENT")
    import cv2

    cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
    try:
        if not cap.isOpened():
            return {"error": "stream did not open for decoding"}
        started, frame = time.monotonic(), None
        while time.monotonic() - started < timeout_s:
            ok, frame = cap.read()
            if ok and frame is not None:
                break
        if frame is None:
            return {"error": "no frame within the timeout"}
        fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
        return {"width": int(frame.shape[1]), "height": int(frame.shape[0]),
                "fps": round(fps if fps < 1000 else 0.0, 1)}
    finally:
        cap.release()


# ── Network diagnosis ───────────────────────────────────────────────────────

def local_ipv4_networks() -> list[ipaddress.IPv4Interface]:
    out: list[ipaddress.IPv4Interface] = []
    try:
        import psutil

        for addrs in psutil.net_if_addrs().values():
            for a in addrs:
                if a.family == socket.AF_INET and a.netmask:
                    out.append(ipaddress.IPv4Interface(f"{a.address}/{a.netmask}"))
    except Exception:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            out.append(ipaddress.IPv4Interface(f"{info[4][0]}/24"))
    return [i for i in out if not i.ip.is_loopback]


def diagnose_unreachable(host: str, networks: list[ipaddress.IPv4Interface] | None = None) -> str:
    """Plain-language next step when the DVR does not answer at all."""
    try:
        target = ipaddress.IPv4Address(socket.gethostbyname(host))
    except (OSError, ValueError):
        return f"'{host}' could not be resolved. Check DVR_HOST (or that Tailscale is connected)."
    networks = local_ipv4_networks() if networks is None else networks
    same = [n for n in networks if target in n.network]
    tailscale = [n for n in networks if n.ip in ipaddress.IPv4Network("100.64.0.0/10")]
    if same and tailscale:
        return (f"This computer's own network ({same[0].network}) uses the same range as the factory LAN, "
                "so traffic for the DVR stays on this local network instead of going through Tailscale. "
                "Use the Tailscale 4via6 address of the DVR, or run scripts/dvr_relay.py on the factory PC "
                "and set DVR_HOST to the factory PC's Tailscale name with DVR_RTSP_PORT=8554 "
                "(see docs/REMOTE_ACCESS.md).")
    if same:
        return (f"This computer is on {same[0].network} but {target} does not answer. Check the DVR is on, "
                "its network cable, and its current address (System Info -> Network on the DVR monitor).")
    if tailscale:
        return (f"{target} is not on this computer's network. Tailscale is running: check the factory PC is "
                "online in Tailscale and its route to the DVR is approved (docs/REMOTE_ACCESS.md).")
    return (f"{target} is not on this computer's network. Run this on the factory PC (same LAN as the DVR), "
            "or connect through Tailscale (docs/REMOTE_ACCESS.md).")


def tcp_reachable(host: str, port: int, timeout_s: float = 5.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout_s):
            return True
    except OSError:
        return False
