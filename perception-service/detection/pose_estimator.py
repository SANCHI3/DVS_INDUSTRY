"""
Thin wrapper around Ultralytics YOLOv8-Pose. Deliberately kept separate
from detection/yolo_detector.py: pose estimation is more expensive than
plain object detection, so it should only be invoked when something has
already gated it as "worth checking closely" (see
temporal/fall_gru_recognition.py) -- never run on every frame.

COCO-pose keypoint order (17 points), for reference when building features:
0 nose, 1 left_eye, 2 right_eye, 3 left_ear, 4 right_ear,
5 left_shoulder, 6 right_shoulder, 7 left_elbow, 8 right_elbow,
9 left_wrist, 10 right_wrist, 11 left_hip, 12 right_hip,
13 left_knee, 14 right_knee, 15 left_ankle, 16 right_ankle
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Tuple

import numpy as np
from ultralytics import YOLO

NUM_KEYPOINTS = 17


@dataclass
class PersonPose:
    bbox: Tuple[float, float, float, float]  # x1, y1, x2, y2
    keypoints: np.ndarray  # shape (17, 3): x, y, confidence
    confidence: float      # overall person detection confidence


class PoseEstimator:
    def __init__(self, model_path: str = "yolov8n-pose.pt", confidence_threshold: float = 0.3):
        self.model = YOLO(model_path)
        self.confidence_threshold = confidence_threshold

    def estimate(self, frame: np.ndarray) -> List[PersonPose]:
        results = self.model(frame, verbose=False)[0]
        out: List[PersonPose] = []

        if results.keypoints is None or results.boxes is None:
            return out

        boxes = results.boxes
        kpts = results.keypoints

        for i in range(len(boxes)):
            conf = float(boxes.conf[i]) if boxes.conf is not None else 0.0
            if conf < self.confidence_threshold:
                continue
            bbox = tuple(boxes.xyxy[i].tolist())
            kp_xy = kpts.xy[i].cpu().numpy() if hasattr(kpts.xy[i], "cpu") else np.array(kpts.xy[i])
            kp_conf = (
                kpts.conf[i].cpu().numpy() if (kpts.conf is not None and hasattr(kpts.conf[i], "cpu"))
                else (np.array(kpts.conf[i]) if kpts.conf is not None else np.ones(NUM_KEYPOINTS))
            )
            keypoints = np.concatenate([kp_xy, kp_conf.reshape(-1, 1)], axis=1)  # (17, 3)
            out.append(PersonPose(bbox=bbox, keypoints=keypoints, confidence=conf))

        return out


def _iou(box_a: Tuple[float, float, float, float], box_b: Tuple[float, float, float, float]) -> float:
    ax1, ay1, ax2, ay2 = box_a
    bx1, by1, bx2, by2 = box_b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def match_pose_to_bbox(poses: List[PersonPose], bbox: Tuple[float, float, float, float]) -> Optional[PersonPose]:
    """Find the pose detection whose bbox best overlaps a given tracked
    person's bbox (associates a track_id, which the pose model doesn't
    know about, back to the pose model's own detection)."""
    best, best_iou = None, 0.0
    for pose in poses:
        score = _iou(pose.bbox, bbox)
        if score > best_iou:
            best, best_iou = pose, score
    return best if best_iou > 0.1 else None
