"""Draw a camera's area of interest or ignore zones on its snapshot, print the YAML.

    cd perception-service
    python scripts/grab_snapshots.py --channels 3          # once, saves calibration/snapshots/ch3.jpg
    python scripts/draw_roi.py 3                            # area to check (roi)
    python scripts/draw_roi.py 3 --ignore --name "Welding bay" --events fire_smoke

Mouse: left click adds a point, right click removes the last one.
Keys:  n = finish this polygon and start another (ignore zones)
       c = clear    s / Enter = done, print the YAML    q / Esc = quit
Paste the printed lines under the camera in config/cameras.yaml. Coordinates
are fractions of the picture (0-1), so they work for any stream resolution.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOTS = ROOT / "calibration" / "snapshots"


def normalise(points: list[tuple[int, int]], width: int, height: int) -> list[list[float]]:
    return [[round(x / max(width - 1, 1), 3), round(y / max(height - 1, 1), 3)] for x, y in points]


def to_yaml(polygons: list[list[list[float]]], ignore: bool = False, name: str = "",
            events: list[str] | None = None) -> str:
    """The cameras.yaml lines for the drawn polygons."""
    polygons = [p for p in polygons if len(p) >= 3]
    if not polygons:
        return ""
    fmt = lambda poly: "[" + ", ".join(f"[{x:g}, {y:g}]" for x, y in poly) + "]"  # noqa: E731
    if not ignore:
        return f"    roi: {fmt(polygons[0])}"
    lines = ["    ignore_zones:"]
    for i, poly in enumerate(polygons):
        label = name if len(polygons) == 1 else f"{name or 'Zone'} {i + 1}"
        lines.append(f"      - name: \"{label or f'Zone {i + 1}'}\"")
        lines.append(f"        polygon: {fmt(poly)}")
        if events:
            lines.append(f"        events: [{', '.join(events)}]")
    return "\n".join(lines)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("channel", type=int, help="DVR channel (uses calibration/snapshots/chN.jpg)")
    parser.add_argument("--image", type=Path, help="another picture instead of the snapshot")
    parser.add_argument("--ignore", action="store_true", help="draw ignore zones instead of the area to check")
    parser.add_argument("--name", default="", help="ignore zone name, e.g. 'Welding bay'")
    parser.add_argument("--events", default="", help="ignore only these checks, e.g. fire_smoke or fall,crowd")
    args = parser.parse_args(argv)

    path = args.image or SNAPSHOTS / f"ch{args.channel}.jpg"
    image = cv2.imread(str(path))
    if image is None:
        print(f"No picture at {path}. Run: python scripts/grab_snapshots.py --channels {args.channel}")
        return 1
    h, w = image.shape[:2]
    polygons: list[list[tuple[int, int]]] = [[]]
    title = f"ch{args.channel}: {'ignore zones' if args.ignore else 'area to check'} (s = done, n = next, c = clear)"

    def on_mouse(event, x, y, _flags, _param):
        if event == cv2.EVENT_LBUTTONDOWN:
            polygons[-1].append((x, y))
        elif event == cv2.EVENT_RBUTTONDOWN and polygons[-1]:
            polygons[-1].pop()

    cv2.namedWindow(title)
    cv2.setMouseCallback(title, on_mouse)
    while True:
        view = image.copy()
        overlay = view.copy()
        colour = (0, 0, 255) if args.ignore else (0, 200, 0)
        for poly in polygons:
            if len(poly) >= 3:
                cv2.fillPoly(overlay, [np.array(poly, np.int32)], colour)
            for i, p in enumerate(poly):
                cv2.circle(view, p, 4, colour, -1)
                if i:
                    cv2.line(view, poly[i - 1], p, colour, 2)
        view = cv2.addWeighted(overlay, 0.25, view, 0.75, 0)
        cv2.imshow(title, view)
        key = cv2.waitKey(30) & 0xFF
        if key in (ord("q"), 27):
            cv2.destroyAllWindows()
            return 0
        if key == ord("c"):
            polygons[:] = [[]]
        if key == ord("n") and args.ignore and len(polygons[-1]) >= 3:
            polygons.append([])
        if key in (ord("s"), 13):
            break
    cv2.destroyAllWindows()
    events = [e.strip() for e in args.events.split(",") if e.strip()] or None
    text = to_yaml([normalise(p, w, h) for p in polygons], args.ignore, args.name, events)
    print(text or "Nothing drawn (a polygon needs at least 3 points).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
