"""Gated live RGB fight detection using the trained R3D-18 classifier."""
from __future__ import annotations

import bisect
import time
from collections import deque

import cv2

from rgb_fight_model.infer import RgbFightClassifier
from temporal.interaction import InteractionValidator

INTERACTION_MODES = ("veto", "review", "off")
from temporal.motion_gate import MotionOfInterestGate
from temporal.rule_engine import EventCandidate
from temporal.temporal_buffer import TemporalBuffer


def sample_by_time(times, frames, start: float, fps: float, count: int):
    """Pick `count` frames nearest to start, start + 1/fps, ... (times ascending)."""
    picked = []
    for i in range(count):
        target = start + i / fps
        j = bisect.bisect_left(times, target)
        if j == len(times) or (j > 0 and target - times[j - 1] <= times[j] - target):
            j -= 1
        picked.append(frames[max(j, 0)])
    return picked


class RgbFightDetector:
    def __init__(self, camera_id: str, cfg: dict):
        self.camera_id = camera_id
        self.enabled = bool(cfg.get("enabled", True))
        rgb_cfg = cfg["rgb"]
        self.classifier = RgbFightClassifier(rgb_cfg["checkpoint"])
        self.clip_frames = int(rgb_cfg.get("clip_frames", self.classifier.clip_frames))
        self.evaluation_stride = int(rgb_cfg.get("evaluation_stride_frames", 4))
        self.probable_threshold = float(rgb_cfg.get("probable_threshold", 0.88))
        self.confirmed_threshold = float(rgb_cfg.get("confirmed_threshold", 0.92))
        self.persistence_window = int(rgb_cfg.get("persistence_window", 3))
        self.required_confirmed = int(rgb_cfg.get("required_confirmed", 2))
        self.confirmed_history = deque(maxlen=self.persistence_window)
        self.score_history = deque(maxlen=self.persistence_window)
        # Track-level evidence (temporal/interaction.py): two distinct people,
        # close, agitated. mode decides what a failed check does:
        #   review (default) - still report the fight, but as PROBABLE for an
        #                      operator to check (the ablation showed the veto
        #                      cost fight recall without a significant drop in
        #                      false alarms; docs/RESULTS.md section 4)
        #   veto             - drop the fight (the earlier behaviour)
        #   off              - do not run the check
        interaction_cfg = cfg.get("interaction") or {}
        self.interaction = InteractionValidator(interaction_cfg)
        mode = str(interaction_cfg.get("mode", "review")).lower()
        if not self.interaction.enabled:
            mode = "off"
        if mode not in INTERACTION_MODES:
            raise ValueError(f"fight_detection.interaction.mode must be one of {INTERACTION_MODES}, got {mode!r}")
        self.interaction_mode = mode
        self._last_rejection_log = -1e18
        # Grad-CAM heatmaps saved with each confirmed fight (explain/gradcam.py)
        self.explain = bool(rgb_cfg.get("explain", True))
        self.explain_dir = rgb_cfg.get("explain_dir", "output/evidence/gradcam")
        self.gate_hold_seconds = float(cfg.get("gate_hold_seconds", 1.5))
        self.gate = MotionOfInterestGate(
            proximity_px=cfg["gate"]["proximity_px"],
            velocity_threshold_px_s=cfg["gate"]["velocity_threshold_px_s"],
            active_track_seconds=self.interaction.active_track_seconds,
            duplicate_iou=self.interaction.duplicate_iou,
        )
        # Checkpoints trained with real-time sampling (clip_fps) get clips
        # rebuilt from timestamps, so a live clip spans the same duration the
        # model saw in training even when processing speed differs. Legacy
        # checkpoints keep using the last `clip_frames` processed frames.
        clip_fps = rgb_cfg.get("clip_fps", self.classifier.clip_fps)
        self.clip_fps = float(clip_fps) if clip_fps else None
        self.clip_seconds = (self.clip_frames - 1) / self.clip_fps if self.clip_fps else None
        self.frames = deque(maxlen=self.clip_frames if self.clip_fps is None else 512)
        self.frame_times: deque = deque(maxlen=self.frames.maxlen)
        self.gate_active_until = 0.0
        self.last_track_ids = []
        self.cycles = 0
        self.last_evaluated_cycle = -10**9
        self._stats = {"cycles": 0, "gate_open": 0, "scored": 0,
                       "review_signals": 0, "high_score_windows": 0,
                       "confirmed_candidates": 0, "max_score": 0.0,
                       "rejected_no_interaction": 0, "review_no_interaction": 0}
        print(
            f"[{camera_id}] RGB fight model loaded: {rgb_cfg['checkpoint']} "
            f"probable={self.probable_threshold:.2f} confirmed={self.confirmed_threshold:.2f}"
        )

    def evaluate(self, buffer: TemporalBuffer, frame):
        self.cycles += 1
        self._stats["cycles"] += 1
        if not self.enabled:
            return []
        # Buffer every processed frame. When the cheap gate opens, the clip
        # therefore includes the lead-in immediately before the interaction.
        now = time.time()
        self._buffer_frame(frame, now)
        pairs = self.gate.find_candidate_pairs(buffer)
        if pairs:
            self.gate_active_until = now + self.gate_hold_seconds
            self.last_track_ids = list(pairs[0])
        if not pairs and now > self.gate_active_until:
            return []
        self._stats["gate_open"] += 1
        clip = self._current_clip(now)
        if clip is None:
            return []
        if self.cycles - self.last_evaluated_cycle < self.evaluation_stride:
            return []
        self.last_evaluated_cycle = self.cycles
        score = self.classifier.score_clip(clip, input_bgr=True)
        self._stats["scored"] += 1
        self._stats["max_score"] = max(self._stats["max_score"], score)
        high_score = score >= self.confirmed_threshold
        self.confirmed_history.append(high_score)
        self.score_history.append(score)
        if score < self.probable_threshold:
            return []
        if not high_score:
            self._stats["review_signals"] += 1
            print(
                f"[{self.camera_id}] RGB probable-review fight score={score:.2f} "
                f"track={self.last_track_ids}"
            )
            return []
        self._stats["high_score_windows"] += 1
        confirmed_hits = sum(self.confirmed_history)
        if confirmed_hits < self.required_confirmed:
            print(
                f"[{self.camera_id}] RGB high fight score={score:.2f} -- "
                f"awaiting persistence ({confirmed_hits}/{self.required_confirmed})"
            )
            return []
        # The clip classifier alone can fire on people walking, standing or
        # talking near each other. Without track evidence of an interaction the
        # fight is dropped (veto) or sent for operator review (review).
        if self.interaction_mode == "off":
            interacting, evidence = True, {"reason": "interaction check off"}
        else:
            interacting, evidence = self.interaction.validate(buffer)
        if not interacting and self.interaction_mode == "veto":
            self._stats["rejected_no_interaction"] += 1
            if now - self._last_rejection_log >= 10.0:
                self._last_rejection_log = now
                print(f"[{self.camera_id}] fight rejected despite model score {score:.2f}: "
                      f"{evidence.get('reason')} {evidence}")
            return []
        review = not interacting
        self._stats["review_no_interaction" if review else "confirmed_candidates"] += 1
        # Confidence = mean model score of the high-scoring clips in the
        # persistence window (not the single latest clip).
        high_scores = [s for s, h in zip(self.score_history, self.confirmed_history) if h]
        confidence = sum(high_scores) / len(high_scores)
        track_ids = evidence.get("track_ids") or self.last_track_ids
        print(f"[{self.camera_id}] fight candidate{' for review' if review else ''} "
              f"conf={confidence:.2f} tracks={track_ids} {evidence}")
        heatmaps = self._explain(clip)
        detail = {"mode": "rgb_r3d18", "score": round(score, 3),
                  "clip_frames": self.clip_frames,
                  "interaction": evidence,
                  "confidence_basis": "mean R3D-18 fight probability over high-scoring clips "
                                      "in the persistence window",
                  **({"gradcam_heatmaps": heatmaps} if heatmaps else {})}
        if self.interaction_mode != "off":
            detail["interaction_passed"] = interacting
        if review:
            # The model's 2-of-3 rule fired but the tracks show no interaction:
            # an operator should look before anyone is sent (PROBABLE tier).
            detail["requested_tier"] = "PROBABLE"
            detail["review_reason"] = (
                "the fight model fired, but the camera tracks do not show two people "
                f"close together with agitated motion ({evidence.get('reason')})"
            )
        return [EventCandidate(
            event_type="fight",
            track_ids=list(track_ids),
            camera_id=self.camera_id,
            detail=detail,
            raw_confidence=confidence,
        )]

    def _explain(self, clip) -> list:
        """Save Grad-CAM keyframes for a confirmed fight; never blocks the alert."""
        if not self.explain:
            return []
        try:
            prefix = f"{self.camera_id}_{time.strftime('%Y%m%d_%H%M%S')}"
            _, paths = self.classifier.explain_clip(clip, self.explain_dir, prefix)
            return paths
        except Exception as exc:  # explanation is best-effort
            print(f"[{self.camera_id}] Grad-CAM failed: {type(exc).__name__}: {exc}")
            return []

    def _buffer_frame(self, frame, now: float) -> None:
        if self.clip_fps is None:
            self.frames.append(frame.copy())
            self.frame_times.append(now)
            return
        # Store frames already at the model's input scale (short side 128):
        # a time-based buffer holds more frames, and full-resolution copies
        # would cost hundreds of MB.
        h, w = frame.shape[:2]
        scale = 128.0 / max(min(h, w), 1)
        if scale < 1.0:
            frame = cv2.resize(frame, (max(128, round(w * scale)), max(128, round(h * scale))),
                               interpolation=cv2.INTER_AREA)
        else:
            frame = frame.copy()
        self.frames.append(frame)
        self.frame_times.append(now)
        # Keep only what one clip (plus a little slack) needs
        horizon = now - (self.clip_seconds or 0.0) - 1.0
        while self.frame_times and self.frame_times[0] < horizon:
            self.frame_times.popleft()
            self.frames.popleft()

    def _current_clip(self, now: float):
        """Frames for one model clip, or None if not enough history yet."""
        if self.clip_fps is None:
            return list(self.frames) if len(self.frames) >= self.clip_frames else None
        if not self.frame_times:
            return None
        end = self.frame_times[-1]
        start = end - self.clip_seconds
        # Need history covering (almost) the full clip duration
        if self.frame_times[0] > start + 0.5 / self.clip_fps:
            return None
        return sample_by_time(list(self.frame_times), list(self.frames),
                              start, self.clip_fps, self.clip_frames)

    def diagnostics(self):
        return dict(self._stats, buffered_frames=len(self.frames),
                    interaction_mode=self.interaction_mode,
                    persistence_hits=sum(self.confirmed_history),
                    persistence_window=self.persistence_window,
                    probable_threshold=self.probable_threshold,
                    confirmed_threshold=self.confirmed_threshold)
