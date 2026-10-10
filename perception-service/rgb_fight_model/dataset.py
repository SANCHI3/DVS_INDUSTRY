from __future__ import annotations

import csv
import random
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
import torch
from torch.utils.data import Dataset

KINETICS_MEAN = np.asarray([0.43216, 0.394666, 0.37645], dtype=np.float32)
KINETICS_STD = np.asarray([0.22803, 0.22145, 0.216989], dtype=np.float32)

# Assumed source frame rate when a video does not report one
DEFAULT_SOURCE_FPS = 30.0


@dataclass(frozen=True)
class VideoRecord:
    path: str
    label: int
    split: str
    group_id: str


def load_manifest(path: str | Path, data_root: str | Path | None = None) -> list[VideoRecord]:
    """Load a manifest, resolving each video path robustly.

    Paths may be absolute or relative to the manifest. If a path no longer
    exists (e.g. the project folder moved), it is re-resolved as
    ``data_root / <path relative to the class folder>`` so old manifests and
    their exact splits stay reusable.
    """
    manifest = Path(path).resolve()
    root = Path(data_root).resolve() if data_root is not None else None
    records = []
    with manifest.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            video = Path(row["path"])
            if not video.is_absolute():
                video = manifest.parent / video
            if not video.exists() and root is not None:
                candidate = root / row.get("relative_path", "") if row.get("relative_path") else None
                if candidate is None or not candidate.exists():
                    # Legacy manifests store "<class>/<file>" in group_id
                    candidate = root / row["group_id"]
                video = candidate
            records.append(VideoRecord(str(video), int(row["label"]), row["split"], row["group_id"]))
    missing = [r.path for r in records if not Path(r.path).exists()]
    if missing:
        raise FileNotFoundError(
            f"{len(missing)} manifest videos not found (first: {missing[0]}). "
            "Pass --data-root pointing at the folder that contains fight/ and not_fight/."
        )
    return records


def preprocess_frames(frames: list[np.ndarray], size: int = 112,
                      training: bool = False, input_bgr: bool = False) -> torch.Tensor:
    """Apply the same spatial transform/normalization to decoded or live frames."""
    resized = []
    for frame in frames:
        if input_bgr:
            frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        h, w = frame.shape[:2]
        scale = 128.0 / max(min(h, w), 1)
        resized.append(cv2.resize(frame, (max(128, round(w * scale)),
                                          max(128, round(h * scale)))))
    stack = np.stack(resized)
    h, w = stack.shape[1:3]
    if training:
        top = random.randint(0, max(h - size, 0))
        left = random.randint(0, max(w - size, 0))
        if random.random() < 0.5:
            stack = stack[:, :, ::-1, :]
    else:
        top, left = max((h - size) // 2, 0), max((w - size) // 2, 0)
    stack = stack[:, top:top + size, left:left + size, :].copy()
    stack = stack.astype(np.float32) / 255.0
    if training:
        # CCTV lighting varies a lot (day/night, IR, exposure). One brightness/
        # contrast change per clip keeps the motion signal intact.
        contrast = random.uniform(0.75, 1.25)
        brightness = random.uniform(-0.12, 0.12)
        stack = np.clip((stack - 0.5) * contrast + 0.5 + brightness, 0.0, 1.0)
        if random.random() < 0.1:  # occasional grayscale, like IR night mode
            stack = np.repeat(stack.mean(axis=3, keepdims=True), 3, axis=3)
    stack = (stack - KINETICS_MEAN) / KINETICS_STD
    return torch.from_numpy(stack.astype(np.float32)).permute(3, 0, 1, 2).contiguous()


def shrink_to_model_scale(frame: np.ndarray) -> np.ndarray:
    """Downscale to short side 128 right after decoding (preprocess_frames
    would do it anyway); holding full-resolution frames wastes memory."""
    h, w = frame.shape[:2]
    scale = 128.0 / max(min(h, w), 1)
    if scale >= 1.0:
        return frame
    return cv2.resize(frame, (max(128, round(w * scale)), max(128, round(h * scale))),
                      interpolation=cv2.INTER_AREA)


def clip_frame_offsets(clip_frames: int, temporal_stride: int,
                       clip_fps: float | None, source_fps: float) -> list[int]:
    """Frame offsets (relative to the clip start) to sample.

    With ``clip_fps`` the clip covers a fixed real-time duration regardless of
    the video's frame rate, matching how the live pipeline samples frames.
    Without it, the legacy fixed frame stride is used.
    """
    if clip_fps:
        step = max(source_fps, 1.0) / clip_fps
        return [int(round(i * step)) for i in range(clip_frames)]
    return [i * temporal_stride for i in range(clip_frames)]


def decode_clip(path: str, clip_frames: int, temporal_stride: int, size: int,
                training: bool, clip_fps: float | None = None,
                position: float | None = None) -> torch.Tensor:
    """Decode one clip.

    position: where the clip sits in the video, 0.0 (start) … 1.0 (end).
    Training picks a random position; evaluation defaults to the centre.
    """
    cap = cv2.VideoCapture(path)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    source_fps = cap.get(cv2.CAP_PROP_FPS) or DEFAULT_SOURCE_FPS
    offsets = clip_frame_offsets(clip_frames, temporal_stride, clip_fps, source_fps)
    span = offsets[-1] + 1
    if total > span:
        if training:
            start = random.randint(0, total - span)
        else:
            start = int(round((total - span) * (0.5 if position is None else position)))
    else:
        start = 0
    cap.set(cv2.CAP_PROP_POS_FRAMES, start)
    wanted: dict[int, list[int]] = {}
    for i, offset in enumerate(offsets):
        wanted.setdefault(offset, []).append(i)
    collected: list[np.ndarray | None] = [None] * clip_frames
    last = None
    try:
        for offset in range(span):
            ok, frame = cap.read()
            if not ok:
                break
            if offset in wanted:
                frame = cv2.cvtColor(shrink_to_model_scale(frame), cv2.COLOR_BGR2RGB)
                for i in wanted[offset]:
                    collected[i] = frame
                last = frame
    finally:
        cap.release()
    if last is None:
        last = np.zeros((128, 128, 3), dtype=np.uint8)
    for i, frame in enumerate(collected):
        if frame is None:
            collected[i] = last.copy()
    return preprocess_frames(collected, size=size, training=training, input_bgr=False)


def eval_positions(eval_clips: int) -> list[float]:
    """Evenly spaced clip positions, e.g. 3 → [0.25, 0.5, 0.75]."""
    return [(k + 1) / (eval_clips + 1) for k in range(eval_clips)]


class RgbFightDataset(Dataset):
    def __init__(self, records: list[VideoRecord], split: str, clip_frames: int = 16,
                 temporal_stride: int = 2, size: int = 112,
                 clip_fps: float | None = None, eval_clips: int = 1):
        self.records = [r for r in records if r.split == split]
        if not self.records:
            raise ValueError(f"no records for split {split}")
        self.training = split == "train"
        self.clip_frames = clip_frames
        self.temporal_stride = temporal_stride
        self.size = size
        self.clip_fps = clip_fps
        self.eval_clips = max(1, eval_clips)

    def __len__(self):
        return len(self.records)

    def __getitem__(self, index):
        record = self.records[index]
        if self.training:
            clip = decode_clip(record.path, self.clip_frames, self.temporal_stride,
                               self.size, True, self.clip_fps)
        else:
            # Several clips per video, shape [K, C, T, H, W]; scores are averaged
            clip = torch.stack([
                decode_clip(record.path, self.clip_frames, self.temporal_stride,
                            self.size, False, self.clip_fps, position)
                for position in eval_positions(self.eval_clips)
            ])
        return clip, torch.tensor(float(record.label)), record.group_id
