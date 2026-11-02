"""Loads config/cameras.yaml: the DVR, its channels, and per-camera settings.

`${VAR}` and `${VAR:-default}` are filled in from the environment
(perception-service/.env). DVR cameras get their RTSP URLs built at runtime
from the `dvr:` section plus DVR_USERNAME / DVR_PASSWORD, so the password is
never in the file; `source` is still accepted for a webcam index or a video
file (demo and tests).

REMOTE_MODE=true (developer laptop over Tailscale) forces the sub stream and a
low frame rate so the factory's upload link is not saturated.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from typing import Any, Optional

import yaml

from ingestion.dvr import STREAMS, DvrConfig

EVENT_TYPES = ("crowd", "fall", "fight", "fire_smoke", "anomaly")
RULE_ALIASES = {"fire": "fire_smoke", "smoke": "fire_smoke", "fire_smoke": "fire_smoke"}
REMOTE_MAX_FPS = 1.0

_ENV_REF = re.compile(r"\$\{([A-Z0-9_]+)(?::-([^}]*))?\}")


def substitute_env(value: Any, env: dict | None = None) -> Any:
    """Replace ${VAR} / ${VAR:-default} in every string of a parsed YAML tree."""
    env = os.environ if env is None else env
    if isinstance(value, str):
        return _ENV_REF.sub(lambda m: env.get(m.group(1)) or (m.group(2) or ""), value)
    if isinstance(value, list):
        return [substitute_env(v, env) for v in value]
    if isinstance(value, dict):
        return {k: substitute_env(v, env) for k, v in value.items()}
    return value


def truthy(value: Any) -> bool:
    return str(value).strip().lower() in ("1", "true", "yes", "on")


def normalise_rules(rules: Optional[list]) -> list[str]:
    if rules is None:
        return list(EVENT_TYPES)
    out: list[str] = []
    for rule in rules:
        name = RULE_ALIASES.get(str(rule).strip().lower(), str(rule).strip().lower())
        if name not in EVENT_TYPES:
            raise ValueError(f"unknown rule '{rule}' (use {', '.join(EVENT_TYPES)}, fire or smoke)")
        if name not in out:
            out.append(name)
    return out


@dataclass
class CameraSpec:
    id: str
    name: str
    zone: str = ""
    channel: Optional[int] = None
    enabled: bool = True
    detect_stream: str = "sub"
    evidence_stream: str = "main"
    rules: list[str] = field(default_factory=lambda: list(EVENT_TYPES))
    fps: float = 3.0
    source: Optional[str] = None  # webcam index / video file; DVR cameras leave this empty
    extra: dict = field(default_factory=dict)  # zones, roi, ignore_zones, thresholds, night_mode

    @property
    def location(self) -> str:
        """What the website shows as the incident location."""
        return f"{self.name} ({self.zone})" if self.zone else self.name

    @property
    def is_dvr(self) -> bool:
        return self.channel is not None and not self.source

    def detect_source(self, dvr: Optional[DvrConfig]) -> str:
        if not self.is_dvr:
            return str(self.source)
        if dvr is None:
            raise ValueError(f"camera {self.id} needs the dvr: section and DVR_HOST")
        return dvr.rtsp_url(self.channel, self.detect_stream)

    def evidence_source(self, dvr: Optional[DvrConfig]) -> Optional[str]:
        if not self.is_dvr or dvr is None:
            return None
        return dvr.rtsp_url(self.channel, self.evidence_stream)

    def metadata(self) -> dict:
        """Camera fields sent with incidents and heartbeats (no URLs)."""
        return {"id": self.id, "name": self.name, "zone": self.zone, "channel": self.channel}

    def to_runtime_dict(self, dvr: Optional[DvrConfig]) -> dict:
        """The dict shape RuleEngine and main.run() have always used."""
        return {**self.extra, "id": self.id, "name": self.name, "zone": self.zone,
                "location": self.location, "channel": self.channel,
                # None when the DVR is not configured (a --source file can still be played)
                "source": self.detect_source(dvr) if (dvr is not None or not self.is_dvr) else None,
                "rules": self.rules,
                "zones": self.extra.get("zones", [])}


@dataclass
class CameraSetup:
    dvr: Optional[DvrConfig]
    cameras: list[CameraSpec]
    remote_mode: bool = False

    def get(self, camera_id: str) -> CameraSpec:
        for cam in self.cameras:
            if cam.id == camera_id:
                return cam
        raise ValueError(f"camera_id '{camera_id}' not found in cameras.yaml")

    @property
    def enabled(self) -> list[CameraSpec]:
        return [c for c in self.cameras if c.enabled]


def parse_setup(raw: dict, env: dict | None = None) -> CameraSetup:
    env = os.environ if env is None else env
    data = substitute_env(raw or {}, env)
    remote = truthy(env.get("REMOTE_MODE", ""))
    defaults = data.get("defaults") or {}

    dvr = None
    dvr_raw = data.get("dvr")
    if dvr_raw and str(dvr_raw.get("host", "")).strip():
        transport = str(dvr_raw.get("transport", "tcp")).lower()
        if transport != "tcp":
            raise ValueError("dvr.transport must be tcp")
        dvr = DvrConfig.from_env({
            **{k: v for k, v in env.items() if k.startswith("DVR_")},
            "DVR_HOST": str(dvr_raw["host"]),
            "DVR_RTSP_PORT": str(dvr_raw.get("rtsp_port") or env.get("DVR_RTSP_PORT") or "554"),
            "DVR_HTTP_PORT": str(dvr_raw.get("http_port") or env.get("DVR_HTTP_PORT") or "80"),
            "DVR_URL_FORMAT": str(dvr_raw.get("url_format") or env.get("DVR_URL_FORMAT") or "hik_streaming"),
        })

    cameras: list[CameraSpec] = []
    seen: set[str] = set()
    known = {"id", "name", "location", "zone", "channel", "enabled", "detect_stream",
             "evidence_stream", "rules", "fps", "source"}
    for item in data.get("cameras") or []:
        merged = {**defaults, **item}
        cam_id = str(merged.get("id") or "").strip()
        if not cam_id or cam_id in seen:
            raise ValueError(f"camera id missing or repeated: '{cam_id}'")
        seen.add(cam_id)
        channel = merged.get("channel")
        detect_stream = "sub" if remote else str(merged.get("detect_stream", "sub"))
        evidence_stream = str(merged.get("evidence_stream", "main"))
        for s in (detect_stream, evidence_stream):
            if s not in STREAMS:
                raise ValueError(f"camera {cam_id}: stream must be main or sub, got {s}")
        fps = float(merged.get("fps", 3.0))
        if fps <= 0:
            raise ValueError(f"camera {cam_id}: fps must be positive")
        if remote:
            fps = min(fps, REMOTE_MAX_FPS)
        source = merged.get("source")
        cameras.append(CameraSpec(
            id=cam_id,
            name=str(merged.get("name") or merged.get("location") or cam_id),
            zone=str(merged.get("zone") or ""),
            channel=int(channel) if channel not in (None, "") else None,
            enabled=truthy(merged.get("enabled", True)) if not isinstance(merged.get("enabled"), bool)
            else merged["enabled"],
            detect_stream=detect_stream,
            evidence_stream=evidence_stream,
            rules=normalise_rules(merged.get("rules")),
            fps=fps,
            source=str(source) if source not in (None, "") else None,
            extra={k: v for k, v in merged.items() if k not in known},
        ))
        if cameras[-1].channel is None and cameras[-1].source is None:
            raise ValueError(f"camera {cam_id} needs a DVR channel or a source")
    return CameraSetup(dvr=dvr, cameras=cameras, remote_mode=remote)


def load_camera_setup(path: str = "config/cameras.yaml", env: dict | None = None) -> CameraSetup:
    with open(path, encoding="utf-8") as handle:
        return parse_setup(yaml.safe_load(handle), env)
