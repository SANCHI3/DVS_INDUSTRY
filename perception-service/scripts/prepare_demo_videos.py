"""Copy the demo clips into demo_videos/ from the local training datasets.

    python scripts/prepare_demo_videos.py

The clips are not committed (the datasets' redistribution terms vary), so a
fresh clone needs either the datasets under data/ or four clips of your own
(see demo_videos/README.md). Each clip below was checked to produce exactly
one CONFIRMED incident of its type through the full pipeline (normal: none).
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

DEMO_CLIPS = [
    # (name in demo_videos/, source under data/, what it shows)
    ("01_normal_activity.mp4", "fall_videos/not_fall/01.mp4", "person exercising, no incident expected"),
    ("02_fight.mp4", "fight_videos/fight/V_377.mp4", "fight (test split of the fight model)"),
    ("03_fire.avi", "fire_smoke_videos/firesense/fire/pos/posVideo9.878.avi", "fire (FIRESENSE)"),
    ("04_fall.mp4", "fall_videos/fall/01.mp4", "person falling"),
]


def main() -> int:
    target = ROOT / "demo_videos"
    target.mkdir(exist_ok=True)
    missing = 0
    for name, source, description in DEMO_CLIPS:
        src = ROOT / "data" / source
        dst = target / name
        if dst.exists():
            print(f"exists   {name}")
        elif src.exists():
            shutil.copy2(src, dst)
            print(f"copied   {name}  <- data/{source}  ({description})")
        else:
            missing += 1
            print(f"MISSING  {name}: data/{source} not found -- add your own {description} clip as {name}")
    if missing:
        print(f"\n{missing} clip(s) missing. Demo mode plays whatever videos are in demo_videos/.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
