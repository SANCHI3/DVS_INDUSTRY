from __future__ import annotations

import argparse
import csv
import os
import random
import re
from collections import defaultdict
from pathlib import Path

VIDEO_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv", ".webm", ".m4v"}


def group_key(relative: str, pattern: re.Pattern | None) -> str:
    """Videos sharing a group key always land in the same split.

    By default each file is its own group. When clips were cut from longer
    source videos, pass a regex whose first capture group identifies the
    source (e.g. r"(.+)_clip\\d+") so no source leaks across splits.
    """
    if pattern is None:
        return relative
    match = pattern.search(relative)
    return match.group(1) if match else relative


def assign(groups: list[str], seed: int) -> dict[str, str]:
    items = sorted(groups)
    random.Random(seed).shuffle(items)
    n = len(items)
    n_test = max(1, round(n * 0.15))
    n_val = max(1, round(n * 0.15))
    return {
        g: ("test" if i < n_test else "val" if i < n_test + n_val else "train")
        for i, g in enumerate(items)
    }


def main():
    parser = argparse.ArgumentParser(description="Create video-level RGB fight manifest")
    parser.add_argument("--input", required=True, help="folder containing fight/ and not_fight/")
    parser.add_argument("--output", default="data/rgb_fight_manifest.csv")
    parser.add_argument("--seed", type=int, default=126)
    parser.add_argument("--group-regex", default=None,
                        help="regex over '<class>/<file>' whose first group names the source video")
    args = parser.parse_args()

    root = Path(args.input).resolve()
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    pattern = re.compile(args.group_regex) if args.group_regex else None

    rows = []
    for folder, label in (("fight", 1), ("not_fight", 0)):
        class_dir = root / folder
        paths = sorted(p for p in class_dir.rglob("*") if p.suffix.lower() in VIDEO_EXTENSIONS)
        if not paths:
            raise FileNotFoundError(f"no videos found in {class_dir}")
        by_group: dict[str, list[Path]] = defaultdict(list)
        for path in paths:
            by_group[group_key(path.relative_to(root).as_posix(), pattern)].append(path)
        splits = assign(list(by_group), args.seed + label)
        for group, members in sorted(by_group.items()):
            for path in members:
                rows.append({
                    # Relative to the manifest, so the project folder can move
                    "path": Path(os.path.relpath(path, output.parent)).as_posix(),
                    "relative_path": path.relative_to(root).as_posix(),
                    "label": label,
                    "split": splits[group],
                    "group_id": group,
                })

    with output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle, fieldnames=["path", "relative_path", "label", "split", "group_id"]
        )
        writer.writeheader()
        writer.writerows(rows)
    counts = {(s, y): sum(r["split"] == s and r["label"] == y for r in rows)
              for s in ("train", "val", "test") for y in (0, 1)}
    print({"manifest": str(output), "videos": len(rows), "groups": len({r["group_id"] for r in rows}),
           "counts": counts})


if __name__ == "__main__":
    main()
