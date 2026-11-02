"""
Perception pipeline entry point.

Wires together: StreamReader -> YoloDetector -> ByteTracker -> TemporalBuffer
-> RuleEngine + learned detectors -> EventConfirmation -> SeverityRules -> IncidentReporter.
The per-camera part lives in pipeline.CameraPipeline; multi_camera.run_all()
runs one pipeline per DVR channel on a shared inference loop.

Learned detectors (each optional, configured in thresholds.yaml):
  fight        R3D-18 video classifier                     temporal/rgb_action_recognition.py
  fire_smoke   YOLOv8 + colour/flicker verifier             temporal/fire_smoke_recognition.py
  fall         YOLOv8-Pose + GRU (or Random Forest)         temporal/fall_gru_recognition.py, pose_fall_recognition.py
  anomaly      optical-flow autoencoder (unsupervised)      temporal/scene_anomaly.py

All factory cameras (DVR channels in config/cameras.yaml, settings in .env):
    python main.py --all --no-display

One camera:
    python main.py --camera dvr-ch1 --no-display

Run with a webcam:
    python main.py --camera CAM-01

Run against a video file (useful for testing without real camera hardware):
    python main.py --camera CAM-01 --source /path/to/test_video.mp4 --no-display

Demo mode (no camera needed): loop every video in demo_videos/ through the
full pipeline -> dashboard -> live alert chain (see demo_videos/README.md):
    python main.py --demo

The single-camera loop runs at a fixed `detection_fps` (from thresholds.yaml)
rather than every captured frame, per the design doc's real-time performance
guidance (section 9/19); --all uses each camera's `fps` from cameras.yaml.
"""
from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path

# scikit-learn (learned fire verifier) must load before torch/ultralytics:
# the reverse order trips an OpenMP DLL clash on Windows.
import sklearn  # noqa: F401,E402

import cv2
import supervision as sv
import yaml

from detection.yolo_detector import YoloDetector
from ingestion.camera_config import parse_setup
from ingestion.demo_playlist import DemoPlaylistReader, find_demo_videos
from ingestion.stream_reader import StreamReader
from pipeline import (  # noqa: F401 - re-exported for tests and tools
    CameraPipeline, StageTimer, checkpoint_problem, redirect_output, start_optional,
)
from reporting.incident_report import IncidentReporter

TIER_COLOR = {
    "CONFIRMED": (0, 0, 255),      # red (BGR)
    "PROBABLE": (0, 165, 255),     # orange
    "LOW_CONFIDENCE": (0, 255, 255),  # yellow
}


def load_config(config_dir: str = "config"):
    with open(f"{config_dir}/cameras.yaml", encoding="utf-8") as f:
        cameras_cfg = yaml.safe_load(f)
    with open(f"{config_dir}/thresholds.yaml", encoding="utf-8") as f:
        thresholds_cfg = yaml.safe_load(f)
    return cameras_cfg, thresholds_cfg


def find_camera_config(cameras_cfg: dict, camera_id: str) -> dict:
    """The camera's runtime settings (DVR URL built from .env), as a plain dict."""
    setup = parse_setup(cameras_cfg)
    return setup.get(camera_id).to_runtime_dict(setup.dvr)


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
        "reconnect_max_delay_s": _env_float("CCTV_RECONNECT_MAX_SECONDS", 60.0),
        "reconnect_attempts": _env_int("CCTV_RECONNECT_ATTEMPTS", 0),
    }
    return effective_camera_id, source, location, {"source_kind": source_kind, **reader_options}


def inference_device() -> str:
    try:
        import torch
        return (f"GPU ({torch.cuda.get_device_name(0)})"
                if torch.cuda.is_available() and torch.cuda.device_count() > 0
                else "CPU (no CUDA GPU found)")
    except (ImportError, RuntimeError, AssertionError):
        return "CPU"


def build_detector(thresholds_cfg: dict) -> YoloDetector:
    perception_cfg = thresholds_cfg["perception"]
    return YoloDetector(
        model_path=perception_cfg["model_path"],
        confidence_threshold=perception_cfg["confidence_threshold"],
        classes_of_interest=perception_cfg["classes_of_interest"],
    )


def camera_info(cam_cfg: dict, camera_id: str, location: str) -> dict:
    """Camera fields sent with incidents (never the stream URL)."""
    return {"id": camera_id, "name": cam_cfg.get("name") or location,
            "zone": cam_cfg.get("zone") or "", "channel": cam_cfg.get("channel")}


def run(
    camera_id: str,
    source_override: str | None,
    display: bool,
    max_seconds: float | None,
    only_events: set[str] | None = None,
    demo_dir: str | None = None,
    output_dir: str = "output",
    stats_json: str | None = None,
    throttle: bool = True,
):
    cameras_cfg, thresholds_cfg = load_config()
    cam_cfg = find_camera_config(cameras_cfg, camera_id)
    camera_id, source, camera_location, reader_options = resolve_camera_runtime(
        camera_id,
        source_override,
        cam_cfg,
    )
    cam_cfg = {**cam_cfg, "id": camera_id, "location": camera_location}
    perception_cfg = thresholds_cfg["perception"]

    videos = []
    if demo_dir is not None:
        videos = find_demo_videos(demo_dir)
        if not videos:
            raise SystemExit(
                f"Demo mode: no videos found in '{demo_dir}'. Put short .mp4/.avi clips there "
                f"(see demo_videos/README.md) or pass another folder: --demo <folder>"
            )
        print(f"[{camera_id}] DEMO MODE: looping {len(videos)} video(s) from {demo_dir}")
        source_kind = "demo playlist"
    else:
        source_kind = reader_options["source_kind"]

    print(
        f"[{camera_id}] starting pipeline. source={source_kind} "
        f"location={camera_location}"
    )

    detector = build_detector(thresholds_cfg)
    device_label = inference_device()
    print(f"[{camera_id}] inference device: {device_label}")

    reporter = IncidentReporter(
        output_path=os.path.join(output_dir, "incidents.jsonl"),
        camera_locations={camera_id: camera_location},
        camera_info={camera_id: camera_info(cam_cfg, camera_id, camera_location)},
        # Optional local incident API (backend/api.py); unset to disable
        backend_url=os.getenv("LEGACY_INCIDENT_API_URL", "").strip() or None,
        # Dashboard posts and LLM enrichment must never stall frame processing
        background=True,
    )
    pipe = CameraPipeline(
        camera_id, cam_cfg, thresholds_cfg, detector, reporter,
        output_dir=output_dir, only_events=only_events, demo=demo_dir is not None,
    )

    box_annotator = sv.BoxAnnotator()
    label_annotator = sv.LabelAnnotator()

    process_interval = 1.0 / perception_cfg["detection_fps"]
    last_process_time = 0.0
    last_seen_frame_index = -1
    clip_changed = [False]

    if demo_dir is not None:
        def on_clip_start(_video):
            # A new clip is a different scene: start tracking afresh so tracks
            # from the previous clip can't pair with people in this one.
            clip_changed[0] = True
        reader = DemoPlaylistReader(
            videos, camera_id, perception_cfg["detection_fps"], on_clip_start=on_clip_start
        ).start()
    else:
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
    start_time = time.time()

    try:
        while True:
            if max_seconds and (time.time() - start_time) > max_seconds:
                print(f"[{camera_id}] max_seconds reached, stopping")
                break

            now = time.time()
            if throttle and now - last_process_time < process_interval:
                time.sleep(0.01)
                continue
            last_process_time = now

            sample = reader.get_latest()
            if clip_changed[0]:
                clip_changed[0] = False
                pipe.reset_scene()
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
            if getattr(reader, "video_loss", False):
                # black or frozen picture: a camera problem, not something to detect on
                continue

            frame, tracked = pipe.process(sample)

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
        diagnostics = pipe.diagnostics()
        for name, label in (("fight", "fight"), ("fire_smoke", "fire/smoke"),
                            ("fall", "pose-fall"), ("anomaly", "scene-anomaly")):
            if name in diagnostics:
                print(f"[{camera_id}] {label} diagnostics: {diagnostics[name]}")
        frames_processed = pipe.frames_processed
        print(f"[{camera_id}] stopped. processed {frames_processed} cycles in {elapsed:.1f}s "
              f"(~{frames_processed / max(elapsed, 1e-6):.2f} eval/s)")
        if stats_json:
            timer = pipe.timer
            Path(stats_json).parent.mkdir(parents=True, exist_ok=True)
            cycle_ms = timer.total_ms["cycle_total"] / max(timer.calls["cycle_total"], 1)
            Path(stats_json).write_text(json.dumps({
                "camera_id": camera_id,
                "device": device_label,
                "throttled": throttle,
                "elapsed_s": round(elapsed, 2),
                "cycles": frames_processed,
                "cycles_per_s": round(frames_processed / max(elapsed, 1e-6), 2),
                "pipeline_capacity_fps": round(1000.0 / cycle_ms, 2) if cycle_ms else None,
                "stages": timer.summary(frames_processed),
                "detectors": {
                    "fight": pipe.fight_detector is not None,
                    "fire_smoke": pipe.fire_smoke_detector is not None,
                    "fall": pipe.fall_detector is not None,
                    "anomaly": pipe.anomaly_detector is not None,
                },
                "incidents": [
                    {"event_type": event_type, "tier": tier, "count": count}
                    for (event_type, tier), count in sorted(pipe.incident_counts.items())
                ],
            }, indent=2), encoding="utf-8")
            print(f"[{camera_id}] stats written to {stats_json}")


if __name__ == "__main__":
    from env_loader import load_env

    load_env()
    parser = argparse.ArgumentParser(description="CCTV perception pipeline")
    parser.add_argument("--camera", default="CAM-01", help="camera id from config/cameras.yaml")
    parser.add_argument("--all", action="store_true",
                        help="run every enabled camera in config/cameras.yaml (the factory DVR)")
    parser.add_argument("--cameras", default=None,
                        help="with --all: only these camera ids, comma-separated (e.g. dvr-ch1,dvr-ch3)")
    parser.add_argument("--source", default=None, help="override source (webcam index, RTSP URL, or file path)")
    parser.add_argument("--demo", nargs="?", const="demo_videos", default=None, metavar="FOLDER",
                        help="loop every video in FOLDER (default demo_videos/) instead of a camera")
    parser.add_argument("--output-dir", default="output",
                        help="where incidents, evidence and calibration are written (default output/)")
    parser.add_argument("--stats-json", default=None,
                        help="write FPS, per-stage timing and incident counts to this JSON file on exit")
    parser.add_argument("--no-throttle", action="store_true",
                        help="process frames as fast as possible (benchmarking only: detectors use "
                             "wall-clock time, so incident timing is not realistic)")
    parser.add_argument("--no-display", action="store_true", help="disable cv2.imshow (needed on headless machines)")
    parser.add_argument("--max-seconds", type=float, default=None, help="stop after N seconds (useful for testing)")
    parser.add_argument(
        "--only-events",
        nargs="+",
        choices=["crowd", "fall", "fight", "fire_smoke", "anomaly"],
        default=None,
        help="run/report only selected event modules (useful for isolated testing)",
    )
    args = parser.parse_args()
    if args.demo is not None and args.source is not None:
        parser.error("--demo and --source can't be used together")
    if args.all:
        if args.demo is not None or args.source is not None:
            parser.error("--all reads the cameras from config/cameras.yaml; drop --demo/--source")
        from multi_camera import run_all

        run_all(
            camera_ids=[c.strip() for c in args.cameras.split(",") if c.strip()] if args.cameras else None,
            max_seconds=args.max_seconds,
            only_events=set(args.only_events) if args.only_events else None,
            output_dir=args.output_dir,
        )
        raise SystemExit(0)

    run(
        camera_id=args.camera,
        source_override=args.source,
        display=not args.no_display,
        max_seconds=args.max_seconds,
        only_events=set(args.only_events) if args.only_events else None,
        demo_dir=args.demo,
        output_dir=args.output_dir,
        stats_json=args.stats_json,
        throttle=not args.no_throttle,
    )
