"""One camera's perception pipeline, independent of where its frames come from.

main.run() drives one pipeline (webcam, video file, demo playlist, one DVR
channel); multi_camera.run_all() drives one per DVR channel on a shared
inference loop. Heavy models are shared between cameras (shared_models.py);
everything with history (tracker, temporal buffer, rule state, confirmation,
de-duplication, evidence buffer, per-detector windows) belongs to one camera.
"""
from __future__ import annotations

import os
import time
from collections import Counter, defaultdict
from contextlib import contextmanager
from typing import Callable, Optional

import cv2

from confirmation.event_confirmation import EventConfirmation
from confirmation.incident_dedup import IncidentDeduper
from evidence.clip_extractor import EvidenceBuffer
from ingestion.zones import PERSON_EVENTS, ZoneMask, is_grayscale
from reporting.description_generator import is_review_fight
from severity.severity_rules import compute_severity
from temporal.fire_smoke_recognition import FireSmokeDetector
from temporal.rgb_action_recognition import RgbFightDetector
from temporal.rule_engine import RuleEngine
from temporal.temporal_buffer import TemporalBuffer
from tracking.byte_tracker import ByteTracker

# Sequence models (fight R3D-18, fall GRU) were trained on ~10 fps clips
SEQUENCE_MODEL_MIN_FPS = 8.0


def checkpoint_problem(path: str | None) -> str | None:
    """Why a model file can't be loaded, in words an operator can act on."""

    if not path or not os.path.exists(path):
        return f"checkpoint '{path}' not found"
    if os.path.getsize(path) < 1024:
        with open(path, "rb") as handle:
            if handle.read(64).startswith(b"version https://git-lfs"):
                return (f"checkpoint '{path}' is a Git LFS pointer, not the model. "
                        f"Run: git lfs install && git lfs pull")
    return None


def start_optional(camera_id: str, name: str, factory, checkpoint: str | None = None):
    """Build an optional detector. A missing or broken model disables only that
    detector; the camera and every other detector keep running."""

    problem = checkpoint_problem(checkpoint) if checkpoint is not None else None
    if problem is None:
        try:
            return factory()
        except Exception as exc:  # noqa: BLE001 - any load failure disables just this detector
            problem = f"{type(exc).__name__}: {exc}"
    print(f"[{camera_id}] WARNING {name} detection disabled -- {problem}")
    return None


def redirect_output(path: str, output_dir: str) -> str:
    """Move a configured `output/...` path under --output-dir."""

    norm = path.replace("\\", "/")
    if output_dir == "output" or not (norm == "output" or norm.startswith("output/")):
        return path
    return os.path.join(output_dir, norm[len("output/"):]) if norm != "output" else output_dir


class StageTimer:
    """Per-stage wall-clock timing of the processing loop (for --stats-json)."""

    def __init__(self):
        self.total_ms = defaultdict(float)
        self.calls = Counter()

    @contextmanager
    def stage(self, name: str):
        start = time.perf_counter()
        try:
            yield
        finally:
            self.add(name, (time.perf_counter() - start) * 1000.0)

    def add(self, name: str, ms: float):
        self.total_ms[name] += ms
        self.calls[name] += 1

    def summary(self, cycles: int) -> dict:
        return {
            name: {
                "mean_ms_per_call": round(self.total_ms[name] / self.calls[name], 2),
                "mean_ms_per_cycle": round(self.total_ms[name] / max(cycles, 1), 2),
                "calls": self.calls[name],
            }
            for name in self.total_ms
        }


def deep_merge(base: dict, override: dict) -> dict:
    """thresholds.yaml with a camera's overrides on top (nested keys merged)."""
    out = dict(base)
    for key, value in (override or {}).items():
        out[key] = deep_merge(out[key], value) if isinstance(value, dict) and isinstance(out.get(key), dict) else value
    return out


def camera_thresholds(thresholds_cfg: dict, cam_cfg: dict) -> dict:
    """Per-camera `thresholds:` from cameras.yaml, plus the crowd_min_people shorthand."""
    merged = deep_merge(thresholds_cfg, cam_cfg.get("thresholds") or {})
    if cam_cfg.get("crowd_min_people") is not None:
        merged = deep_merge(merged, {"rules": {"crowd": {"person_count_threshold": int(cam_cfg["crowd_min_people"])}}})
    return merged


def section_configs(thresholds_cfg: dict, output_dir: str, demo: bool) -> dict:
    """The thresholds.yaml sections with output paths moved under output_dir."""

    evidence_cfg = dict(thresholds_cfg["evidence"])
    evidence_cfg["output_dir"] = redirect_output(evidence_cfg["output_dir"], output_dir)
    anomaly_cfg = dict(thresholds_cfg.get("scene_anomaly", {}))
    if anomaly_cfg.get("calibration"):
        anomaly_cfg["calibration"] = dict(anomaly_cfg["calibration"])
        anomaly_cfg["calibration"]["dir"] = redirect_output(
            anomaly_cfg["calibration"].get("dir", "output/calibration"), output_dir)
        if demo:
            # demo clips must never become the real camera's notion of "normal"
            anomaly_cfg["calibration"]["dir"] = os.path.join(anomaly_cfg["calibration"]["dir"], "demo")
    fight_cfg = dict(thresholds_cfg["fight_detection"])
    if fight_cfg.get("rgb"):
        fight_cfg["rgb"] = dict(fight_cfg["rgb"])
        fight_cfg["rgb"]["explain_dir"] = redirect_output(
            fight_cfg["rgb"].get("explain_dir", "output/evidence/gradcam"), output_dir)
    return {
        "evidence": evidence_cfg,
        "anomaly": anomaly_cfg,
        "fight": fight_cfg,
        "fire_smoke": thresholds_cfg.get("fire_smoke_detection", {}),
        "fall": thresholds_cfg.get("fall_detection", {}),
    }


class CameraPipeline:
    """Detection -> tracking -> rules/models -> confirmation -> incidents for one camera."""

    def __init__(
        self,
        camera_id: str,
        cam_cfg: dict,
        thresholds_cfg: dict,
        detector,
        reporter,
        *,
        output_dir: str = "output",
        only_events: set[str] | None = None,
        demo: bool = False,
        fps: Optional[float] = None,
        on_incident: Optional[Callable[..., None]] = None,
    ):
        self.camera_id = camera_id
        self.cam_cfg = cam_cfg
        # This camera's thresholds: thresholds.yaml + its overrides in cameras.yaml
        thresholds_cfg = camera_thresholds(thresholds_cfg, cam_cfg)
        self.thresholds_cfg = thresholds_cfg
        self.detector = detector
        self.reporter = reporter
        self.on_incident = on_incident
        perception_cfg = thresholds_cfg["perception"]
        self.fps = float(fps or perception_cfg["detection_fps"])
        self.proc_w, self.proc_h = perception_cfg["process_width"], perception_cfg["process_height"]
        # Areas to look at / ignore, and what fire/smoke does at night
        self.zones = ZoneMask(cam_cfg, self.proc_w, self.proc_h)
        self.night = False
        self.tracking_cfg = thresholds_cfg["tracking"]

        # Events this camera runs: --only-events on top of the camera's rules
        rules = set(cam_cfg.get("rules") or ["crowd", "fall", "fight", "fire_smoke", "anomaly"])
        self.events = rules if only_events is None else rules & set(only_events)
        cfgs = section_configs(thresholds_cfg, output_dir, demo)
        fight_cfg, fire_smoke_cfg, fall_cfg, anomaly_cfg = cfgs["fight"], cfgs["fire_smoke"], cfgs["fall"], cfgs["anomaly"]

        self.tracker, self.buffer, self.rule_engine = self.new_scene_state()

        self.fight_detector = None
        if fight_cfg.get("enabled", True) and "fight" in self.events:
            self.fight_detector = start_optional(
                camera_id, "fight", lambda: RgbFightDetector(camera_id, fight_cfg),
                checkpoint=fight_cfg["rgb"]["checkpoint"])

        self.fire_smoke_detector = None
        if fire_smoke_cfg.get("enabled", False) and "fire_smoke" in self.events:
            self.fire_smoke_detector = start_optional(
                camera_id, "fire/smoke", lambda: FireSmokeDetector(camera_id, fire_smoke_cfg),
                checkpoint=fire_smoke_cfg.get("checkpoint"))

        # Learned fall detection (replaces the bounding-box aspect-ratio rule). Modes:
        #   gru     - pose-sequence temporal CNN + BiGRU (fall_gru/, temporal/fall_gru_recognition.py)
        #   model   - pose features + Random Forest (fall_rf/, temporal/pose_fall_recognition.py)
        #   physics - training-free biomechanical score (fall_rf/features.py)
        fall_mode = fall_cfg.get("mode", "gru")
        self.fall_detector = None
        if fall_cfg.get("enabled", False) and fall_mode != "bbox_rule" and "fall" in self.events:
            gru_checkpoint = fall_cfg.get("gru_checkpoint", "models/fall_gru_v1.pt")
            if fall_mode == "gru" and os.path.exists(gru_checkpoint):
                def build_gru_fall():
                    from temporal.fall_gru_recognition import GruFallDetector
                    return GruFallDetector(
                        camera_id, {**fall_cfg, **(fall_cfg.get("gru") or {}), "checkpoint": gru_checkpoint}
                    )
                self.fall_detector = start_optional(camera_id, "fall (GRU)", build_gru_fall)
            if self.fall_detector is None:
                if fall_mode == "gru":
                    print(f"[{camera_id}] GRU fall model unavailable ('{gru_checkpoint}') -> Random Forest / physics")

                def build_pose_fall():
                    from temporal.pose_fall_recognition import PoseFallDetector
                    return PoseFallDetector(
                        camera_id, {**fall_cfg, "mode": "model" if fall_mode == "gru" else fall_mode})
                self.fall_detector = start_optional(camera_id, "fall", build_pose_fall)

        # Unsupervised scene-anomaly autoencoder (catches unlabelled abnormal events)
        self.anomaly_detector = None
        if anomaly_cfg.get("enabled", False) and "anomaly" in self.events:
            if os.path.exists(anomaly_cfg.get("checkpoint", "")):
                def build_anomaly():
                    from temporal.scene_anomaly import SceneAnomalyDetector
                    return SceneAnomalyDetector(camera_id, anomaly_cfg, fps=self.fps)
                self.anomaly_detector = start_optional(camera_id, "scene-anomaly", build_anomaly)
            else:
                print(f"[{camera_id}] scene-anomaly checkpoint not found -- anomaly detection disabled. "
                      f"Train one with: python -m anomaly.train_autoencoder --normal <folder>")

        if self.fps < SEQUENCE_MODEL_MIN_FPS and (self.fight_detector or self.fall_detector):
            print(f"[{camera_id}] NOTE fight/fall models were trained on ~10 fps clips; this camera runs at "
                  f"{self.fps:g} fps, so they will be less accurate here")

        self.confirmation = EventConfirmation(thresholds_cfg["confirmation"])
        evidence_cfg = cfgs["evidence"]
        self.evidence_buffer = EvidenceBuffer(
            output_dir=evidence_cfg["output_dir"],
            raw_buffer_window_seconds=evidence_cfg["raw_buffer_window_seconds"],
            before_seconds=evidence_cfg["before_seconds"],
            after_seconds=evidence_cfg["after_seconds"],
            keyframe_count=evidence_cfg["keyframe_count"],
            clip_fps=evidence_cfg["clip_fps"],
        )
        dedup_cfg = dict(thresholds_cfg.get("incident_dedup") or {})
        if "incident_dedup_seconds" in fire_smoke_cfg:
            dedup_cfg["per_event_seconds"] = {
                "fire_smoke": fire_smoke_cfg["incident_dedup_seconds"],
                **(dedup_cfg.get("per_event_seconds") or {}),
            }
        self.deduper = IncidentDeduper(dedup_cfg)
        self.timer = StageTimer()
        self.incident_counts: Counter = Counter()
        self.frames_processed = 0
        self.last_detection: Optional[dict] = None  # for the camera heartbeat

    def new_scene_state(self):
        return (
            ByteTracker(
                track_activation_threshold=self.tracking_cfg["track_activation_threshold"],
                lost_track_buffer=self.tracking_cfg["lost_track_buffer"],
                minimum_matching_threshold=self.tracking_cfg["minimum_matching_threshold"],
                frame_rate=self.fps,
            ),
            TemporalBuffer(window_seconds=self.thresholds_cfg["temporal_buffer"]["window_seconds"]),
            RuleEngine(self.cam_cfg, self.thresholds_cfg),
        )

    def reset_scene(self) -> None:
        """A new clip (demo) or a reconnect: tracks from before must not carry over."""
        self.tracker, self.buffer, self.rule_engine = self.new_scene_state()

    def process(self, sample):
        """One cycle on one frame. Returns (processing-size frame, tracked detections)."""

        cycle_start = time.perf_counter()
        camera_id, timer, detector = self.camera_id, self.timer, self.detector
        full = cv2.resize(sample.frame, (self.proc_w, self.proc_h))
        # feed the evidence buffer with the *original* full-resolution frame,
        # not the downscaled one used for inference (design doc section 8)
        self.evidence_buffer.add_frame(sample.frame, timestamp=sample.timestamp)
        night = is_grayscale(full)
        if night != self.night:
            self.night = night
            print(f"[{camera_id}] picture is {'black-and-white (night / infrared)' if night else 'in colour again'}")
        # outside the camera's area / inside ignore zones is greyed out for the models
        frame = self.zones.apply(full)

        with timer.stage("yolo_detect"):
            detections = detector.detect(frame)
        with timer.stage("bytetrack"):
            tracked = self.tracker.update(detections)

        for i in range(len(tracked)):
            bbox = tracked.xyxy[i]
            track_id = int(tracked.tracker_id[i]) if tracked.tracker_id is not None else -1
            class_id = int(tracked.class_id[i])
            confidence = float(tracked.confidence[i]) if tracked.confidence is not None else 0.0
            class_name = detector.class_name(class_id)
            if track_id >= 0:
                self.buffer.update(track_id, class_name, bbox, confidence)

        self.buffer.evict_stale()

        with timer.stage("rule_engine"):
            candidates = self.rule_engine.evaluate(self.buffer)
        candidates = [c for c in candidates if c.event_type in self.events]
        # fight detection is the expensive, gated path -- the video model only
        # runs when the motion-of-interest gate finds a pair worth checking
        # (see temporal/motion_gate.py and rgb_action_recognition.py)
        if self.fight_detector is not None:
            with timer.stage("fight"):
                candidates += self.fight_detector.evaluate(self.buffer, frame)
        if self.fire_smoke_detector is not None:
            with timer.stage("fire_smoke"):
                people_now = [t.states[-1].bbox for t in self.buffer.active_tracks_by_class("person", 0.5)]
                fire_frame = self.zones.apply(full, "fire_smoke") if self.zones.active else frame
                candidates += self.fire_smoke_detector.evaluate(fire_frame, person_boxes=people_now)
        if self.fall_detector is not None:
            # the learned pose model supersedes the bbox aspect-ratio fall rule
            candidates = [c for c in candidates if c.event_type != "fall"]
            with timer.stage("fall"):
                candidates += self.fall_detector.evaluate(self.buffer, frame)
        if self.anomaly_detector is not None:
            with timer.stage("anomaly"):
                candidates += self.anomaly_detector.evaluate(
                    self.zones.apply(full, "anomaly") if self.zones.active else frame)
        candidates = self._zone_filter(self.zones.night_filter(candidates, self.night))
        self.deduper.touch(candidates)
        confirmed_events = self.confirmation.update(candidates)

        for event in confirmed_events:
            self._handle_event(event)

        # flush any "after" clips whose post-capture window has completed
        ready_after_clips = self.evidence_buffer.flush_ready_post_clips()
        for incident_id, clip_after_path in ready_after_clips.items():
            self.reporter.update_evidence(incident_id, {"clip_after": clip_after_path})
            print(f"[{camera_id}] after-clip ready for {incident_id}")

        self.frames_processed += 1
        timer.add("cycle_total", (time.perf_counter() - cycle_start) * 1000.0)
        return frame, tracked

    def _zone_filter(self, candidates: list) -> list:
        """Drop crowd / fall / fight where the person stands in a zone ignored for that check."""
        if not self.zones.ignore:
            return candidates
        kept = []
        for c in candidates:
            if c.event_type in PERSON_EVENTS and c.track_ids:
                track = self.buffer.get(c.track_ids[0])
                if track is not None and track.states:
                    x1, y1, x2, y2 = track.states[-1].bbox
                    foot = ((x1 + x2) / 2 / self.proc_w, y2 / self.proc_h)
                    if self.zones.ignored_at(c.event_type, *foot):
                        continue
            kept.append(c)
        return kept

    def _handle_event(self, event) -> None:
        camera_id, reporter, deduper = self.camera_id, self.reporter, self.deduper
        severity = compute_severity(event.event_type, event, self.thresholds_cfg["severity"])
        # A probable crowd is an operator-facing signal, not a separate
        # persisted incident; persist only once confirmed. A fight is
        # PROBABLE when the interaction check (review mode) did not see
        # an interaction or the score is below the alarm threshold: it
        # is reported for operator review.
        review_fight = (event.event_type == "fight"
                        and is_review_fight(event.candidate.detail))
        if event.event_type in ("fight", "crowd") and event.tier == "PROBABLE" and not review_fight:
            print(
                f"[{camera_id}] PROBABLE {event.event_type} candidate "
                f"severity={severity} conf={event.confidence:.2f} -- awaiting confirmation"
            )
            return
        if event.tier not in ("CONFIRMED", "PROBABLE"):
            print(f"[{camera_id}] low-confidence signal: {event.event_type} track={event.candidate.track_ids}")
            return
        # One ongoing event = one incident. Repeats while it is still
        # active update the existing incident (escalation) or are
        # suppressed; they never create duplicate incidents/evidence.
        action, existing_id = deduper.check(event, severity)
        if action == "escalate":
            detail = event.candidate.detail
            reporter.update_incident(existing_id, {
                "confidence_tier": event.tier,
                "confidence_score": round(event.confidence, 2),
                "severity": severity,
                "detail": dict(detail),
                "review_status": "pending",
                "escalation_reason": (
                    f"person still down {detail['down_seconds']:.0f}s after the fall"
                    if detail.get("serious")
                    else f"{event.event_type} re-detected ({event.tier}, "
                         f"confidence {event.confidence:.0%})"
                ),
            })
            print(
                f"[{camera_id}] {event.tier} {event.event_type} escalation "
                f"severity={severity} conf={event.confidence:.2f} "
                f"-> {existing_id} (updated existing incident)"
            )
            return
        if action == "repeat":
            # Same event on this camera within the cooldown: one incident with a count
            reporter.repeat_incident(existing_id)
            keyframes = self.evidence_buffer.save_keyframes(existing_id, event.camera_id)
            self.last_detection = {"incident_id": existing_id, "event_type": event.event_type, "at": time.time()}
            if self.on_incident is not None:
                self.on_incident(existing_id, event.event_type, report=reporter.remembered(existing_id) or {},
                                 keyframes=keyframes, detail=dict(event.candidate.detail or {}), repeat=True)
            print(f"[{camera_id}] {event.event_type} seen again -> {existing_id} (counted, no new incident)")
            return
        if action == "suppress":
            print(
                f"[{camera_id}] {event.event_type} continuation "
                f"conf={event.confidence:.2f} -> {existing_id} (duplicate suppressed)"
            )
            return
        # incident_id isn't known until build_and_save assigns one, but
        # the evidence extraction needs to happen right away (before the
        # rolling buffer ages the relevant frames out) -- so build the
        # report first with a placeholder, then capture evidence against
        # its real incident_id, then attach the paths.
        report = reporter.build_and_save(event, severity)
        incident_id = report["incident_id"]
        self.incident_counts[(event.event_type, event.tier)] += 1
        deduper.register(event, severity, incident_id)
        self.last_detection = {"incident_id": incident_id, "event_type": event.event_type,
                               "at": time.time()}

        clip_before = self.evidence_buffer.capture_before_clip(incident_id, event.camera_id)
        keyframes = self.evidence_buffer.save_keyframes(incident_id, event.camera_id)
        self.evidence_buffer.start_post_capture(incident_id, event.camera_id)
        if clip_before or keyframes:
            reporter.update_evidence(incident_id, {"clip_before": clip_before, "keyframes": keyframes})
        if self.on_incident is not None:
            self.on_incident(incident_id, event.event_type, report=report, keyframes=keyframes,
                             detail=dict(event.candidate.detail or {}))

        print(
            f"[{camera_id}] {event.tier} {event.event_type} "
            f"severity={severity} conf={event.confidence:.2f} "
            f"-> {incident_id} (before-clip: {'yes' if clip_before else 'no'})"
        )

    def diagnostics(self) -> dict:
        out = {}
        for name, det in (("fight", self.fight_detector), ("fire_smoke", self.fire_smoke_detector),
                          ("fall", self.fall_detector), ("anomaly", self.anomaly_detector)):
            if det is not None:
                out[name] = det.diagnostics()
        return out
