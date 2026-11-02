"""All factory cameras in one process: python main.py --all --no-display

One StreamReader thread per enabled camera keeps that camera's newest
sub-stream frame; a single inference loop takes the cameras in turn
(scheduler.FrameScheduler), so one PC can watch 8 channels. A camera that is
down or shows video loss is skipped and retried; it never stops the others.
Models are loaded once and shared (shared_models.py).

Environment:
    MAX_INFER_FPS_TOTAL   frames per second across all cameras (default 10;
                          4 with REMOTE_MODE=true)
    REMOTE_MODE           true on a laptop over Tailscale: sub stream, <= 1 fps
"""
from __future__ import annotations

import os
import time
from typing import Optional

import yaml

from ingestion.camera_config import CameraSetup, load_camera_setup
from ingestion.dvr import mask_text
from ingestion.evidence_grabber import MainStreamGrabber
from ingestion.stream_reader import StreamReader
from main import build_detector, camera_info, inference_device, _env_float
from pipeline import CameraPipeline, section_configs
from reporting.incident_report import IncidentReporter
from scheduler import FrameScheduler

STATS_EVERY_S = 60.0


def total_fps_limit(setup: CameraSetup) -> float:
    return _env_float("MAX_INFER_FPS_TOTAL", 4.0 if setup.remote_mode else 10.0)


def format_stats(stats: dict, statuses: dict) -> str:
    parts = []
    for cam_id, s in stats.items():
        ms = f"{s['infer_ms']:.0f} ms" if s["infer_ms"] is not None else "-"
        parts.append(f"{cam_id} {statuses.get(cam_id, '?').lower()} {s['fps']:.1f} fps {ms}")
    return "[perf] " + " | ".join(parts)


def run_all(camera_ids: Optional[list[str]] = None, max_seconds: Optional[float] = None,
            only_events: Optional[set[str]] = None, output_dir: str = "output",
            config_dir: str = "config", heartbeat=None) -> None:
    setup = load_camera_setup(os.path.join(config_dir, "cameras.yaml"))
    with open(os.path.join(config_dir, "thresholds.yaml"), encoding="utf-8") as f:
        thresholds_cfg = yaml.safe_load(f)

    cameras = [c for c in setup.enabled if c.is_dvr]
    if camera_ids:
        wanted = set(camera_ids)
        cameras = [c for c in setup.cameras if c.id in wanted]
        missing = wanted - {c.id for c in cameras}
        if missing:
            raise SystemExit(f"not in cameras.yaml: {', '.join(sorted(missing))}")
    if not cameras:
        raise SystemExit("no enabled cameras in config/cameras.yaml")
    if any(c.is_dvr for c in cameras) and setup.dvr is None:
        raise SystemExit("DVR_HOST is not set in perception-service/.env (see docs/CCTV_SETUP.md)")
    password = setup.dvr.password if setup.dvr else ""

    limit = total_fps_limit(setup)
    print(f"[multi] {len(cameras)} camera(s), up to {limit:g} frames/s in total"
          f"{' (REMOTE_MODE: sub stream, low fps)' if setup.remote_mode else ''}")
    print(f"[multi] inference device: {inference_device()}")

    detector = build_detector(thresholds_cfg)
    reporter = IncidentReporter(
        output_path=os.path.join(output_dir, "incidents.jsonl"),
        camera_locations={c.id: c.location for c in cameras},
        camera_info={c.id: camera_info(c.metadata(), c.id, c.location) for c in cameras},
        backend_url=os.getenv("LEGACY_INCIDENT_API_URL", "").strip() or None,
        background=True,
    )
    evidence_dir = section_configs(thresholds_cfg, output_dir, demo=False)["evidence"]["output_dir"]
    grabber = MainStreamGrabber(
        os.path.join(evidence_dir, "main"), password=password,
        on_saved=lambda incident_id, paths: reporter.update_evidence(incident_id, {"main_frames": paths}),
    )

    readers: dict[str, StreamReader] = {}
    pipelines: dict[str, CameraPipeline] = {}
    for cam in cameras:
        evidence_url = cam.evidence_source(setup.dvr)

        def on_incident(incident_id: str, _event: str, cam_id=cam.id, url=evidence_url) -> None:
            grabber.request(incident_id, cam_id, url)

        pipelines[cam.id] = CameraPipeline(
            cam.id, cam.to_runtime_dict(setup.dvr), thresholds_cfg, detector, reporter,
            output_dir=output_dir, only_events=only_events, fps=cam.fps, on_incident=on_incident,
        )
        readers[cam.id] = StreamReader(
            source=cam.detect_source(setup.dvr), camera_id=cam.id, target_fps=cam.fps,
            connect_timeout_s=_env_float("CCTV_CONNECT_TIMEOUT_SECONDS", 10.0),
            read_timeout_s=_env_float("CCTV_READ_TIMEOUT_SECONDS", 10.0),
            reconnect_delay_s=_env_float("CCTV_RECONNECT_INITIAL_SECONDS", 2.0),
            reconnect_max_delay_s=_env_float("CCTV_RECONNECT_MAX_SECONDS", 60.0),
        ).start()
        print(f"[{cam.id}] {cam.location}: channel {cam.channel}, {cam.detect_stream} stream, "
              f"{cam.fps:g} fps, rules {', '.join(pipelines[cam.id].events) or 'none'}")

    scheduler = FrameScheduler({c.id: c.fps for c in cameras}, max_total_fps=limit)
    last_index = {c.id: -1 for c in cameras}
    was_lost = {c.id: False for c in cameras}
    started = last_stats = time.monotonic()

    def statuses() -> dict:
        return {cam_id: r.status()["status"] for cam_id, r in readers.items()}

    try:
        while True:
            now = time.monotonic()
            if max_seconds and now - started > max_seconds:
                print("[multi] max_seconds reached, stopping")
                break
            if now - last_stats >= STATS_EVERY_S:
                last_stats = now
                print(format_stats(scheduler.take_stats(), statuses()), flush=True)
            if heartbeat is not None:
                heartbeat.tick(readers, pipelines)

            cam_id = scheduler.next_camera()
            if cam_id is None:
                time.sleep(min(max(scheduler.wait_time(), 0.005), 0.1))
                continue
            reader = readers[cam_id]
            sample = reader.get_latest()
            if sample is None or sample.frame_index == last_index[cam_id]:
                scheduler.skip(cam_id, 0.05)
                continue
            last_index[cam_id] = sample.frame_index
            if reader.video_loss:
                if not was_lost[cam_id]:
                    print(f"[{cam_id}] video loss ({reader.health.state.status.lower()} picture) -- "
                          f"detection paused for this camera")
                was_lost[cam_id] = True
                scheduler.skip(cam_id, 1.0)
                continue
            if was_lost[cam_id]:
                print(f"[{cam_id}] picture back -- detection resumed")
                was_lost[cam_id] = False
                pipelines[cam_id].reset_scene()

            t0 = time.perf_counter()
            try:
                pipelines[cam_id].process(sample)
            except Exception as exc:  # noqa: BLE001 - one camera's error must not stop the rest
                print(f"[{cam_id}] processing error: {mask_text(exc, password)}")
            scheduler.done(cam_id, (time.perf_counter() - t0) * 1000.0)
    except KeyboardInterrupt:
        print("[multi] stopping")
    finally:
        for r in readers.values():
            r.stop()
        grabber.close()
        reporter.close()
        for cam_id, pipe in pipelines.items():
            print(f"[{cam_id}] processed {pipe.frames_processed} frames, "
                  f"incidents {dict(pipe.incident_counts) or 'none'}")
