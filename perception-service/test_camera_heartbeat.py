"""Camera heartbeats and snapshots to the website (fake client, no network)."""
from __future__ import annotations

from collections import Counter, defaultdict
from types import SimpleNamespace

import cv2
import numpy as np

from ingestion.camera_config import CameraSpec
from ingestion.stream_reader import FrameSample
from reporting.camera_heartbeat import CameraHeartbeat, encode_snapshot, instance_identity


class FakeClient:
    def __init__(self):
        self.calls = []

    def request(self, path, payload=None, method="GET", *, data=None, content_type=None):
        self.calls.append((path, payload, method, data, content_type))


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


class FakeReader:
    def __init__(self, status="ONLINE", detail="", frame=None):
        self._status, self._detail = status, detail
        self.frame = frame if frame is not None else scene()

    def status(self):
        return {"status": self._status, "detail": self._detail, "last_frame_at": 1_762_000_000.0}

    def get_latest(self):
        return FrameSample(self.frame, 0.0, 1)

    def _is_file_source(self):
        return False


def scene(w=704, h=576) -> np.ndarray:
    """A plausible camera picture (gradients and shapes, not noise)."""
    img = np.zeros((h, w, 3), np.uint8)
    img[:] = np.linspace(40, 200, w, dtype=np.uint8)[None, :, None]
    cv2.rectangle(img, (100, 100), (300, 400), (30, 60, 200), -1)
    cv2.circle(img, (500, 300), 80, (200, 200, 50), -1)
    return img


def pipeline(frames, total_ms, calls):
    timer = SimpleNamespace(total_ms=defaultdict(float, cycle_total=total_ms),
                            calls=Counter(cycle_total=calls))
    return SimpleNamespace(frames_processed=frames, timer=timer)


CAMS = [CameraSpec(id="dvr-ch1", name="Camera 01", zone="Press shop", channel=1),
        CameraSpec(id="dvr-ch2", name="Camera 02", channel=2)]


def make(clock, client=None):
    return CameraHeartbeat(CAMS, client=client or FakeClient(), identity=("factory-pc", "live"),
                           clock=clock, start_thread=False)


def test_identity_from_env_and_remote_mode_defaults_to_dev():
    assert instance_identity({"PERCEPTION_INSTANCE_ID": "factory pc #1"}) == ("factory-pc--1", "live")
    assert instance_identity({"PERCEPTION_INSTANCE_ID": "dev-laptop", "REMOTE_MODE": "true"})[1] == "dev"
    assert instance_identity({"PERCEPTION_INSTANCE_ID": "x", "REMOTE_MODE": "true",
                              "PERCEPTION_SOURCE": "live"})[1] == "live"


def test_snapshot_is_small_enough_for_the_website():
    jpeg = encode_snapshot(scene(1920, 1080))
    assert jpeg is not None and len(jpeg) <= 100 * 1024
    decoded = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
    assert decoded.shape[1] == 640 and decoded.shape[0] == 360


def test_payload_has_status_rates_and_no_urls():
    clock = Clock()
    hb = make(clock)
    readers = {"dvr-ch1": FakeReader(), "dvr-ch2": FakeReader("VIDEO_LOSS", "frozen")}
    pipes = {"dvr-ch1": pipeline(0, 0.0, 0), "dvr-ch2": pipeline(0, 0.0, 0)}
    hb.build_payload(readers, pipes)  # first call sets the baseline
    clock.t += 30
    pipes["dvr-ch1"] = pipeline(90, 9000.0, 90)
    payload = hb.build_payload(readers, pipes)
    assert payload["instanceId"] == "factory-pc" and payload["source"] == "live"
    ch1, ch2 = payload["cameras"]
    assert ch1 == {"id": "dvr-ch1", "channel": 1, "name": "Camera 01", "zone": "Press shop", "enabled": True,
                   "status": "ONLINE", "statusDetail": None, "lastFrameAt": ch1["lastFrameAt"],
                   "achievedFps": 3.0, "inferMs": 100.0}
    assert ch2["status"] == "VIDEO_LOSS" and ch2["statusDetail"] == "Picture frozen" and ch2["zone"] is None
    assert "rtsp" not in str(payload)


def test_missing_reader_counts_as_offline():
    payload = make(Clock()).build_payload({}, {})
    assert {c["status"] for c in payload["cameras"]} == {"OFFLINE"}


def test_tick_sends_heartbeat_every_30s_and_pictures_every_2_minutes():
    clock, client = Clock(), FakeClient()
    hb = make(clock, client)
    readers = {c.id: FakeReader() for c in CAMS}

    def drain():
        while not hb._jobs.empty():
            hb.send(hb._jobs.get())

    for _ in range(int(300 / 5)):  # five minutes, ticking every 5 s
        hb.tick(readers, {})
        drain()
        clock.t += 5
    beats = [c for c in client.calls if c[0].endswith("/heartbeat")]
    pictures = [c for c in client.calls if c[0].endswith("/snapshot")]
    assert len(beats) == 10
    assert sorted({c[0] for c in pictures}) == ["/api/v1/cameras/dvr-ch1/snapshot", "/api/v1/cameras/dvr-ch2/snapshot"]
    assert all(c[4] == "image/jpeg" and len(c[3]) <= 100 * 1024 for c in pictures)
    assert 4 <= len(pictures) <= 6  # about one per camera per 2 minutes


def test_a_slow_server_drops_jobs_instead_of_blocking():
    clock = Clock()
    hb = make(clock)
    readers = {c.id: FakeReader() for c in CAMS}
    for _ in range(50):
        hb.tick(readers, {})  # nothing drains the queue
        clock.t += 31
    assert hb._jobs.qsize() == 4
