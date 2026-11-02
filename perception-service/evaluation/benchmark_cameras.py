"""How many cameras at what fps this PC can run: CPU, RAM and achieved fps.

    python -m evaluation.benchmark_cameras --config-dir <dir with cameras.yaml> --seconds 130
    set CUDA_VISIBLE_DEVICES=-1 first to measure CPU-only

Runs multi_camera.run_all (all models, nothing sent to the website) and
samples this process's CPU and memory every 2 s. The [perf] lines show each
camera's achieved fps and inference time.
"""
from __future__ import annotations

import argparse
import os
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config-dir", default="config")
    parser.add_argument("--seconds", type=float, default=130)
    parser.add_argument("--output-dir", default="output/benchmark")
    args = parser.parse_args(argv)
    os.environ["DASHBOARD_BACKEND_URL"] = ""  # nothing leaves this PC
    import psutil

    import multi_camera

    multi_camera.STATS_EVERY_S = 30.0
    proc = psutil.Process()
    samples: list[tuple[float, float]] = []
    stop = threading.Event()

    def sample():
        proc.cpu_percent(None)
        while not stop.wait(2.0):
            samples.append((proc.cpu_percent(None) / psutil.cpu_count(), proc.memory_info().rss / 1e9))

    started = time.time()
    threading.Thread(target=sample, daemon=True).start()
    from ingestion.camera_config import load_camera_setup

    ids = [c.id for c in load_camera_setup(os.path.join(args.config_dir, "cameras.yaml")).cameras if c.enabled]
    multi_camera.run_all(camera_ids=ids, max_seconds=args.seconds, output_dir=args.output_dir,
                         config_dir=args.config_dir)
    stop.set()
    steady = samples[len(samples) // 4:] or samples
    if steady:
        cpu = sum(s[0] for s in steady) / len(steady)
        ram = max(s[1] for s in steady)
        print(f"[bench] {time.time() - started:.0f} s: CPU {cpu:.0f}% of all cores (mean), "
              f"RAM {ram:.2f} GB (peak), {psutil.cpu_count()} logical cores, "
              f"{psutil.virtual_memory().total / 1e9:.0f} GB installed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
