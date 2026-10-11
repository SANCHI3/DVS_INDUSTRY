from __future__ import annotations

import argparse
from pathlib import Path

import torch

try:
    from .dataset import decode_clip, eval_positions, preprocess_frames
    from .model import build_r3d18
except ImportError:
    from dataset import decode_clip, eval_positions, preprocess_frames
    from model import build_r3d18


class RgbFightClassifier:
    def __init__(self, checkpoint_path: str, device: str | None = None):
        self.device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
        checkpoint = torch.load(checkpoint_path, map_location=self.device, weights_only=False)
        self.clip_frames = int(checkpoint.get("clip_frames", 16))
        self.temporal_stride = int(checkpoint.get("temporal_stride", 2))
        self.image_size = int(checkpoint.get("image_size", 112))
        self.threshold = float(checkpoint.get("threshold", 0.5))
        # Real-time sampling rate the model was trained at (None for legacy
        # checkpoints trained with a fixed frame stride).
        clip_fps = checkpoint.get("clip_fps")
        self.clip_fps = float(clip_fps) if clip_fps else None
        self.eval_clips = int(checkpoint.get("eval_clips", 1))
        self.model = build_r3d18(pretrained=False).to(self.device)
        self.model.load_state_dict(checkpoint["state_dict"])
        self.model.eval()

    def score_clip(self, frames, input_bgr: bool = True) -> float:
        clip = preprocess_frames(list(frames), self.image_size, training=False,
                                 input_bgr=input_bgr).unsqueeze(0).to(self.device)
        with torch.inference_mode():
            return float(torch.sigmoid(self.model(clip).flatten()[0]).item())

    def explain_clip(self, frames, out_dir, prefix: str, count: int = 3,
                     input_bgr: bool = True) -> tuple[float, list[str]]:
        """Grad-CAM for one clip: (fight probability, saved heatmap paths)."""
        from explain.gradcam import r3d_gradcam, save_heatmaps

        frames = list(frames)
        clip = preprocess_frames(frames, self.image_size, training=False,
                                 input_bgr=input_bgr).unsqueeze(0).to(self.device)
        score, cam = r3d_gradcam(self.model, clip)
        bgr = frames if input_bgr else [f[..., ::-1].copy() for f in frames]
        return score, save_heatmaps(bgr, cam, out_dir, prefix, count)

    def score_video(self, video_path: str) -> float:
        """Video-level score: mean probability over evenly spaced clips,
        exactly as validation/test scoring did during training."""
        clips = torch.stack([
            decode_clip(video_path, self.clip_frames, self.temporal_stride,
                        self.image_size, training=False, clip_fps=self.clip_fps,
                        position=position)
            for position in eval_positions(self.eval_clips)
        ]).to(self.device)
        with torch.inference_mode():
            return float(torch.sigmoid(self.model(clips).flatten()).mean().item())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("video")
    parser.add_argument("--checkpoint", default="models/fight_r3d18_v1.pt")
    args = parser.parse_args()
    classifier = RgbFightClassifier(args.checkpoint)
    score = classifier.score_video(args.video)
    print({"video": str(Path(args.video)), "score": score,
           "threshold": classifier.threshold, "fight": score >= classifier.threshold})


if __name__ == "__main__":
    main()
