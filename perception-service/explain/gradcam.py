"""Grad-CAM heatmaps for the R3D-18 fight classifier.

Grad-CAM weights the last convolutional block's activations (layer4) by how
much each channel raises the "fight" logit, giving a coarse space-time map of
where the model looked. Overlaid on the clip's frames it lets an operator, or
an examiner, check that an alert was driven by the people interacting rather
than by background clutter.

Offline (figures for a report):
    python -m explain.gradcam data/fight_videos/fight/fi029.mp4 \
        --checkpoint models/fight_r3d18_v1.pt --out output/gradcam
"""
from __future__ import annotations

import argparse
from pathlib import Path
from typing import List, Sequence

import cv2
import numpy as np
import torch
import torch.nn.functional as F


def r3d_gradcam(model: torch.nn.Module, clip: torch.Tensor) -> tuple[float, np.ndarray]:
    """Return (fight probability, cam[T, H, W] in 0..1) for clip [1, C, T, H, W]."""
    activations, gradients = {}, {}
    layer = model.layer4

    def keep_activation(_module, _inputs, output):
        activations["value"] = output
        output.register_hook(lambda grad: gradients.__setitem__("value", grad))

    handle = layer.register_forward_hook(keep_activation)
    was_training = model.training
    model.eval()
    try:
        with torch.enable_grad():
            clip = clip.clone().requires_grad_(True)
            logit = model(clip).flatten()[0]
            model.zero_grad(set_to_none=True)
            logit.backward()
    finally:
        handle.remove()
        model.train(was_training)

    acts, grads = activations["value"].detach(), gradients["value"].detach()  # [1, C, t, h, w]
    weights = grads.mean(dim=(2, 3, 4), keepdim=True)
    cam = F.relu((weights * acts).sum(dim=1, keepdim=True))
    cam = F.interpolate(cam, size=clip.shape[2:], mode="trilinear", align_corners=False)[0, 0]
    cam = cam - cam.min()
    cam = cam / cam.max() if float(cam.max()) > 0 else cam
    return float(torch.sigmoid(logit.detach()).item()), cam.cpu().numpy()


def overlay(frame_bgr: np.ndarray, cam_slice: np.ndarray, alpha: float = 0.45) -> np.ndarray:
    heat = cv2.resize((cam_slice * 255).astype(np.uint8), (frame_bgr.shape[1], frame_bgr.shape[0]))
    colored = cv2.applyColorMap(heat, cv2.COLORMAP_JET)
    return cv2.addWeighted(frame_bgr, 1 - alpha, colored, alpha, 0)


def save_heatmaps(frames_bgr: Sequence[np.ndarray], cam: np.ndarray, out_dir: str | Path,
                  prefix: str, count: int = 3) -> List[str]:
    """Save `count` evenly spaced overlaid keyframes; returns their paths.

    The clip has T frames and the CAM has T slices (same order), so slice i is
    drawn on frame i.
    """
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    picks = np.linspace(0, len(frames_bgr) - 1, num=min(count, len(frames_bgr))).round().astype(int)
    paths = []
    for rank, i in enumerate(picks):
        slice_index = int(round(i * (cam.shape[0] - 1) / max(len(frames_bgr) - 1, 1)))
        path = out / f"{prefix}_gradcam_{rank + 1}.jpg"
        cv2.imwrite(str(path), overlay(frames_bgr[i], cam[slice_index]))
        paths.append(path.as_posix())
    return paths


def main():
    parser = argparse.ArgumentParser(description="Grad-CAM heatmaps for one video")
    parser.add_argument("video")
    parser.add_argument("--checkpoint", default="models/fight_r3d18_v1.pt")
    parser.add_argument("--out", default="output/gradcam")
    parser.add_argument("--count", type=int, default=4)
    args = parser.parse_args()

    from rgb_fight_model.dataset import clip_frame_offsets
    from rgb_fight_model.infer import RgbFightClassifier

    classifier = RgbFightClassifier(args.checkpoint)
    cap = cv2.VideoCapture(args.video)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    offsets = clip_frame_offsets(classifier.clip_frames, classifier.temporal_stride,
                                 classifier.clip_fps, fps)
    start = max((total - offsets[-1] - 1) // 2, 0)
    frames, index = [], 0
    wanted = {start + o for o in offsets}
    try:
        while len(frames) < len(offsets):
            ok, frame = cap.read()
            if not ok:
                break
            if index in wanted:
                frames.append(frame)
            index += 1
    finally:
        cap.release()
    while frames and len(frames) < classifier.clip_frames:
        frames.append(frames[-1])
    if not frames:
        raise SystemExit(f"could not read frames from {args.video}")

    score, paths = classifier.explain_clip(frames, args.out, Path(args.video).stem, args.count)
    print({"video": args.video, "fight_probability": round(score, 4), "heatmaps": paths})


if __name__ == "__main__":
    main()
