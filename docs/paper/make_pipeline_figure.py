"""Draw the verification-pipeline figure for the paper (docs/paper/figures/pipeline.{png,pdf}).

    python docs/paper/make_pipeline_figure.py

Boxes describe stages that exist in perception-service/main.py and
config/thresholds.yaml; the four verification stages evaluated in the
ablation are highlighted.
"""
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import FancyBboxPatch  # noqa: E402

OUT = Path(__file__).resolve().parent / "figures"
INK, INK2, LINE = "#0b0b0b", "#52514e", "#8a8984"
PLAIN, VERIFY, VERIFY_EDGE = "#f1f0ec", "#fde3d6", "#eb6834"


def box(ax, x, y, w, h, text, verify=False, size=6.2):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0,rounding_size=0.015",
                                facecolor=VERIFY if verify else PLAIN,
                                edgecolor=VERIFY_EDGE if verify else LINE, linewidth=1.1 if verify else 0.7))
    ax.text(x + w / 2, y + h / 2, text, ha="center", va="center", fontsize=size, color=INK, linespacing=1.15)


def arrow(ax, x1, y1, x2, y2):
    ax.annotate("", xy=(x2, y2), xytext=(x1, y1),
                arrowprops={"arrowstyle": "-|>", "color": INK2, "linewidth": 0.8, "shrinkA": 0, "shrinkB": 0})


ROWS = [  # (y, detector, persistence rule, verification stage or None)
    (0.78, "R3D-18 clip\nclassifier", "2 of 3 clips\n≥ 0.55",
     "Track interaction:\n2 distinct people,\nclose ≥ 1 s,\nagitation ≥ 0.1"),
    (0.55, "YOLOv8n fire/smoke\n+ learned verifier", "3 of 5 frames\n≥ 0.50",
     "Region dynamics:\nin-box change\n≥ 2× scene median"),
    (0.32, "Pose + BiGRU\nfall model", "2 of 3 evals\n≥ 0.24", None),
    (0.09, "Optical-flow\nautoencoder", "2 of 3 windows\n> threshold",
     "Per-camera\nthreshold calibration\n(p99 of 300 s,\nno alerts meanwhile)"),
]


def main():
    fig, ax = plt.subplots(figsize=(7.16, 3.0), dpi=300)
    ax.set_xlim(-0.01, 1.01)
    ax.set_ylim(0, 1.03)
    ax.axis("off")

    box(ax, 0.00, 0.42, 0.08, 0.17, "Camera /\nvideo\n10 fps")
    box(ax, 0.10, 0.42, 0.12, 0.17, "YOLOv8n\n+ ByteTrack\n→ track buffer")
    arrow(ax, 0.08, 0.505, 0.10, 0.505)
    for y, det, pers, ver in ROWS:
        mid = y + 0.085
        box(ax, 0.26, y, 0.17, 0.17, det)
        box(ax, 0.47, y, 0.13, 0.17, pers, verify=True)
        arrow(ax, 0.22, 0.505, 0.26, mid)
        arrow(ax, 0.43, mid, 0.47, mid)
        if ver:
            box(ax, 0.64, y, 0.17, 0.17, ver, verify=True, size=5.8)
            arrow(ax, 0.60, mid, 0.64, mid)
            arrow(ax, 0.81, mid, 0.85, 0.505)
        else:
            arrow(ax, 0.60, mid, 0.85, 0.505)
    box(ax, 0.85, 0.335, 0.15, 0.34,
        "Confirmation tiers\n(PROBABLE /\nCONFIRMED)\n+ de-duplication\n↓\ndashboard alert\n+ evidence")
    ax.text(0.535, 0.99, "temporal persistence", ha="center", fontsize=6.5, color=VERIFY_EDGE)
    ax.text(0.725, 0.99, "verification", ha="center", fontsize=6.5, color=VERIFY_EDGE)
    OUT.mkdir(parents=True, exist_ok=True)
    fig.savefig(OUT / "pipeline.png", bbox_inches="tight")
    fig.savefig(OUT / "pipeline.pdf", bbox_inches="tight")
    print("written", OUT / "pipeline.png", OUT / "pipeline.pdf")


if __name__ == "__main__":
    main()
