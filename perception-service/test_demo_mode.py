"""Demo mode and graceful degradation (no camera, GPU or model weights needed).

    python -m pytest test_demo_mode.py
"""
from __future__ import annotations

import numpy as np

from ingestion.demo_playlist import DemoPlaylistReader, find_demo_videos
from ingestion.stream_reader import FrameSample


class FakeFileReader:
    """Stands in for StreamReader on a video file of `frames` frames."""

    opened: list = []

    def __init__(self, source, camera_id, target_fps, frames=3):
        self.source = source
        self.frames = 2 if "short" in source else frames
        self.index = 0
        self.ended = False

    def start(self):
        if "broken" in self.source:
            raise ConnectionError("could not open")
        FakeFileReader.opened.append(self.source)
        return self

    def get_latest(self):
        if self.index >= self.frames:
            self.ended = True
            return None
        self.index += 1
        return FrameSample(np.zeros((2, 2, 3), np.uint8), float(self.index), self.index)

    def is_end_of_stream(self):
        return self.ended

    def stop(self):
        pass


def _playlist(names, **kwargs):
    FakeFileReader.opened = []
    return DemoPlaylistReader([__import__("pathlib").Path(n) for n in names], "CAM-T", 10,
                              reader_factory=FakeFileReader, **kwargs).start()


def test_playlist_loops_and_frame_index_keeps_increasing():
    reader = _playlist(["a.mp4", "b_short.mp4"])
    indices = [reader.get_latest().frame_index for _ in range(10)]
    assert indices == list(range(1, 11))
    assert FakeFileReader.opened[:4] == ["a.mp4", "b_short.mp4", "a.mp4", "b_short.mp4"]
    assert not reader.is_end_of_stream()


def test_playlist_skips_unreadable_files():
    reader = _playlist(["broken.mp4", "good.mp4"])
    assert reader.get_latest() is not None
    assert FakeFileReader.opened == ["good.mp4"]


def test_playlist_with_only_unreadable_files_ends():
    reader = _playlist(["broken1.mp4", "broken2.mp4"])
    assert reader.get_latest() is None
    assert reader.is_end_of_stream()


def test_clip_start_callback_fires_per_clip():
    started = []
    reader = _playlist(["a.mp4", "b.mp4"], on_clip_start=lambda v: started.append(v.name))
    for _ in range(7):
        reader.get_latest()
    assert started == ["a.mp4", "b.mp4", "a.mp4"]


def test_find_demo_videos_filters_and_sorts(tmp_path):
    for name in ["02_fight.MP4", "01_normal.avi", "README.md", "notes.txt"]:
        (tmp_path / name).write_bytes(b"x")
    assert [p.name for p in find_demo_videos(tmp_path)] == ["01_normal.avi", "02_fight.MP4"]
    assert find_demo_videos(tmp_path / "missing") == []


def test_lfs_pointer_and_missing_checkpoint_disable_only_that_detector(tmp_path, capsys):
    import main

    pointer = tmp_path / "fight.pt"
    pointer.write_text("version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 133000000\n")
    assert "git lfs pull" in main.checkpoint_problem(str(pointer))
    assert "not found" in main.checkpoint_problem(str(tmp_path / "nope.pt"))

    built = []
    assert main.start_optional("CAM-T", "fight", lambda: built.append(1), checkpoint=str(pointer)) is None
    assert built == []  # never tried to unpickle the pointer
    assert "fight detection disabled" in capsys.readouterr().out

    def broken():
        raise RuntimeError("CUDA out of memory")
    assert main.start_optional("CAM-T", "fall", broken) is None
    assert "RuntimeError" in capsys.readouterr().out
    assert main.start_optional("CAM-T", "ok", lambda: "detector") == "detector"


def test_output_paths_follow_output_dir():
    import main

    assert main.redirect_output("output/evidence", "output") == "output/evidence"
    assert main.redirect_output("output/evidence", "runs/x").replace("\\", "/") == "runs/x/evidence"
    assert main.redirect_output("models/a.pt", "runs/x") == "models/a.pt"


def test_fire_detector_runs_on_cpu_when_no_gpu(monkeypatch):
    import torch

    from temporal import fire_smoke_recognition as fsr

    monkeypatch.setattr(torch.cuda, "is_available", lambda: False)
    assert fsr._resolve_device(0) == "cpu"
    assert fsr._resolve_device("cpu") == "cpu"
