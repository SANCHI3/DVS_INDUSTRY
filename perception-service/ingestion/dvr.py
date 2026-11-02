"""Hikvision DVR connection settings, RTSP URL building and password masking.

Everything about where the DVR is comes from the environment (perception-service/.env):

    DVR_HOST         192.168.0.139 on the factory LAN; a Tailscale name/relay elsewhere
    DVR_RTSP_PORT    554 (8554 through scripts/dvr_relay.py)
    DVR_HTTP_PORT    80
    DVR_USERNAME     the limited Live View user created for this software (not admin)
    DVR_PASSWORD
    DVR_URL_FORMAT   hik_streaming (default) or hik_h264 for old firmware

Full URLs contain the password, so they are built only at the moment a stream
is opened and must never be logged, printed, stored or sent anywhere: use
mask_url() / mask_text() on anything that could contain one (including
OpenCV/FFmpeg error text).
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass
from urllib.parse import quote, urlsplit, urlunsplit

URL_FORMATS = ("hik_streaming", "hik_h264")
STREAMS = ("main", "sub")

# rtsp://user:pass@host -> rtsp://user:***@host (any scheme, anywhere in a text)
_CREDENTIALS_IN_TEXT = re.compile(r"([a-zA-Z][a-zA-Z0-9+.-]*://)([^/\s:@]+):([^@\s/]*)@")


@dataclass(frozen=True)
class DvrConfig:
    host: str
    rtsp_port: int = 554
    http_port: int = 80
    username: str = ""
    password: str = ""
    url_format: str = "hik_streaming"

    @classmethod
    def from_env(cls, env: "os._Environ[str] | dict[str, str] | None" = None) -> "DvrConfig":
        env = os.environ if env is None else env
        host = (env.get("DVR_HOST") or "").strip()
        if not host:
            raise ValueError("DVR_HOST is not set in perception-service/.env")
        url_format = (env.get("DVR_URL_FORMAT") or "hik_streaming").strip()
        if url_format not in URL_FORMATS:
            raise ValueError(f"DVR_URL_FORMAT must be one of {', '.join(URL_FORMATS)}")
        return cls(
            host=host,
            rtsp_port=_port(env.get("DVR_RTSP_PORT"), 554, "DVR_RTSP_PORT"),
            http_port=_port(env.get("DVR_HTTP_PORT"), 80, "DVR_HTTP_PORT"),
            username=(env.get("DVR_USERNAME") or "").strip(),
            password=env.get("DVR_PASSWORD") or "",
            url_format=url_format,
        )

    def path(self, channel: int, stream: str, url_format: str | None = None) -> str:
        """The RTSP path for a channel, without host or credentials."""
        if not 1 <= int(channel) <= 32:
            raise ValueError(f"channel must be 1-32, got {channel}")
        if stream not in STREAMS:
            raise ValueError(f"stream must be 'main' or 'sub', got {stream}")
        fmt = url_format or self.url_format
        if fmt == "hik_streaming":
            return f"/Streaming/Channels/{int(channel)}{'01' if stream == 'main' else '02'}"
        if fmt == "hik_h264":
            return f"/h264/ch{int(channel)}/{stream}/av_stream"
        raise ValueError(f"unknown url_format {fmt}")

    def rtsp_url(self, channel: int, stream: str, url_format: str | None = None,
                 with_credentials: bool = True) -> str:
        """Full RTSP URL. Contains the password unless with_credentials=False."""
        netloc = f"{self.host}:{self.rtsp_port}"
        if with_credentials and self.username:
            netloc = f"{quote(self.username, safe='')}:{quote(self.password, safe='')}@{netloc}"
        return f"rtsp://{netloc}{self.path(channel, stream, url_format)}"


def _port(value: str | None, default: int, name: str) -> int:
    if value is None or not str(value).strip():
        return default
    try:
        port = int(str(value).strip())
    except ValueError as exc:
        raise ValueError(f"{name} must be a number") from exc
    if not 1 <= port <= 65535:
        raise ValueError(f"{name} must be 1-65535")
    return port


def mask_url(url: str) -> str:
    """Hide the password in a URL: rtsp://user:***@host:554/path."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return mask_text(url)
    if parts.password is None:
        return url
    host = parts.hostname or ""
    if ":" in host:  # IPv6
        host = f"[{host}]"
    netloc = f"{parts.username}:***@{host}"
    if parts.port:
        netloc += f":{parts.port}"
    return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))


def mask_text(text: object, *secrets: str) -> str:
    """Mask URL credentials anywhere in a message, plus any given secret strings."""
    out = _CREDENTIALS_IN_TEXT.sub(lambda m: f"{m.group(1)}{m.group(2)}:***@", str(text))
    for secret in secrets:
        if secret:
            out = out.replace(secret, "***")
            encoded = quote(secret, safe="")
            if encoded != secret:
                out = out.replace(encoded, "***")
    return out
