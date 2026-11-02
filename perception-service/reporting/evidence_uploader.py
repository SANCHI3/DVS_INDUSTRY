"""Incident pictures to the website, through a queue on this PC's disk.

When an incident fires, up to 3 keyframes (before / at / after) and any
Grad-CAM overlays are saved as JPEGs (<= 1280 px wide, quality ~75,
<= 250 KB) in output/upload_queue/<time>_<incident>/ together with the
detector details. A background thread sends the oldest item first:

  - sent              -> the folder is deleted
  - website asleep / no network / 5xx / 429 -> retried with backoff (30 s .. 1 h)
  - 404 (the incident is not on the website yet, e.g. still being confirmed)
                      -> retried; dropped after 24 h
  - other refusal (400/401/403/413) -> dropped, with a log line

The queue is capped (default 500 MB, EVIDENCE_QUEUE_MAX_MB); the oldest items
are dropped first, so a long outage never fills the disk.
"""
from __future__ import annotations

import json
import os
import shutil
import threading
import time
import uuid
from pathlib import Path
from typing import Callable, Optional, Union

import cv2
import numpy as np

from reporting.dashboard_client import DashboardClient, DashboardClientError
from reporting.incident_report import is_dashboard_review

MAX_WIDTH = 1280
MAX_BYTES = 250 * 1024
GIVE_UP_404_S = 24 * 3600
KEYFRAME_FIELDS = ("keyframe_before", "keyframe_at", "keyframe_after")
Picture = Union[str, Path, np.ndarray]


def encode_evidence(picture: Picture, max_width: int = MAX_WIDTH, max_bytes: int = MAX_BYTES) -> Optional[bytes]:
    frame = cv2.imread(str(picture)) if not isinstance(picture, np.ndarray) else picture
    if frame is None:
        return None
    h, w = frame.shape[:2]
    if w > max_width:
        frame = cv2.resize(frame, (max_width, max(1, round(h * max_width / w))), interpolation=cv2.INTER_AREA)
    for quality in (75, 65, 55, 45, 35):
        ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
        if ok and len(buf) <= max_bytes:
            return buf.tobytes()
    return None


def pick_pictures(keyframes: list, main_frames: list, gradcam: list) -> dict[str, Picture]:
    """before = the buffered frame before the event (sub stream); at / after =
    the full-resolution main-stream grabs when there are any, else more keyframes."""
    out: dict[str, Picture] = {}
    if keyframes:
        out["keyframe_before"] = keyframes[0]
    if main_frames:
        out["keyframe_at"] = main_frames[0]
        if len(main_frames) > 1:
            out["keyframe_after"] = main_frames[-1]
    elif len(keyframes) > 1:
        out["keyframe_at"] = keyframes[len(keyframes) // 2]
        if len(keyframes) > 2:
            out["keyframe_after"] = keyframes[-1]
    for i, path in enumerate(gradcam[:3]):
        out[f"gradcam_{i}"] = path
    return out


def evidence_meta(report: dict, detail: Optional[dict] = None) -> dict:
    """Detector details for the website's explanation (no file paths)."""
    detail = dict(detail if detail is not None else report.get("detail") or {})
    detail.pop("gradcam_heatmaps", None)
    # Incidents reach the website once confirmed; a PROBABLE stage captured
    # earlier would read "awaiting confirmation" there. Review fights stay PROBABLE.
    tier = str(report.get("confidence_tier", ""))
    if tier.upper() == "PROBABLE" and not is_dashboard_review(report):
        tier = ""
    meta = {
        "eventType": report.get("event_type", ""),
        "tier": tier,
        "confidenceBasis": detail.get("confidence_basis"),
        "recommendedAction": report.get("recommended_action"),
        "validationVersion": detail.get("validation_version"),
        "detail": detail,
    }
    if len(json.dumps(meta, default=str)) > 15_000:
        meta["detail"] = {}
    return json.loads(json.dumps(meta, default=str))


def multipart(fields: dict[str, str], files: dict[str, bytes]) -> tuple[bytes, str]:
    boundary = f"----dvs{uuid.uuid4().hex}"
    out = bytearray()
    for name, value in fields.items():
        out += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n").encode()
        out += value.encode("utf-8") + b"\r\n"
    for name, data in files.items():
        out += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{name}.jpg\"\r\n"
                "Content-Type: image/jpeg\r\n\r\n").encode()
        out += data + b"\r\n"
    out += f"--{boundary}--\r\n".encode()
    return bytes(out), f"multipart/form-data; boundary={boundary}"


class EvidenceUploader:
    def __init__(self, queue_dir: str, client: Optional[DashboardClient] = None,
                 max_bytes: Optional[int] = None, clock: Callable[[], float] = time.time,
                 start_thread: bool = True):
        self.dir = Path(queue_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.client = client or DashboardClient()
        mb = float(os.getenv("EVIDENCE_QUEUE_MAX_MB") or 500)
        self.max_bytes = int(max_bytes if max_bytes is not None else mb * 1024 * 1024)
        self.clock = clock
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._stop = False
        if start_thread:
            threading.Thread(target=self._run, name="evidence-uploader", daemon=True).start()

    # ── queueing ─────────────────────────────────────────────────────────
    def enqueue(self, incident_id: str, pictures: dict[str, Picture], meta: Optional[dict] = None) -> Optional[Path]:
        encoded = {f: data for f, p in pictures.items() if (data := encode_evidence(p)) is not None}
        if not encoded and not meta:
            return None
        with self._lock:
            item = self.dir / f"{int(self.clock() * 1000):015d}_{incident_id}"
            item.mkdir(parents=True, exist_ok=True)
            for field, data in encoded.items():
                (item / f"{field}.jpg").write_bytes(data)
            (item / "meta.json").write_text(json.dumps(meta or {}), encoding="utf-8")
            self._write_state(item, {"incident_id": incident_id, "attempts": 0, "next_try": 0.0,
                                     "first_404": None, "created": self.clock()})
            self._enforce_cap()
        self._wake.set()
        return item

    def size_bytes(self) -> int:
        return sum(f.stat().st_size for f in self.dir.rglob("*") if f.is_file())

    def pending(self) -> int:
        return len(self._items())

    def _items(self) -> list[Path]:
        return sorted(p for p in self.dir.iterdir() if p.is_dir() and (p / "state.json").exists())

    def _enforce_cap(self) -> None:
        items = self._items()
        total = self.size_bytes()
        while total > self.max_bytes and len(items) > 1:
            oldest = items.pop(0)
            size = sum(f.stat().st_size for f in oldest.rglob("*") if f.is_file())
            shutil.rmtree(oldest, ignore_errors=True)
            total -= size
            print(f"[evidence] queue over {self.max_bytes // (1024 * 1024)} MB: dropped {oldest.name}")

    @staticmethod
    def _read_state(item: Path) -> dict:
        return json.loads((item / "state.json").read_text(encoding="utf-8"))

    @staticmethod
    def _write_state(item: Path, state: dict) -> None:
        (item / "state.json").write_text(json.dumps(state), encoding="utf-8")

    # ── sending ──────────────────────────────────────────────────────────
    def process_once(self) -> bool:
        """Try the oldest due item. True if something was attempted."""
        now = self.clock()
        with self._lock:
            due = [i for i in self._items() if self._read_state(i)["next_try"] <= now]
        if not due:
            return False
        item = due[0]
        state = self._read_state(item)
        files = {p.stem: p.read_bytes() for p in sorted(item.glob("*.jpg"))}
        meta = (item / "meta.json").read_text(encoding="utf-8")
        body, content_type = multipart({"meta": meta} if meta.strip() not in ("", "{}") else {}, files)
        try:
            self.client.request(f"/api/v1/security/incidents/{state['incident_id']}/evidence", None, "POST",
                                data=body, content_type=content_type)
        except DashboardClientError as exc:
            status = getattr(exc, "status_code", None)
            if status == 404:
                state["first_404"] = state["first_404"] or now
                if now - state["first_404"] > GIVE_UP_404_S:
                    return self._drop(item, "incident never appeared on the website")
            elif not getattr(exc, "retryable", False):
                return self._drop(item, f"refused ({exc})")
            state["attempts"] += 1
            state["next_try"] = now + min(30 * 2 ** (state["attempts"] - 1), 3600)
            with self._lock:
                if item.exists():
                    self._write_state(item, state)
            return True
        with self._lock:
            shutil.rmtree(item, ignore_errors=True)
        return True

    def _drop(self, item: Path, why: str) -> bool:
        print(f"[evidence] {item.name}: {why}; not sending it")
        with self._lock:
            shutil.rmtree(item, ignore_errors=True)
        return True

    def close(self) -> None:
        self._stop = True
        self._wake.set()

    def _run(self) -> None:
        while not self._stop:
            try:
                worked = self.process_once()
            except Exception as exc:  # noqa: BLE001 - never stop the uploader
                print(f"[evidence] {type(exc).__name__}: {exc}")
                worked = False
            if not worked:
                self._wake.wait(5.0)
                self._wake.clear()
