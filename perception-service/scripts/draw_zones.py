"""Draw restricted-area polygons on a camera frame and get the YAML for cameras.yaml.

    cd perception-service
    python scripts/draw_zones.py --camera CAM-01                 # grabs a frame from the camera's source
    python scripts/draw_zones.py --camera CAM-01 --source 0      # or a webcam index / RTSP URL / video / image

The frame is resized to the processing resolution (thresholds.yaml
perception.process_width/height), which is the coordinate system zones use.

    left click   add a point            right click / Enter   finish the zone
    u            undo last point        d                     delete last zone
    s            save and quit          q / Esc               quit without saving

Saving prints the zones block and writes it to config/zones_<camera>.yaml.
Paste it over the camera's `zones:` list in config/cameras.yaml (the file is
not edited automatically, so its comments are kept).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np
import yaml

ROOT = Path(__file__).resolve().parents[1]
COLORS = [(0, 0, 255), (0, 165, 255), (255, 0, 255), (255, 255, 0)]


def zones_yaml(zones: list[dict]) -> str:
    """The `zones:` list in the format cameras.yaml expects."""
    lines = ["    zones:"]
    for z in zones:
        lines.append(f"      - zone_id: {z['zone_id']}")
        lines.append(f"        type: {z['type']}")
        lines.append(f'        name: "{z["name"]}"')
        lines.append("        polygon: [" + ", ".join(f"[{x}, {y}]" for x, y in z["polygon"]) + "]")
    return "\n".join(lines) + "\n"


def coverage(polygon: list[list[int]], width: int, height: int) -> float:
    return cv2.contourArea(np.array(polygon, dtype=np.float32)) / float(width * height)


def grab_frame(source: str, width: int, height: int) -> np.ndarray:
    path = Path(source)
    if path.suffix.lower() in {".jpg", ".jpeg", ".png", ".bmp"}:
        frame = cv2.imread(str(path))
    else:
        cap = cv2.VideoCapture(int(source) if source.isdigit() else source)
        frame = None
        for _ in range(15):  # let webcams adjust exposure
            ok, img = cap.read()
            if ok:
                frame = img
        cap.release()
    if frame is None:
        raise SystemExit(f"could not read a frame from the camera source (is it connected / in use?)")
    return cv2.resize(frame, (width, height))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--camera", default="CAM-01")
    parser.add_argument("--source", default=None, help="override the camera source (index, URL, video or image)")
    parser.add_argument("--type", default="restricted", help="zone type for new zones (restricted, ppe_required, ...)")
    args = parser.parse_args()

    cameras = yaml.safe_load((ROOT / "config/cameras.yaml").read_text(encoding="utf-8"))
    perception = yaml.safe_load((ROOT / "config/thresholds.yaml").read_text(encoding="utf-8"))["perception"]
    cam = next((c for c in cameras["cameras"] if c["id"] == args.camera), None)
    if cam is None:
        raise SystemExit(f"camera '{args.camera}' not in config/cameras.yaml")
    width, height = perception["process_width"], perception["process_height"]
    frame = grab_frame(str(args.source if args.source is not None else cam["source"]), width, height)

    zones: list[dict] = []
    current: list[list[int]] = []
    window = f"Draw zones - {args.camera}"

    def finish():
        if len(current) >= 3:
            n = len(zones) + 1
            zones.append({"zone_id": f"z{n}", "type": args.type, "name": f"Zone {n}", "polygon": list(current)})
        current.clear()

    def on_mouse(event, x, y, *_):
        if event == cv2.EVENT_LBUTTONDOWN:
            current.append([int(x), int(y)])
        elif event == cv2.EVENT_RBUTTONDOWN:
            finish()

    cv2.namedWindow(window)
    cv2.setMouseCallback(window, on_mouse)
    while True:
        view = frame.copy()
        for i, z in enumerate(zones):
            pts = np.array(z["polygon"], np.int32)
            cv2.polylines(view, [pts], True, COLORS[i % len(COLORS)], 2)
            cv2.putText(view, z["zone_id"], tuple(pts[0]), cv2.FONT_HERSHEY_SIMPLEX, 0.6, COLORS[i % len(COLORS)], 2)
        if current:
            cv2.polylines(view, [np.array(current, np.int32)], False, (0, 255, 0), 2)
            for p in current:
                cv2.circle(view, tuple(p), 3, (0, 255, 0), -1)
        cv2.putText(view, "click points | right-click/Enter: finish | u undo | d delete | s save | q quit",
                    (8, height - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)
        cv2.imshow(window, view)
        key = cv2.waitKey(30) & 0xFF
        if key in (13, 10):
            finish()
        elif key == ord("u") and current:
            current.pop()
        elif key == ord("d") and zones:
            zones.pop()
        elif key in (ord("q"), 27):
            cv2.destroyAllWindows()
            print("quit without saving")
            return 0
        elif key == ord("s"):
            finish()
            break
    cv2.destroyAllWindows()

    if not zones:
        print("no zones drawn; nothing saved")
        return 0
    for z in zones:
        share = coverage(z["polygon"], width, height)
        if share >= 0.25:
            print(f"warning: {z['zone_id']} covers {share:.0%} of the view; people working normally inside it will raise alerts")
    text = zones_yaml(zones)
    out = ROOT / "config" / f"zones_{args.camera}.yaml"
    out.write_text(text, encoding="utf-8")
    print(text)
    print(f"saved to {out.relative_to(ROOT)}. Paste it over the `zones:` list of {args.camera} in config/cameras.yaml,")
    print("then rename the zones (name:) to what staff call those areas, e.g. \"Panel room\".")
    return 0


if __name__ == "__main__":
    sys.exit(main())
