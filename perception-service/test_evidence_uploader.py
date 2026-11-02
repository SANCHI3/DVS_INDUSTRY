"""Incident pictures queued on disk and sent to the website (fake client)."""
from __future__ import annotations

import cv2
import numpy as np
import pytest

from reporting.dashboard_client import DashboardClientError
from reporting.evidence_uploader import (
    EvidenceUploader, encode_evidence, evidence_meta, multipart, pick_pictures,
)


def scene(w=1920, h=1080, seed=0) -> np.ndarray:
    img = np.zeros((h, w, 3), np.uint8)
    img[:] = np.linspace(30, 220, w, dtype=np.uint8)[None, :, None]
    cv2.circle(img, (w // 2, h // 2), h // 4, (40, 90, 200 - seed), -1)
    return img


class Clock:
    def __init__(self):
        self.t = 1_000_000.0

    def __call__(self):
        return self.t


class FakeClient:
    def __init__(self, outcomes=None):
        self.outcomes = list(outcomes or [])
        self.calls = []

    def request(self, path, payload=None, method="GET", *, data=None, content_type=None):
        self.calls.append((path, data, content_type))
        if self.outcomes:
            outcome = self.outcomes.pop(0)
            if outcome is not None:
                raise outcome


def error(status, retryable):
    return DashboardClientError(f"HTTP {status}", status_code=status, retryable=retryable)


def make(tmp_path, client, clock, max_bytes=None):
    return EvidenceUploader(str(tmp_path / "queue"), client=client, clock=clock, max_bytes=max_bytes,
                            start_thread=False)


def test_pictures_are_resized_and_small():
    data = encode_evidence(scene())
    assert data is not None and len(data) <= 250 * 1024
    assert cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR).shape[1] == 1280


def test_before_at_after_prefers_main_stream_frames():
    assert pick_pictures(["k0", "k1", "k2"], ["m0", "m1"], ["g0"]) == {
        "keyframe_before": "k0", "keyframe_at": "m0", "keyframe_after": "m1", "gradcam_0": "g0"}
    assert pick_pictures(["k0", "k1", "k2"], [], []) == {
        "keyframe_before": "k0", "keyframe_at": "k1", "keyframe_after": "k2"}


def test_details_never_carry_file_paths():
    meta = evidence_meta({"event_type": "fight", "confidence_tier": "CONFIRMED"},
                         {"score": 0.9, "gradcam_heatmaps": ["C:/out/x.png"]})
    assert meta["eventType"] == "fight" and "gradcam_heatmaps" not in meta["detail"]
    assert meta["tier"] == "CONFIRMED"


def test_a_stage_captured_before_confirmation_is_not_shown():
    assert evidence_meta({"event_type": "fire_smoke", "confidence_tier": "PROBABLE"})["tier"] == ""


def test_multipart_body_has_meta_and_files():
    body, ctype = multipart({"meta": "{}"}, {"keyframe_at": b"\xff\xd8\xffjpeg"})
    boundary = ctype.split("boundary=")[1]
    assert body.startswith(f"--{boundary}".encode()) and body.endswith(f"--{boundary}--\r\n".encode())
    assert b'name="keyframe_at"; filename="keyframe_at.jpg"' in body


def test_sent_items_leave_the_queue(tmp_path):
    client, clock = FakeClient(), Clock()
    up = make(tmp_path, client, clock)
    up.enqueue("INC-1", {"keyframe_at": scene()}, {"eventType": "fire_smoke"})
    assert up.pending() == 1
    assert up.process_once() is True
    path, data, ctype = client.calls[0]
    assert path == "/api/v1/security/incidents/INC-1/evidence" and ctype.startswith("multipart/form-data")
    assert b'name="meta"' in data and b'name="keyframe_at"' in data
    assert up.pending() == 0


def test_asleep_website_is_retried_with_backoff(tmp_path):
    client, clock = FakeClient([error(503, True), error(503, True), None]), Clock()
    up = make(tmp_path, client, clock)
    up.enqueue("INC-2", {"keyframe_at": scene()})
    up.process_once()  # 503 -> retry in 30 s
    assert up.process_once() is False  # not due yet
    clock.t += 31
    up.process_once()  # 503 -> retry in 60 s
    clock.t += 30
    assert up.process_once() is False
    clock.t += 31
    up.process_once()  # sent
    assert up.pending() == 0 and len(client.calls) == 3


def test_incident_not_on_website_yet_is_kept_for_a_day(tmp_path):
    clock = Clock()
    up = make(tmp_path, FakeClient([error(404, False)] * 50), clock)
    up.enqueue("INC-3", {"keyframe_at": scene()})
    for _ in range(20):
        up.process_once()
        clock.t += 3600
    assert up.pending() == 1  # under 24 h of 404s
    clock.t += 6 * 3600
    up.process_once()
    assert up.pending() == 0


@pytest.mark.parametrize("status", [400, 403, 413])
def test_refused_uploads_are_dropped(tmp_path, status):
    up = make(tmp_path, FakeClient([error(status, False)]), Clock())
    up.enqueue("INC-4", {"keyframe_at": scene()})
    up.process_once()
    assert up.pending() == 0


def test_queue_is_capped_dropping_oldest_first(tmp_path):
    clock = Clock()
    up = make(tmp_path, FakeClient(), clock, max_bytes=200 * 1024)
    for n in range(6):
        clock.t += 1
        up.enqueue(f"INC-{n}", {"keyframe_at": scene(seed=n), "keyframe_before": scene(seed=n + 10)})
    assert up.size_bytes() <= 200 * 1024
    names = [p.name for p in up._items()]
    assert names and names[-1].endswith("INC-5") and not any(n.endswith("INC-0") for n in names)


def test_queue_survives_a_restart(tmp_path):
    clock = Clock()
    make(tmp_path, FakeClient([error(503, True)]), clock).enqueue("INC-7", {"keyframe_at": scene()})
    client = FakeClient()
    again = make(tmp_path, client, clock)
    again.process_once()
    assert client.calls and again.pending() == 0
