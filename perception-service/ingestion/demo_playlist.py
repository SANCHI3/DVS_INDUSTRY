"""Looping video playlist for demo mode (`python main.py --demo`).

Plays every video in a folder in name order, then starts again, so the full
pipeline -> dashboard -> alert chain can be shown on any laptop without a
camera. Each file is read by the normal StreamReader (deterministic file
playback at the processing FPS); this class only moves on to the next file
when one ends, and never reports end-of-stream.
"""
from __future__ import annotations

from pathlib import Path
from typing import Callable, List, Optional

from ingestion.stream_reader import FrameSample, StreamReader

VIDEO_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv", ".webm", ".m4v"}


def find_demo_videos(folder: str | Path) -> List[Path]:
    path = Path(folder)
    if not path.is_dir():
        return []
    return sorted(p for p in path.iterdir() if p.suffix.lower() in VIDEO_EXTENSIONS)


class DemoPlaylistReader:
    """Same interface as StreamReader (start / get_latest / is_end_of_stream / stop)."""

    def __init__(self, videos: List[Path], camera_id: str, target_fps: float,
                 loop: bool = True, on_clip_start: Optional[Callable[[Path], None]] = None,
                 reader_factory: Callable[..., StreamReader] = StreamReader):
        if not videos:
            raise ValueError("demo playlist is empty")
        self.videos = list(videos)
        self.camera_id = camera_id
        self.target_fps = target_fps
        self.loop = loop
        self.on_clip_start = on_clip_start
        self._reader_factory = reader_factory
        self._index = -1
        self._reader: Optional[StreamReader] = None
        self._frame_offset = 0
        self._last_frame_index = 0
        self._finished = False
        self._failed_in_a_row = 0

    def start(self) -> "DemoPlaylistReader":
        self._open_next()
        return self

    def _open_next(self) -> bool:
        while self._failed_in_a_row < len(self.videos):
            self._index += 1
            if self._index >= len(self.videos):
                if not self.loop:
                    self._finished = True
                    return False
                self._index = 0
            video = self.videos[self._index]
            if self._reader is not None:
                self._reader.stop()
            # frame indices keep increasing across files, as on a live camera
            self._frame_offset = self._last_frame_index
            try:
                self._reader = self._reader_factory(
                    source=str(video), camera_id=self.camera_id, target_fps=self.target_fps
                ).start()
            except ConnectionError:
                print(f"[{self.camera_id}] demo: could not open {video.name}, skipping")
                self._reader = None
                self._failed_in_a_row += 1
                continue
            self._failed_in_a_row = 0
            print(f"[{self.camera_id}] demo: playing {video.name} "
                  f"({self._index + 1}/{len(self.videos)})")
            if self.on_clip_start is not None:
                self.on_clip_start(video)
            return True
        print(f"[{self.camera_id}] demo: none of the {len(self.videos)} videos could be opened")
        self._finished = True
        return False

    def get_latest(self) -> Optional[FrameSample]:
        if self._finished or self._reader is None:
            return None
        sample = self._reader.get_latest()
        if sample is None:
            if self._reader.is_end_of_stream() and self._open_next():
                sample = self._reader.get_latest()
            if sample is None:
                return None
        index = self._frame_offset + sample.frame_index
        self._last_frame_index = index
        return FrameSample(sample.frame, sample.timestamp, index)

    def is_end_of_stream(self) -> bool:
        return self._finished

    def stop(self):
        if self._reader is not None:
            self._reader.stop()
            self._reader = None
