"""record_clips segments and the real-footage false-alarm counter."""
from __future__ import annotations

import json
import threading
from collections import Counter

import numpy as np

from evaluation.false_alarms_cctv import channel_folders, count_incidents
from scripts.record_clips import SegmentRecorder, record_channel


class FakeWriter:
    def __init__(self):
        self.frames = 0
        self.released = False

    def write(self, _):
        self.frames += 1

    def release(self):
        self.released = True


def test_new_file_every_segment(tmp_path):
    t = [0.0]
    writers = []
    rec = SegmentRecorder(tmp_path, "ch3", 12.5, segment_s=600, clock=lambda: t[0],
                          make_writer=lambda p, s: writers.append(FakeWriter()) or writers[-1])
    frame = np.zeros((288, 352, 3), np.uint8)
    for _ in range(25 * 60):  # 25 minutes, one frame per second
        rec.write(frame)
        t[0] += 1
    rec.close()
    assert len(rec.files) == 3 and all(w.released for w in writers)
    assert rec.files[0].name.startswith("ch3_") and rec.files[0].suffix == ".mp4"


def test_recording_masks_errors(tmp_path, capsys):
    def boom(_url):
        raise RuntimeError("cannot open rtsp://viewer:s3cret@192.168.0.139:554/Streaming/Channels/102")
    record_channel("rtsp://x", 2, 5, tmp_path, 600, "s3cret", threading.Event(), open_capture=boom)
    out = capsys.readouterr().out
    assert "recording stopped" in out and "s3cret" not in out


def test_counts_only_incidents_staff_would_see(tmp_path):
    rows = [{"incident_id": "A", "event_type": "fire_smoke", "confidence_tier": "CONFIRMED"},
            {"incident_id": "B", "event_type": "crowd", "confidence_tier": "PROBABLE"},
            {"incident_id": "C", "event_type": "fall", "confidence_tier": "PROBABLE"}]
    (tmp_path / "incidents.jsonl").write_text("\n".join(json.dumps(r) for r in rows), encoding="utf-8")
    (tmp_path / "incident_updates.jsonl").write_text(
        json.dumps({"incident_id": "C", "confidence_tier": "CONFIRMED"}) + "\n"
        + json.dumps({"incident_id": "A", "repeat": True}) + "\n", encoding="utf-8")
    shown, repeats = count_incidents(tmp_path)
    assert shown == Counter({"fire_smoke": 1, "fall": 1}) and repeats == 1


def test_channel_folders(tmp_path):
    (tmp_path / "ch3").mkdir()
    (tmp_path / "ch3" / "a.mp4").write_bytes(b"x")
    (tmp_path / "notes").mkdir()
    assert list(channel_folders(tmp_path)) == [3]
