import csv
import tempfile
import unittest
from pathlib import Path

import numpy as np

from rgb_fight_model.dataset import clip_frame_offsets, eval_positions, load_manifest
from rgb_fight_model.train import roc_auc
from temporal.rgb_action_recognition import sample_by_time


class ClipSamplingTests(unittest.TestCase):
    def test_real_time_sampling_spans_same_duration_for_any_source_fps(self):
        for source_fps in (12, 25, 30, 37):
            offsets = clip_frame_offsets(16, 2, clip_fps=10.0, source_fps=source_fps)
            span_seconds = offsets[-1] / source_fps
            self.assertAlmostEqual(span_seconds, 1.5, delta=1.0 / source_fps)

    def test_legacy_stride_is_unchanged(self):
        self.assertEqual(clip_frame_offsets(4, 2, None, 30), [0, 2, 4, 6])

    def test_eval_positions_are_evenly_spaced(self):
        self.assertEqual(eval_positions(1), [0.5])
        self.assertEqual(eval_positions(3), [0.25, 0.5, 0.75])

    def test_runtime_sampler_picks_nearest_timestamps(self):
        # Processing at ~20 fps but the model expects 10 fps → every 2nd frame
        times = [i * 0.05 for i in range(40)]
        frames = list(range(40))
        picked = sample_by_time(times, frames, start=0.0, fps=10.0, count=16)
        self.assertEqual(picked, list(range(0, 32, 2)))

    def test_runtime_sampler_repeats_frames_when_processing_is_slow(self):
        times = [0.0, 0.2, 0.4]
        picked = sample_by_time(times, ["a", "b", "c"], start=0.0, fps=10.0, count=5)
        self.assertEqual(picked, ["a", "a", "b", "b", "c"])


class ManifestTests(unittest.TestCase):
    def test_moved_dataset_is_re_resolved_from_data_root(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "videos"
            (root / "fight").mkdir(parents=True)
            (root / "fight" / "a.mp4").write_bytes(b"")
            manifest = Path(directory) / "m.csv"
            with manifest.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.DictWriter(handle, fieldnames=["path", "label", "split", "group_id"])
                writer.writeheader()
                writer.writerow({"path": r"C:\old\place\fight\a.mp4", "label": 1,
                                 "split": "train", "group_id": "fight/a.mp4"})

            with self.assertRaises(FileNotFoundError):
                load_manifest(manifest)
            records = load_manifest(manifest, data_root=root)
            self.assertEqual(Path(records[0].path), root / "fight" / "a.mp4")


class MetricTests(unittest.TestCase):
    def test_auc(self):
        labels = np.array([0, 0, 1, 1])
        self.assertEqual(roc_auc(labels, np.array([0.1, 0.2, 0.8, 0.9])), 1.0)
        self.assertEqual(roc_auc(labels, np.array([0.9, 0.8, 0.2, 0.1])), 0.0)
        self.assertEqual(roc_auc(labels, np.array([0.5, 0.5, 0.5, 0.5])), 0.5)


if __name__ == "__main__":
    unittest.main()
