"""
Perception pipeline entry point.

Wires together: StreamReader -> YoloDetector -> ByteTracker -> TemporalBuffer
-> RuleEngine + learned detectors -> EventConfirmation -> SeverityRules -> IncidentReporter.

Learned detectors (each optional, configured in thresholds.yaml):
  fight        R3D-18 video classifier (or pose-LSTM)      temporal/rgb_action_recognition.py
  fire_smoke   YOLOv8 + colour/flicker verifier             temporal/fire_smoke_recognition.py
  fall         YOLOv8-Pose + GRU (or Random Forest)         temporal/fall_gru_recognition.py, pose_fall_recognition.py
  anomaly      optical-flow autoencoder (unsupervised)      temporal/scene_anomaly.py

Run with a webcam:
    python main.py --camera CAM-01

Run against a video file (useful for testing without real camera hardware
or a live RTSP feed -- just point cameras.yaml's `source` at a file path,
or override with --source):
    python main.py --camera CAM-01 --source /path/to/test_video.mp4 --no-display

The processing loop deliberately runs at a fixed `detection_fps` (from
thresholds.yaml) rather than every captured frame, per the design doc's
real-time performance guidance (section 9/19).
"""
from __future__ import annotations

import argparse
import os
import time

# scikit-learn (learned fire verifier) must load before torch/ultralytics:
# the reverse order trips an OpenMP DLL clash on Windows.
import sklearn  # noqa: F401,E402

import cv2
import supervision as sv
import yaml

from confirmation.event_confirmation import EventConfirmation
from confirmation.incident_dedup import IncidentDeduper
from detection.yolo_detector import YoloDetector
from evidence.clip_extractor import EvidenceBuffer
from ingestion.stream_reader import StreamReader
from reporting.incident_report import IncidentReporter
from severity.severity_rules import compute_severity
from temporal.action_recognition import FightDetector
from temporal.fire_smoke_recognition import FireSmokeDetector
from temporal.rgb_action_recognition import RgbFightDetector
from temporal.rule_engine import RuleEngine
from temporal.temporal_buffer import TemporalBuffer
from tracking.byte_tracker import ByteTracker

TIER_COLOR = {
    "CONFIRMED": (0, 0, 255),      # red (BGR)
    "PROBABLE": (0, 165, 255),     # orange
    "LOW_CONFIDENCE": (0, 255, 255),  # yellow
}


def load_config(config_dir: str = "config"):
    with open(f"{config_dir}/cameras.yaml") as f:
        cameras_cfg = yaml.safe_load(f)
    with open(f"{config_dir}/thresholds.yaml") as f:
        thresholds_cfg = yaml.safe_load(f)
    return cameras_cfg, thresholds_cfg


def find_camera_config(cameras_cfg: dict, camera_id: str) -> dict:
    for cam in cameras_cfg["cameras"]:
        if cam["id"] == camera_id:
            return cam
    raise ValueError(f"camera_id '{camera_id}' not found in cameras.yaml")


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        return max(float(raw), 0.1)
    except ValueError as exc:
        raise ValueError(f"{name} must be a positive number") from exc


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        return max(int(raw), 0)
    except ValueError as exc:
        raise ValueError(f"{name} must be a non-negative integer") from exc


def resolve_camera_runtime(
    camera_id: str,
    source_override: str | None,
    camera_config: dict,
) -> tuple[str, str, str, dict]:
    """Resolve source and camera metadata without exposing source credentials."""

    effective_camera_id = os.getenv("CAMERA_ID", "").strip() or camera_id
    source = (
        os.getenv("CCTV_RTSP_URL", "").strip()
        or source_override
        or camera_config["source"]
    )
    location = os.getenv("CAMERA_LOCATION", "").strip() or camera_config["location"]
    source_kind = "RTSP" if source.lower().startswith("rtsp://") else "local"
    reader_options = {
        "connect_timeout_s": _env_float("CCTV_CONNECT_TIMEOUT_SECONDS", 10.0),
        "read_timeout_s": _env_float("CCTV_READ_TIMEOUT_SECONDS", 10.0),
        "reconnect_delay_s": _env_float("CCTV_RECONNECT_INITIAL_SECONDS", 2.0),
        "reconnect_max_delay_s": _env_float("CCTV_RECONNECT_MAX_SECONDS", 30.0),
        "reconnect_attempts": _env_int("CCTV_RECONNECT_ATTEMPTS", 0),
    }
    return effective_camera_id, source, location, {"source_kind": source_kind, **reader_options}


def run(
    camera_id: str,
    source_override: str | None,
    display: bool,
    max_seconds: float | None,
    only_events: set[str] | None = None,
):
    cameras_cfg, thresholds_cfg = load_config()
    cam_cfg = find_camera_config(cameras_cfg, camera_id)
    camera_id, source, camera_location, reader_options = resolve_camera_runtime(
        camera_id,
        source_override,
        cam_cfg,
    )

    perception_cfg = thresholds_cfg["perception"]
    tracking_cfg = thresholds_cfg["tracking"]

    print(
        f"[{camera_id}] starting pipeline. source={reader_options['source_kind']} "
        f"location={camera_location}"
    )

    reader = StreamReader(
        source=source,
        camera_id=camera_id,
        target_fps=perception_cfg["detection_fps"],
        connect_timeout_s=reader_options["connect_timeout_s"],
        read_timeout_s=reader_options["read_timeout_s"],
        reconnect_delay_s=reader_options["reconnect_delay_s"],
        reconnect_max_delay_s=reader_options["reconnect_max_delay_s"],
        reconnect_attempts=reader_options["reconnect_attempts"],
    ).start()
    detector = YoloDetector(
        model_path=perception_cfg["model_path"],
        confidence_threshold=perception_cfg["confidence_threshold"],
        classes_of_interest=perception_cfg["classes_of_interest"],
    )
    tracker = ByteTracker(
        track_activation_threshold=tracking_cfg["track_activation_threshold"],
        lost_track_buffer=tracking_cfg["lost_track_buffer"],
        minimum_matching_threshold=tracking_cfg["minimum_matching_threshold"],
        frame_rate=perception_cfg["detection_fps"],
    )
    buffer = TemporalBuffer(window_seconds=thresholds_cfg["temporal_buffer"]["window_seconds"])
    rule_engine = RuleEngine(cam_cfg, thresholds_cfg)
    fight_cfg = thresholds_cfg["fight_detection"]
    run_fight = fight_cfg.get("enabled", True) and (
        only_events is None or "fight" in only_events
    )
    fight_detector = None
    if run_fight:
        fight_detector = (
            RgbFightDetector(camera_id, fight_cfg)
            if fight_cfg.get("mode") == "rgb"
            else FightDetector(camera_id, fight_cfg)
        )
    fire_smoke_cfg = thresholds_cfg.get("fire_smoke_detection", {})
    run_fire_smoke = fire_smoke_cfg.get("enabled", False) and (
        only_events is None or "fire_smoke" in only_events
    )
    fire_smoke_detector = (
        FireSmokeDetector(camera_id, fire_smoke_cfg) if run_fire_smoke else None
    )

    # Learned fall detection (replaces the bounding-box aspect-ratio rule). Modes:
    #   gru     - pose-sequence temporal CNN + BiGRU (fall_gru/, temporal/fall_gru_recognition.py)
    #   model   - pose features + Random Forest (fall_rf/, temporal/pose_fall_recognition.py)
    #   physics - training-free biomechanical score (fall_rf/features.py)
    fall_cfg = thresholds_cfg.get("fall_detection", {})
    fall_mode = fall_cfg.get("mode", "gru")
    run_pose_fall = (
        fall_cfg.get("enabled", False)
        and fall_mode != "bbox_rule"
        and (only_events is None or "fall" in only_events)
    )
    fall_detector = None
    if run_pose_fall:
        gru_checkpoint = fall_cfg.get("gru_checkpoint", "models/fall_gru_v1.pt")
        if fall_mode == "gru" and os.path.exists(gru_checkpoint):
            from temporal.fall_gru_recognition import GruFallDetector
            fall_detector = GruFallDetector(
                camera_id, {**fall_cfg, **(fall_cfg.get("gru") or {}), "checkpoint": gru_checkpoint}
            )
        else:
            if fall_mode == "gru":
                print(f"[{camera_id}] GRU fall checkpoint '{gru_checkpoint}' not found -> Random Forest / physics")
            from temporal.pose_fall_recognition import PoseFallDetector
            fall_detector = PoseFallDetector(camera_id, {**fall_cfg, "mode": "model" if fall_mode == "gru" else fall_mode})

    # Unsupervised scene-anomaly autoencoder (catches unlabelled abnormal events)
    anomaly_cfg = thresholds_cfg.get("scene_anomaly", {})
    anomaly_detector = None
    if anomaly_cfg.get("enabled", False) and (only_events is None or "anomaly" in only_events):
        if os.path.exists(anomaly_cfg.get("checkpoint", "")):
            from temporal.scene_anomaly import SceneAnomalyDetector
            anomaly_detector = SceneAnomalyDetector(
                camera_id, anomaly_cfg, fps=perception_cfg["detection_fps"]
            )
        else:
            print(f"[{camera_id}] scene-anomaly checkpoint not found -- anomaly detection disabled. "
                  f"Train one with: python -m anomaly.train_autoencoder --normal <folder>")
    confirmation = EventConfirmation(thresholds_cfg["confirmation"])
    reporter = IncidentReporter(
        output_path="output/incidents.jsonl",
        camera_locations={camera_id: camera_location},
        # Optional local incident API (backend/api.py); unset to disable
        backend_url=os.getenv("LEGACY_INCIDENT_API_URL", "").strip() or None,
        # Dashboard posts and LLM enrichment must never stall frame processing
        background=True,
    )
    evidence_cfg = thresholds_cfg["evidence"]
    evidence_buffer = EvidenceBuffer(
        output_dir=evidence_cfg["output_dir"],
        raw_buffer_window_seconds=evidence_cfg["raw_buffer_window_seconds"],
        before_seconds=evidence_cfg["before_seconds"],
        after_seconds=evidence_cfg["after_seconds"],
        keyframe_count=evidence_cfg["keyframe_count"],
        clip_fps=evidence_cfg["clip_fps"],
    )

    box_annotator = sv.BoxAnnotator()
    label_annotator = sv.LabelAnnotator()

    process_interval = 1.0 / perception_cfg["detection_fps"]
    last_process_time = 0.0
    proc_w, proc_h = perception_cfg["process_width"], perception_cfg["process_height"]

    start_time = time.time()
    frames_processed = 0
    last_seen_frame_index = -1
    dedup_cfg = dict(thresholds_cfg.get("incident_dedup") or {})
    if "incident_dedup_seconds" in fire_smoke_cfg:
        dedup_cfg["per_event_seconds"] = {
            "fire_smoke": fire_smoke_cfg["incident_dedup_seconds"],
            **(dedup_cfg.get("per_event_seconds") or {}),
        }
    deduper = IncidentDeduper(dedup_cfg)

    try:
        while True:
            if max_seconds and (time.time() - start_time) > max_seconds:
                print(f"[{camera_id}] max_seconds reached, stopping")
                break

            now = time.time()
            if now - last_process_time < process_interval:
                time.sleep(0.01)
                continue
            last_process_time = now

            sample = reader.get_latest()
            if sample is None:
                if reader.is_end_of_stream():
                    print(f"[{camera_id}] no frames and stream ended -- stopping")
                    break
                time.sleep(0.05)
                continue

            if reader.is_end_of_stream() and sample.frame_index == last_seen_frame_index:
                # stream ended and we've already processed the last frame it produced
                # (relevant for file sources, which don't keep producing new frames
                # the way a live RTSP source would after a reconnect)
                print(f"[{camera_id}] stream ended and no new frames arriving -- stopping")
                break
            last_seen_frame_index = sample.frame_index

            frame = cv2.resize(sample.frame, (proc_w, proc_h))
            # feed the evidence buffer with the *original* full-resolution frame,
            # not the downscaled one used for inference (design doc section 8)
            evidence_buffer.add_frame(sample.frame, timestamp=sample.timestamp)

            detections = detector.detect(frame)
            tracked = tracker.update(detections)

            for i in range(len(tracked)):
                bbox = tracked.xyxy[i]
                track_id = int(tracked.tracker_id[i]) if tracked.tracker_id is not None else -1
                class_id = int(tracked.class_id[i])
                confidence = float(tracked.confidence[i]) if tracked.confidence is not None else 0.0
                class_name = detector.class_name(class_id)
                if track_id >= 0:
                    buffer.update(track_id, class_name, bbox, confidence)

            buffer.evict_stale()

            candidates = rule_engine.evaluate(buffer)
            if only_events is not None:
                candidates = [c for c in candidates if c.event_type in only_events]
            # fight detection is the expensive, gated path -- only actually runs
            # pose estimation when the motion-of-interest gate finds a pair worth
            # checking (see temporal/motion_gate.py and action_recognition.py)
            if fight_detector is not None:
                candidates += fight_detector.evaluate(buffer, frame)
            if fire_smoke_detector is not None:
                candidates += fire_smoke_detector.evaluate(frame)
            if fall_detector is not None:
                # the learned pose model supersedes the bbox aspect-ratio fall rule
                candidates = [c for c in candidates if c.event_type != "fall"]
                candidates += fall_detector.evaluate(buffer, frame)
            if anomaly_detector is not None:
                candidates += anomaly_detector.evaluate(frame)
            deduper.touch(candidates)
            confirmed_events = confirmation.update(candidates)

            for event in confirmed_events:
                severity = compute_severity(event.event_type, event, thresholds_cfg["severity"])
                # A probable fight is an operator-facing signal, not a separate
                # persisted incident. Persist only after the stricter confirmed
                # policy is met, preventing probable+confirmed duplicate reports.
                if event.event_type in ("fight", "crowd") and event.tier == "PROBABLE":
                    print(
                        f"[{camera_id}] PROBABLE {event.event_type} candidate "
                        f"severity={severity} conf={event.confidence:.2f} -- awaiting confirmation"
                    )
                    continue
                if event.tier in ("CONFIRMED", "PROBABLE"):
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
                        continue
                    if action == "suppress":
                        print(
                            f"[{camera_id}] {event.event_type} continuation "
                            f"conf={event.confidence:.2f} -> {existing_id} (duplicate suppressed)"
                        )
                        continue
                    # incident_id isn't known until build_and_save assigns one, but
                    # the evidence extraction needs to happen right away (before the
                    # rolling buffer ages the relevant frames out) -- so build the
                    # report first with a placeholder, then capture evidence against
                    # its real incident_id, then attach the paths.
                    report = reporter.build_and_save(event, severity)
                    incident_id = report["incident_id"]
                    deduper.register(event, severity, incident_id)

                    clip_before = evidence_buffer.capture_before_clip(incident_id, event.camera_id)
                    keyframes = evidence_buffer.save_keyframes(incident_id, event.camera_id)
                    evidence_buffer.start_post_capture(incident_id, event.camera_id)
                    if clip_before or keyframes:
                        reporter.update_evidence(incident_id, {"clip_before": clip_before, "keyframes": keyframes})

                    print(
                        f"[{camera_id}] {event.tier} {event.event_type} "
                        f"severity={severity} conf={event.confidence:.2f} "
                        f"-> {incident_id} (before-clip: {'yes' if clip_before else 'no'})"
                    )
                else:
                    print(f"[{camera_id}] low-confidence signal: {event.event_type} track={event.candidate.track_ids}")

            # flush any "after" clips whose post-capture window has completed
            ready_after_clips = evidence_buffer.flush_ready_post_clips()
            for incident_id, clip_after_path in ready_after_clips.items():
                reporter.update_evidence(incident_id, {"clip_after": clip_after_path})
                print(f"[{camera_id}] after-clip ready for {incident_id}")

            frames_processed += 1

            if display:
                annotated = box_annotator.annotate(scene=frame.copy(), detections=tracked)
                labels = [
                    f"#{tid} {detector.class_name(cid)} {conf:.2f}"
                    for tid, cid, conf in zip(
                        tracked.tracker_id if tracked.tracker_id is not None else [],
                        tracked.class_id,
                        tracked.confidence if tracked.confidence is not None else [0] * len(tracked),
                    )
                ]
                annotated = label_annotator.annotate(scene=annotated, detections=tracked, labels=labels)
                try:
                    cv2.imshow(f"CCTV Perception - {camera_id}", annotated)
                    if cv2.waitKey(1) & 0xFF == ord("q"):
                        break
                except cv2.error:
                    print(
                        f"[{camera_id}] cv2.imshow failed -- your OpenCV build has no GUI support "
                        f"(common with opencv-python-headless). Continuing without a display window. "
                        f"Fix: pip uninstall opencv-python-headless -y && pip install opencv-python, "
                        f"or just run with --no-display to skip this message."
                    )
                    display = False

    finally:
        reader.stop()
        reporter.close()
        if display:
            try:
                cv2.destroyAllWindows()
            except cv2.error:
                pass  # no GUI backend to tear down -- already handled above
        elapsed = time.time() - start_time
        if fight_detector is not None:
            print(f"[{camera_id}] fight diagnostics: {fight_detector.diagnostics()}")
        if fire_smoke_detector is not None:
            print(f"[{camera_id}] fire/smoke diagnostics: {fire_smoke_detector.diagnostics()}")
        if fall_detector is not None:
            print(f"[{camera_id}] pose-fall diagnostics: {fall_detector.diagnostics()}")
        if anomaly_detector is not None:
            print(f"[{camera_id}] scene-anomaly diagnostics: {anomaly_detector.diagnostics()}")
        print(f"[{camera_id}] stopped. processed {frames_processed} cycles in {elapsed:.1f}s "
              f"(~{frames_processed / max(elapsed, 1e-6):.2f} eval/s)")


if __name__ == "__main__":
    from env_loader import load_env

    load_env()
    parser = argparse.ArgumentParser(description="CCTV perception pipeline")
    parser.add_argument("--camera", default="CAM-01", help="camera id from config/cameras.yaml")
    parser.add_argument("--source", default=None, help="override source (webcam index, RTSP URL, or file path)")
    parser.add_argument("--no-display", action="store_true", help="disable cv2.imshow (needed on headless machines)")
    parser.add_argument("--max-seconds", type=float, default=None, help="stop after N seconds (useful for testing)")
    parser.add_argument(
        "--only-events",
        nargs="+",
        choices=["intrusion", "loitering", "crowd", "fall", "fight", "fire_smoke", "anomaly"],
        default=None,
        help="run/report only selected event modules (useful for isolated testing)",
    )
    args = parser.parse_args()

    run(
        camera_id=args.camera,
        source_override=args.source,
        display=not args.no_display,
        max_seconds=args.max_seconds,
        only_events=set(args.only_events) if args.only_events else None,
    )