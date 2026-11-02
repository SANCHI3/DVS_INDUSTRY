"""Factory camera config, video-loss detection, scheduling and evidence grabs (no DVR needed)."""
from __future__ import annotations

import time
from pathlib import Path

import numpy as np
import pytest
import yaml

from ingestion.camera_config import load_camera_setup, parse_setup, substitute_env
from ingestion.evidence_grabber import MainStreamGrabber, grab_frames
from ingestion.stream_reader import OFFLINE, ONLINE, VIDEO_LOSS, StreamReader
from ingestion.video_health import BLACK, FROZEN, OK, VideoHealth
from scheduler import FrameScheduler

ENV = {"DVR_HOST": "192.168.0.139", "DVR_USERNAME": "viewer", "DVR_PASSWORD": "s3cret!"}
CONFIG = Path(__file__).parent / "config" / "cameras.yaml"


# ── camera config ───────────────────────────────────────────────────────────

def test_env_substitution_with_defaults():
    data = {"a": "${DVR_HOST}", "b": ["${MISSING:-554}", "${MISSING}"], "c": 3}
    assert substitute_env(data, ENV) == {"a": "192.168.0.139", "b": ["554", ""], "c": 3}


def test_factory_config_has_eight_dvr_channels():
    setup = load_camera_setup(str(CONFIG), ENV)
    dvr = [c for c in setup.cameras if c.is_dvr]
    assert [c.channel for c in dvr] == list(range(1, 9))
    assert [c.id for c in dvr] == [f"dvr-ch{n}" for n in range(1, 9)]
    assert all(c.detect_stream == "sub" and c.evidence_stream == "main" for c in dvr)
    assert all("Test Room" not in c.location for c in setup.cameras)
    assert setup.get("CAM-01").enabled is False  # the demo webcam is never part of --all
    assert {c.id for c in setup.enabled} == {c.id for c in dvr}


def test_urls_are_built_at_runtime_and_never_in_metadata():
    setup = load_camera_setup(str(CONFIG), ENV)
    cam = setup.get("dvr-ch3")
    assert cam.detect_source(setup.dvr) == "rtsp://viewer:s3cret%21@192.168.0.139:554/Streaming/Channels/302"
    assert cam.evidence_source(setup.dvr).endswith("/Streaming/Channels/301")
    assert "s3cret" not in str(cam.metadata())
    assert cam.metadata() == {"id": "dvr-ch3", "name": "Camera 03", "zone": "", "channel": 3}


def test_url_format_and_port_come_from_env():
    setup = load_camera_setup(str(CONFIG), {**ENV, "DVR_URL_FORMAT": "hik_h264", "DVR_RTSP_PORT": "8554",
                                            "DVR_HOST": "factory-pc"})
    assert setup.get("dvr-ch1").detect_source(setup.dvr) == \
        "rtsp://viewer:s3cret%21@factory-pc:8554/h264/ch1/sub/av_stream"


def test_per_camera_rules_zone_and_location():
    raw = {"dvr": {"host": "${DVR_HOST}"}, "defaults": {"fps": 3, "rules": ["fire", "fall", "crowd"]},
           "cameras": [{"id": "gate", "channel": 2, "name": "Main gate", "zone": "Gate",
                        "rules": ["fire", "smoke", "fall"]}]}
    cam = parse_setup(raw, ENV).get("gate")
    assert cam.rules == ["fire_smoke", "fall"]
    assert cam.location == "Main gate (Gate)"
    assert cam.to_runtime_dict(parse_setup(raw, ENV).dvr)["rules"] == ["fire_smoke", "fall"]


def test_remote_mode_forces_sub_stream_and_low_fps():
    raw = {"dvr": {"host": "x"}, "cameras": [{"id": "a", "channel": 1, "detect_stream": "main", "fps": 5}]}
    cam = parse_setup(raw, {**ENV, "REMOTE_MODE": "true"}).get("a")
    assert (cam.detect_stream, cam.fps) == ("sub", 1.0)


@pytest.mark.parametrize("bad, message", [
    ({"cameras": [{"id": "a"}]}, "channel or a source"),
    ({"cameras": [{"id": "a", "source": "0"}, {"id": "a", "source": "1"}]}, "repeated"),
    ({"cameras": [{"id": "a", "source": "0", "rules": ["dance"]}]}, "unknown rule"),
    ({"dvr": {"host": "x", "transport": "udp"}, "cameras": []}, "tcp"),
])
def test_config_errors_are_explained(bad, message):
    with pytest.raises(ValueError, match=message):
        parse_setup(bad, ENV)


# ── video loss ──────────────────────────────────────────────────────────────

def noisy(seed: int) -> np.ndarray:
    return np.random.default_rng(seed).integers(60, 200, (288, 352, 3), dtype=np.uint8)


def test_live_noisy_picture_is_ok():
    health = VideoHealth()
    for t in range(60):
        assert health.update(noisy(t), float(t)).status == OK


def test_frozen_picture_after_30_seconds():
    health, frame = VideoHealth(frozen_after_s=30), noisy(1)
    assert health.update(frame, 0.0).status == OK
    assert health.update(frame, 29.0).status == OK
    state = health.update(frame, 31.0)
    assert state.status == FROZEN and state.since == 0.0
    assert health.update(noisy(2), 32.0).status == OK


def test_black_picture_is_video_loss_not_fire():
    health = VideoHealth(black_after_s=5)
    black = np.zeros((288, 352, 3), np.uint8)
    for t in range(5):
        health.update(black + (t % 2), float(t))  # tiny changes, still black
    assert health.update(black, 6.0).status == BLACK


class FakeCapture:
    def __init__(self, frames):
        self.frames = list(frames)

    def isOpened(self):
        return True

    def set(self, *_):
        return True

    def read(self):
        return (True, self.frames.pop(0)) if self.frames else (False, None)

    def release(self):
        pass


def test_reader_status_online_then_offline_after_failure():
    reader = StreamReader("rtsp://example.test/s", "dvr-ch1", read_timeout_s=1)
    assert reader.status()["status"] == "CONNECTING"
    captures = [FakeCapture([noisy(i) for i in range(3)])]
    seen = {}

    def open_capture():
        if captures:
            return captures.pop(0)
        raise ConnectionError("down")

    def wait(_delay):
        seen.setdefault("after_read", reader.status(now=time.time()))
        reader._running = False
        return True

    reader._running = True
    reader._open_capture = open_capture
    reader._stop_event.wait = wait
    reader._run_live()
    assert reader.last_frame_at is not None
    assert seen["after_read"]["status"] == OFFLINE  # stream dropped, reconnecting
    assert reader.status(now=reader.last_frame_at + 60)["status"] == OFFLINE


def test_reader_reports_video_loss_while_connected():
    reader = StreamReader("rtsp://example.test/s", "dvr-ch1", frozen_after_s=30)
    frame = noisy(3)
    reader.connected = True
    reader.health.update(frame, 0.0)
    reader.health.update(frame, 40.0)
    reader.last_frame_at = time.time()
    assert reader.status()["status"] == VIDEO_LOSS and reader.video_loss
    reader.health.update(noisy(4), 41.0)
    assert reader.status()["status"] == ONLINE


# ── scheduling ──────────────────────────────────────────────────────────────

class Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


def run_for(scheduler, clock, seconds, step=0.01, infer_s=0.0):
    served = []
    end = clock.t + seconds
    while clock.t < end:
        cam = scheduler.next_camera()
        if cam is None:
            clock.t += step
            continue
        clock.t += infer_s
        scheduler.done(cam, infer_s * 1000)
        served.append(cam)
    return served


def test_each_camera_gets_its_fps_when_the_pc_keeps_up():
    clock = Clock()
    s = FrameScheduler({"a": 3, "b": 3, "c": 1}, max_total_fps=20, clock=clock)
    served = run_for(s, clock, 10)
    assert abs(served.count("a") - 30) <= 2 and abs(served.count("b") - 30) <= 2
    assert abs(served.count("c") - 10) <= 1


def test_total_cap_is_shared_fairly_between_cameras():
    clock = Clock()
    cams = {f"dvr-ch{n}": 3.0 for n in range(1, 9)}  # 24 fps asked
    s = FrameScheduler(cams, max_total_fps=8, clock=clock)
    served = run_for(s, clock, 30)
    assert abs(len(served) - 240) <= 3  # 8 fps total
    counts = [served.count(c) for c in cams]
    assert max(counts) - min(counts) <= 2  # nobody starves


def test_a_slow_pc_lowers_the_rate_instead_of_falling_behind():
    clock = Clock()
    s = FrameScheduler({"a": 5, "b": 5}, max_total_fps=20, clock=clock)
    served = run_for(s, clock, 10, infer_s=0.25)  # 4 frames/s possible
    assert 36 <= len(served) <= 41
    stats = s.take_stats()
    assert stats["a"]["infer_ms"] == 250.0


def test_skipped_camera_does_not_use_a_slot():
    clock = Clock()
    s = FrameScheduler({"a": 3, "b": 3}, max_total_fps=10, clock=clock)
    s.skip("a", retry_after=5)
    assert s.next_camera() == "b"


# ── main-stream evidence ────────────────────────────────────────────────────

def test_grab_frames_skips_warmup_and_closes():
    cap = FakeCapture([noisy(i) for i in range(10)])
    cap.released = False
    cap.release = lambda: setattr(cap, "released", True)
    frames = grab_frames("rtsp://x", count=2, spacing_s=0, open_capture=lambda _u: cap)
    assert len(frames) == 2 and cap.released


def test_grabber_saves_pictures_and_masks_errors(tmp_path, capsys):
    saved = {}
    grabber = MainStreamGrabber(str(tmp_path), password="s3cret!",
                                on_saved=lambda i, p: saved.update({i: p}),
                                grab=lambda url, count: [noisy(1), noisy(2)])
    grabber.request("INC-1", "dvr-ch1", "rtsp://viewer:s3cret%21@h/Streaming/Channels/101")
    grabber.close()
    assert len(saved["INC-1"]) == 2 and all(Path(p).exists() for p in saved["INC-1"])

    def boom(url, count):
        raise RuntimeError(f"could not open {url}")

    failing = MainStreamGrabber(str(tmp_path), password="s3cret!", grab=boom)
    failing.request("INC-2", "dvr-ch1", "rtsp://viewer:s3cret%21@h/Streaming/Channels/101")
    failing.close()
    out = capsys.readouterr().out
    assert "main-stream picture failed" in out and "s3cret" not in out


def test_config_file_is_valid_yaml_with_owner_todos():
    text = CONFIG.read_text(encoding="utf-8")
    assert "TODO(owner)" in text and "password" not in yaml.safe_load(text).get("dvr", {})
